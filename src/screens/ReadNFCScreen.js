import Clipboard from '@react-native-clipboard/clipboard';
import {useFocusEffect} from '@react-navigation/native';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {Card as PaperCard} from 'react-native-paper';
import Ionicons from 'react-native-vector-icons/Ionicons';
import Toast from 'react-native-toast-message';
import NfcManager, {Ndef, NfcTech} from 'react-native-nfc-manager';
import Ntag424 from '../class/Ntag424';
import {useLaWallet} from '../providers/LaWallet';

// ─── Constants ───────────────────────────────────────────────────────────────

const CARD_TYPES = {
  '01': 'MIFARE DESFire',
  '02': 'MIFARE Plus',
  '03': 'MIFARE Ultralight',
  '04': 'NTAG',
  '07': 'NTAG I2C',
  '08': 'MIFARE DESFire Light',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function shortKey(pk) {
  if (!pk) return '—';
  return `${pk.slice(0, 8)}…${pk.slice(-4)}`;
}

function InfoRow({label, value, mono, onCopy}) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <View style={styles.infoValueWrap}>
        <Text
          style={[styles.infoValue, mono && styles.infoValueMono]}
          numberOfLines={1}
          ellipsizeMode="middle">
          {value}
        </Text>
        {onCopy && (
          <TouchableOpacity onPress={onCopy} style={styles.copyBtn}>
            <Ionicons name="copy-outline" size={14} color="#888" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function ReadNFCScreen() {
  const {authFetch, isLogged} = useLaWallet();

  // step: 'reading' | 'loading' | 'result' | 'error'
  const [step, setStep] = useState('reading');
  const [errorMsg, setErrorMsg] = useState(null);

  // NFC chip data
  const [chipUID, setChipUID] = useState(null);
  const [ndefUrl, setNdefUrl] = useState(null);
  const [chipInfo, setChipInfo] = useState(null); // {type, vendor, mem}
  const [keyVersions, setKeyVersions] = useState(null); // string[5]

  // Server card data
  const [serverCard, setServerCard] = useState(null);
  const [serverLoading, setServerLoading] = useState(false);

  // Pulse animation for the NFC icon
  const pulse = useRef(new Animated.Value(1)).current;
  const pulseAnim = useRef(null);

  // Monotonic token identifying the current scan. Leaving the tab (blur) or
  // starting a new scan bumps it; any in-flight scan whose token is stale must
  // not touch state — its NFC request was cancelled by us, not failed.
  const readSeq = useRef(0);

  useEffect(() => {
    if (step === 'reading') {
      pulseAnim.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 1.25,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulse, {
            toValue: 1.0,
            duration: 800,
            useNativeDriver: true,
          }),
        ]),
      );
      pulseAnim.current.start();
    } else {
      pulseAnim.current?.stop();
      pulse.setValue(1);
    }
  }, [step, pulse]);

  // ── Core NFC read ───────────────────────────────────────────────────────────

  const readNfc = useCallback(async () => {
    // Claim this scan slot. The cleanup increments readSeq so any
    // in-flight scan from a previous focus session sees a mismatch
    // and exits silently instead of showing an error.
    const mySeq = ++readSeq.current;

    setStep('reading');
    setErrorMsg(null);
    setChipUID(null);
    setNdefUrl(null);
    setChipInfo(null);
    setKeyVersions(null);
    setServerCard(null);

    try {
      // A scan cancelled by a tab switch can leave a pending request, so the
      // next requestTechnology fails with "one request at a time" when we
      // return to this tab and NFC never starts. Start NFC and clear any
      // stale request first — this is what makes the wipe/bulk flows reliable.
      await NfcManager.start().catch(() => {});
      await NfcManager.cancelTechnologyRequest().catch(() => {});
      if (mySeq !== readSeq.current) return;

      await NfcManager.requestTechnology(NfcTech.IsoDep);
      const tag = await NfcManager.getTag();

      // Card detected — show a loading spinner while we read the chip data
      // (version, key versions) and look up the server record.
      if (mySeq === readSeq.current) setStep('loading');

      // ── NDEF URL ──
      let resolvedUrl = null;
      try {
        resolvedUrl = Ndef.uri.decodePayload(tag.ndefMessage[0].payload);
      } catch {}
      setNdefUrl(resolvedUrl);

      // ── Chip UID ──
      const uid = tag.id?.toLowerCase() ?? null;
      setChipUID(uid);

      // ── Card version / type ──
      await Ntag424.isoSelectFileApplication();
      const ver = await Ntag424.getVersion();
      setChipInfo({
        type: CARD_TYPES[ver.HWType] ?? `Type ${ver.HWType}`,
        vendor: ver.VendorID === '04' ? 'NXP' : `Vendor ${ver.VendorID}`,
        mem: ver.HWStorageSize === '11' ? '256–512 B' : `Size ${ver.HWStorageSize}`,
      });

      // ── Key versions ──
      const kvs = await Promise.all(
        ['00', '01', '02', '03', '04'].map(n => Ntag424.getKeyVersion(n)),
      );
      setKeyVersions(kvs);

      await NfcManager.cancelTechnologyRequest();

      // Only update state if this scan wasn't cancelled by a tab switch
      if (mySeq !== readSeq.current) return;

      setStep('result');

      // ── Server lookup (non-blocking) ──
      if (uid) {
        // Try NDEF URL card ID first, fall back to chip UID
        let cardId = uid;
        if (resolvedUrl) {
          const m = resolvedUrl.match(/\/api\/cards\/([^/\?]+)/);
          if (m) cardId = m[1];
        }
        fetchServerCard(cardId);
      }
    } catch (ex) {
      await NfcManager.cancelTechnologyRequest().catch(() => {});
      // If the scan was cancelled because we left the tab, swallow the
      // error — useFocusEffect will restart a fresh scan on return.
      if (mySeq !== readSeq.current) return;
      const msg =
        typeof ex === 'object'
          ? 'NFC Error: ' + (ex.message ?? ex.constructor.name)
          : String(ex);
      setErrorMsg(msg);
      setStep('error');
    }
  }, [authFetch, isLogged]);

  const fetchServerCard = useCallback(
    async cardId => {
      if (!isLogged) return;
      setServerLoading(true);
      try {
        const res = await authFetch('/api/cards/' + cardId);
        if (res.ok) {
          setServerCard(await res.json());
        }
      } catch {}
      setServerLoading(false);
    },
    [authFetch, isLogged],
  );

  // Auto-start when screen gains focus; cancel + invalidate when it loses focus
  useFocusEffect(
    useCallback(() => {
      readNfc();
      return () => {
        // Bump the sequence so the in-flight catch block exits silently
        readSeq.current++;
        NfcManager.cancelTechnologyRequest().catch(() => {});
      };
    }, [readNfc]),
  );

  const copyUID = useCallback(() => {
    if (!chipUID) return;
    Clipboard.setString(chipUID);
    Toast.show({type: 'success', text1: 'UID copied to clipboard'});
  }, [chipUID]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  // Reading state — centred pulsing icon
  if (step === 'reading') {
    return (
      <View style={styles.readingCenter}>
        <Animated.View style={{transform: [{scale: pulse}]}}>
          <Ionicons name="wifi-outline" size={96} color="#f58340" style={styles.nfcIcon} />
        </Animated.View>
        <Text style={styles.readingTitle}>Ready to Scan</Text>
        <Text style={styles.readingSubtitle}>
          Hold your card to the back of the phone
        </Text>
      </View>
    );
  }

  // Loading state — card detected, reading chip + server data
  if (step === 'loading') {
    return (
      <View style={styles.readingCenter}>
        <ActivityIndicator size="large" color="#f58340" />
        <Text style={styles.readingTitle}>Reading card…</Text>
        <Text style={styles.readingSubtitle}>Keep the card on the phone</Text>
      </View>
    );
  }

  // Error state
  if (step === 'error') {
    return (
      <View style={styles.readingCenter}>
        <Ionicons name="alert-circle-outline" size={64} color="#c0392b" />
        <Text style={styles.errorTitle}>Read Failed</Text>
        <Text style={styles.errorMsg}>{errorMsg}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={readNfc}>
          <Ionicons name="refresh" size={16} color="#fff" style={{marginRight: 6}} />
          <Text style={styles.retryBtnText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Result state
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>

      {/* Header icon + tap-again button */}
      <View style={styles.resultHeader}>
        <Ionicons name="wifi" size={40} color="#f58340" />
        <Text style={styles.resultHeaderText}>Card Read</Text>
        <TouchableOpacity style={styles.scanAgainBtn} onPress={readNfc}>
          <Ionicons name="refresh" size={15} color="#f58340" style={{marginRight: 4}} />
          <Text style={styles.scanAgainText}>Scan Again</Text>
        </TouchableOpacity>
      </View>

      {/* Blank-card notice — no NDEF URL written */}
      {!ndefUrl && (
        <View style={styles.blankBanner}>
          <Ionicons name="document-outline" size={24} color="#b8860b" />
          <View style={{flex: 1}}>
            <Text style={styles.blankBannerTitle}>Card is completely blank</Text>
            <Text style={styles.blankBannerText}>
              No NDEF data is written to this card.
            </Text>
          </View>
        </View>
      )}

      {/* Server card data */}
      {isLogged && (
        <PaperCard style={styles.card}>
          <PaperCard.Content>
            <View style={styles.cardHeader}>
              <Ionicons name="server-outline" size={18} color="#555" />
              <Text style={styles.cardTitle}>LaWallet Record</Text>
              {serverLoading && <ActivityIndicator size="small" color="#f58340" style={{marginLeft: 8}} />}
            </View>
            {serverCard ? (
              <>
                <InfoRow
                  label="Owner"
                  value={serverCard.username ?? shortKey(serverCard.pubkey)}
                />
                <InfoRow label="Design" value={serverCard.design?.description ?? '—'} />
                <InfoRow label="Kind" value={serverCard.kind ?? '—'} />
                <InfoRow label="Created" value={formatDate(serverCard.createdAt)} />
                <InfoRow
                  label="Last used"
                  value={serverCard.lastUsedAt ? formatDate(serverCard.lastUsedAt) : 'Never'}
                />
              </>
            ) : !serverLoading ? (
              <Text style={styles.notFound}>Card not registered in this system.</Text>
            ) : null}
          </PaperCard.Content>
        </PaperCard>
      )}

      {/* NFC chip data */}
      <PaperCard style={styles.card}>
        <PaperCard.Content>
          <View style={styles.cardHeader}>
            <Ionicons name="hardware-chip-outline" size={18} color="#555" />
            <Text style={styles.cardTitle}>Chip Data</Text>
          </View>
          <InfoRow label="UID" value={chipUID ?? '—'} mono onCopy={copyUID} />
          <InfoRow label="NDEF URL" value={ndefUrl ?? '—'} mono />
          {chipInfo && (
            <>
              <InfoRow label="Type" value={chipInfo.type} />
              <InfoRow label="Vendor" value={chipInfo.vendor} />
              <InfoRow label="Memory" value={chipInfo.mem} />
            </>
          )}
        </PaperCard.Content>
      </PaperCard>

      {/* Key versions */}
      {keyVersions && (
        <PaperCard style={styles.card}>
          <PaperCard.Content>
            <View style={styles.cardHeader}>
              <Ionicons name="key-outline" size={18} color="#555" />
              <Text style={styles.cardTitle}>Key Versions</Text>
            </View>
            {keyVersions.map((v, i) => (
              <InfoRow key={i} label={`Key ${i}`} value={v ?? '—'} mono />
            ))}
          </PaperCard.Content>
        </PaperCard>
      )}

      <View style={{height: 24}} />
    </ScrollView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Reading / error centered layout
  readingCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    gap: 16,
  },
  nfcIcon: {
    transform: [{rotate: '90deg'}], // wifi icon rotated looks like NFC waves
  },
  readingTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 8,
  },
  readingSubtitle: {
    fontSize: 15,
    color: '#888',
    textAlign: 'center',
    lineHeight: 22,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#c0392b',
    marginTop: 8,
    textAlign: 'center',
  },
  errorMsg: {
    fontSize: 14,
    color: '#555',
    textAlign: 'center',
    lineHeight: 20,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f58340',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  retryBtnText: {color: '#fff', fontWeight: 'bold', fontSize: 15},

  // Result layout
  scroll: {backgroundColor: '#f2f2f2'},
  scrollContent: {padding: 12},
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  resultHeaderText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    flex: 1,
  },
  scanAgainBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#f58340',
  },
  scanAgainText: {color: '#f58340', fontSize: 13, fontWeight: '600'},

  // Blank-card banner
  blankBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff8e1',
    borderColor: '#ffe082',
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },
  blankBannerTitle: {fontSize: 15, fontWeight: 'bold', color: '#7a5d00'},
  blankBannerText: {fontSize: 13, color: '#9a7b1a', marginTop: 2},

  // Cards
  card: {marginBottom: 12},
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  cardTitle: {fontSize: 15, fontWeight: 'bold', color: '#444'},
  notFound: {fontSize: 13, color: '#999', fontStyle: 'italic'},

  // Info rows
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  infoLabel: {fontSize: 13, color: '#888', flex: 1},
  infoValueWrap: {flex: 2, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 6},
  infoValue: {fontSize: 13, color: '#333', textAlign: 'right', flexShrink: 1},
  infoValueMono: {fontFamily: 'monospace', fontSize: 11},
  copyBtn: {padding: 4},
});
