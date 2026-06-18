import React, {useCallback, useRef, useState} from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {Card as PaperCard} from 'react-native-paper';
import Ionicons from 'react-native-vector-icons/Ionicons';
import NfcManager, {Ndef, NfcTech} from 'react-native-nfc-manager';
import Ntag424 from '../class/Ntag424';
import {useLaWallet} from '../providers/LaWallet';
import {Card} from '../types/response';

// ─── Constants ───────────────────────────────────────────────────────────────

const ZERO_KEY = '00000000000000000000000000000000';

type Step =
  | 'tap'
  | 'reading'
  | 'loading'
  | 'info'
  | 'writing'
  | 'success'
  | 'error';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortKey(pk?: string | null): string {
  if (!pk) return '—';
  return `${pk.slice(0, 8)}…${pk.slice(-4)}`;
}

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text
        style={[styles.infoValue, mono && styles.infoValueMono]}
        numberOfLines={1}
        ellipsizeMode="middle">
        {value}
      </Text>
    </View>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function WipeCardScreen() {
  const {authFetch, isLogged} = useLaWallet();

  const [step, setStep] = useState<Step>('tap');
  const [cardId, setCardId] = useState<string | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [progress, setProgress] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const addProgress = useCallback((msg: string) => {
    setProgress(prev => [...prev, msg]);
  }, []);

  // True while a tab-blur cancel is in flight so catch blocks can
  // distinguish "user switched tabs" from a genuine NFC error.
  const cancelledByBlur = useRef(false);
  // Tracks the step at the moment blur fires (avoids stale closure).
  const stepRef = useRef<Step>('tap');
  // Keep stepRef in sync with step state.
  const setStepSynced = useCallback((s: Step) => {
    stepRef.current = s;
    setStep(s);
  }, []);

  // Cancel NFC and restore clean state whenever the tab loses focus.
  useFocusEffect(
    useCallback(() => {
      return () => {
        const currentStep = stepRef.current;
        if (currentStep === 'reading' || currentStep === 'writing') {
          cancelledByBlur.current = true;
          NfcManager.cancelTechnologyRequest().catch(() => {});
        }
      };
    }, []),
  );

  const reset = () => {
    setStepSynced('tap');
    setCardId(null);
    setCard(null);
    setProgress([]);
    setErrorMsg(null);
  };

  const handleError = useCallback((msg: string) => {
    setErrorMsg(msg);
    setStepSynced('error');
    NfcManager.cancelTechnologyRequest().catch(() => {});
  }, [setStepSynced]);

  // ── Phase 1: tap card to resolve ID ────────────────────────────────────────

  const startTap = useCallback(async () => {
    cancelledByBlur.current = false;
    setStepSynced('reading');
    setErrorMsg(null);
    try {
      // Clear any stale NFC request left over from another screen/scan so
      // requestTechnology doesn't fail with "one request at a time" when
      // arriving from Bulk Create / Read NFC.
      await NfcManager.start().catch(() => {});
      await NfcManager.cancelTechnologyRequest().catch(() => {});
      if (cancelledByBlur.current) {
        cancelledByBlur.current = false;
        setStepSynced('tap');
        return;
      }
      await NfcManager.requestTechnology(NfcTech.IsoDep, {
        alertMessage: 'Hold your card to the back of your phone',
      });
      const tag = await NfcManager.getTag();
      if (!tag) {
        if (cancelledByBlur.current) { cancelledByBlur.current = false; setStepSynced('tap'); return; }
        handleError('No card detected. Try again.');
        return;
      }

      // Primary: use chip UID
      let resolvedId: string = (tag as any).id?.toLowerCase() ?? '';

      // Fallback: parse card ID out of the lnurlw NDEF URL
      const ndefMsg = (tag as any).ndefMessage;
      if (ndefMsg?.length) {
        try {
          const url: string = Ndef.uri.decodePayload(ndefMsg[0].payload);
          const m = url.match(/\/api\/cards\/([^/\?]+)/);
          if (m) resolvedId = m[1];
        } catch {
          // ignore NDEF parse errors — chip UID is the fallback
        }
      }

      NfcManager.cancelTechnologyRequest().catch(() => {});

      if (!resolvedId) {
        handleError('Could not read card ID.');
        return;
      }

      setCardId(resolvedId);
      setStepSynced('loading');

      // ── Phase 2: fetch card info from server ──────────────────────────────
      const res = await authFetch('/api/cards/' + resolvedId);
      if (res.status === 404) { handleError('Card not registered in this system.'); return; }
      if (!res.ok) { handleError(`Server error (${res.status}) fetching card details.`); return; }
      const data: Card = await res.json();
      setCard(data);
      setStepSynced('info');
    } catch (e: any) {
      // Swallow the error if the blur handler triggered the cancel.
      if (cancelledByBlur.current) {
        cancelledByBlur.current = false;
        setStepSynced('tap');
        return;
      }
      handleError(e?.message ?? 'NFC read failed.');
    }
  }, [authFetch, handleError, setStepSynced]);

  // ── Phase 3: NFC wipe + server delete (no confirmation prompt) ─────────────

  const startWipe = useCallback(async () => {
    if (!card) return;
    cancelledByBlur.current = false;
    setProgress([]);
    setStepSynced('writing');

    const {k0, k1, k2, k3, k4} = card.ntag424;
    const id = card.id;

    try {
      // Clear any stale NFC request so requestTechnology doesn't fail with
      // "one request at a time" when arriving from another NFC screen.
      await NfcManager.start().catch(() => {});
      await NfcManager.cancelTechnologyRequest().catch(() => {});
      if (cancelledByBlur.current) {
        cancelledByBlur.current = false;
        setStepSynced('info');
        return;
      }
      await NfcManager.requestTechnology(NfcTech.IsoDep, {
        alertMessage: 'Hold card steady while keys are wiped…',
      });

      // Authenticate with current key 0
      await Ntag424.AuthEv2First('00', k0);

      // Clear file settings (removes SDM / mirroring config)
      await Ntag424.resetFileSettings();

      // Wipe keys 1–4 (current → zeros). Key 0 must be last
      // because the session was opened with it.
      await Ntag424.changeKey('01', k1, ZERO_KEY, '00');
      addProgress('✓ Key 1 wiped');
      await Ntag424.changeKey('02', k2, ZERO_KEY, '00');
      addProgress('✓ Key 2 wiped');
      await Ntag424.changeKey('03', k3, ZERO_KEY, '00');
      addProgress('✓ Key 3 wiped');
      await Ntag424.changeKey('04', k4, ZERO_KEY, '00');
      addProgress('✓ Key 4 wiped');
      await Ntag424.changeKey('00', k0, ZERO_KEY, '00');
      addProgress('✓ Key 0 wiped');

      // Clear NDEF message
      const bytes = Ndef.encodeMessage([Ndef.uriRecord('')]);
      await Ntag424.setNdefMessage(bytes);
      addProgress('✓ NDEF cleared');

      NfcManager.cancelTechnologyRequest().catch(() => {});

      // Delete card record from server
      try {
        const delRes = await authFetch('/api/cards/' + id, {
          method: 'DELETE',
        });
        if (!delRes.ok) {
          addProgress(
            '⚠ Card wiped but server delete failed — contact your admin.',
          );
        } else {
          addProgress('✓ Card deleted from server');
        }
      } catch {
        addProgress(
          '⚠ Card wiped but server delete failed — contact your admin.',
        );
      }

      setStepSynced('success');
    } catch (e: any) {
      NfcManager.cancelTechnologyRequest().catch(() => {});
      // If blur triggered the cancel, go back to info (user can retry).
      if (cancelledByBlur.current) {
        cancelledByBlur.current = false;
        setStepSynced('info');
        return;
      }
      const msg = e?.message ?? 'NFC write failed.';
      addProgress('✗ Error: ' + msg);
      handleError('Wipe failed: ' + msg);
    }
  }, [card, authFetch, addProgress, handleError, setStepSynced]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  // Not logged in
  if (!isLogged) {
    return (
      <View style={styles.center}>
        <Ionicons name="lock-closed-outline" size={56} color="#aaa" />
        <Text style={styles.emptyTitle}>Not logged in</Text>
        <Text style={styles.emptySubtitle}>
          Go to the Login tab to authenticate first.
        </Text>
      </View>
    );
  }

  // Tap prompt
  if (step === 'tap') {
    return (
      <View style={styles.center}>
        <Ionicons name="card-outline" size={72} color="#f58340" />
        <Text style={styles.emptyTitle}>Wipe Card</Text>
        <Text style={styles.emptySubtitle}>
          Tap a card to load its details and reset its keys.
        </Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={startTap}>
          <Text style={styles.primaryBtnText}>Tap Card</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // NFC reading / server loading
  if (step === 'reading' || step === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#f58340" />
        <Text style={styles.loadingText}>
          {step === 'reading'
            ? 'Hold your card to the back of the phone…'
            : 'Fetching card details…'}
        </Text>
      </View>
    );
  }

  // Error
  if (step === 'error') {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={56} color="#c0392b" />
        <Text style={styles.errorTitle}>Something went wrong</Text>
        <Text style={styles.errorMsg}>{errorMsg}</Text>
        <TouchableOpacity style={styles.secondaryBtn} onPress={reset}>
          <Text style={styles.secondaryBtnText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // NFC wipe in progress
  if (step === 'writing') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#f58340" />
        <Text style={styles.loadingText}>Hold card steady while keys are wiped…</Text>
        <ScrollView
          style={styles.progressBox}
          contentContainerStyle={styles.progressContent}>
          {progress.map((p, i) => (
            <Text key={i} style={styles.progressLine}>
              {p}
            </Text>
          ))}
        </ScrollView>
      </View>
    );
  }

  // Success
  if (step === 'success') {
    return (
      <View style={styles.center}>
        <Ionicons name="checkmark-circle-outline" size={72} color="#27ae60" />
        <Text style={styles.successTitle}>Card Wiped Successfully</Text>
        <ScrollView
          style={styles.progressBox}
          contentContainerStyle={styles.progressContent}>
          {progress.map((p, i) => (
            <Text key={i} style={styles.progressLine}>
              {p}
            </Text>
          ))}
        </ScrollView>
        <TouchableOpacity style={styles.primaryBtn} onPress={reset}>
          <Text style={styles.primaryBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Card info (step === 'info')
  return (
    <ScrollView style={styles.scroll}>
      <PaperCard style={styles.card}>
        <PaperCard.Content>
          <View style={styles.infoHeader}>
            <Ionicons name="card" size={26} color="#f58340" />
            <Text style={styles.infoTitle}>Card Details</Text>
          </View>

          <InfoRow
            label="Owner"
            value={card?.username ?? shortKey(card?.pubkey)}
          />
          <InfoRow label="Created" value={formatDate(card?.createdAt)} />
          <InfoRow
            label="Last used"
            value={card?.lastUsedAt ? formatDate(card.lastUsedAt) : 'Never'}
          />
          <InfoRow
            label="Design"
            value={card?.design?.description ?? '—'}
          />
          <InfoRow label="Kind" value={card?.kind ?? '—'} />
          <InfoRow label="Card ID" value={cardId ?? '—'} mono />
        </PaperCard.Content>
      </PaperCard>

      <TouchableOpacity style={styles.dangerBtn} onPress={startWipe}>
        <Ionicons
          name="trash-outline"
          size={18}
          color="#fff"
          style={{marginRight: 8}}
        />
        <Text style={styles.dangerBtnText}>Reset Keys</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.cancelBtn} onPress={reset}>
        <Text style={styles.cancelBtnText}>Cancel</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: {padding: 12},
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 16,
  },
  // Empty / not-logged-in states
  emptyTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    lineHeight: 20,
  },
  // Loading
  loadingText: {
    fontSize: 15,
    color: '#555',
    textAlign: 'center',
    marginTop: 12,
  },
  // Error
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
  // Success
  successTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#27ae60',
    marginTop: 8,
    textAlign: 'center',
  },
  // Progress log
  progressBox: {
    maxHeight: 200,
    width: '100%',
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 8,
    backgroundColor: '#f9f9f9',
    marginTop: 8,
  },
  progressContent: {padding: 12},
  progressLine: {
    fontSize: 13,
    color: '#333',
    marginBottom: 4,
    fontFamily: 'monospace',
  },
  // Buttons
  primaryBtn: {
    backgroundColor: '#f58340',
    paddingHorizontal: 40,
    paddingVertical: 14,
    borderRadius: 8,
    marginTop: 8,
  },
  primaryBtnText: {color: '#fff', fontWeight: 'bold', fontSize: 16},
  secondaryBtn: {
    backgroundColor: '#555',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  secondaryBtnText: {color: '#fff', fontWeight: 'bold', fontSize: 14},
  dangerBtn: {
    backgroundColor: '#c0392b',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 8,
    marginBottom: 12,
  },
  dangerBtnText: {color: '#fff', fontWeight: 'bold', fontSize: 16},
  cancelBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 24,
  },
  cancelBtnText: {color: '#888', fontSize: 14},
  // Info card
  card: {marginBottom: 16},
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  infoTitle: {fontSize: 18, fontWeight: 'bold', color: '#333'},
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  infoLabel: {fontSize: 13, color: '#888', flex: 1},
  infoValue: {fontSize: 13, color: '#333', flex: 2, textAlign: 'right'},
  infoValueMono: {fontFamily: 'monospace', fontSize: 11},
});
