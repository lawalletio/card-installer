/* eslint-disable no-alert */
/* eslint-disable react-native/no-inline-styles */
import {useNavigation} from '@react-navigation/native';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  ToastAndroid,
  TouchableOpacity,
  Image,
  View,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';

import NfcManager, {NfcTech} from 'react-native-nfc-manager';
import WriteModal from '../components/WriteModal';

import {useLaWallet, AuthError} from '../providers/LaWallet';
import {Ntag424WriteData} from '../types/response';
import {Skin} from '../types/skin';

// ─── Constants ───────────────────────────────────────────────────────────────

const CardStatus = {
  IDLE: 'idle',
  READING: 'reading',
  CREATING_CARD: 'creating_card',
  WRITING: 'writing',
};

// ─── Skin Card Item ───────────────────────────────────────────────────────────

function SkinItem({
  item,
  selected,
  onPress,
}: {
  item: Skin;
  selected: boolean;
  onPress: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [aspectRatio, setAspectRatio] = useState(1.586); // default card ratio
  const fade = useRef(new Animated.Value(0)).current;

  // Measure the image's natural size so it can be shown in full (no cropping).
  useEffect(() => {
    let active = true;
    const src = item.file;
    if (typeof src === 'string') {
      Image.getSize(
        src,
        (w, h) => {
          if (active && w && h) setAspectRatio(w / h);
        },
        () => {},
      );
    } else {
      const resolved = Image.resolveAssetSource(src);
      if (resolved?.width && resolved?.height) {
        setAspectRatio(resolved.width / resolved.height);
      }
    }
    return () => {
      active = false;
    };
  }, [item.file]);

  return (
    <TouchableOpacity
      style={[styles.skinCard, selected && styles.skinCardSelected]}
      onPress={onPress}
      activeOpacity={0.8}>
      {/* Image */}
      <View style={[styles.skinImageWrap, {aspectRatio}]}>
        {loading && (
          <View style={styles.skinImageSkeleton}>
            <ActivityIndicator size="large" color="#ccc" />
          </View>
        )}
        <Animated.Image
          source={typeof item.file === 'string' ? {uri: item.file} : item.file}
          style={[styles.skinImage, {opacity: fade}]}
          resizeMode="contain"
          onLoadStart={() => {
            setLoading(true);
            fade.setValue(0);
          }}
          onLoad={() => {
            setLoading(false);
            Animated.timing(fade, {
              toValue: 1,
              duration: 300,
              useNativeDriver: true,
            }).start();
          }}
        />
        {/* Selected checkmark overlay */}
        {selected && (
          <View style={styles.skinCheckOverlay}>
            <Ionicons name="checkmark" size={18} color="#fff" />
          </View>
        )}
      </View>
      {/* Name */}
      <View style={styles.skinFooter}>
        <Text style={[styles.skinName, selected && styles.skinNameSelected]}>
          {item.label}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function CreateBulkBoltcardScreen() {
  const [cardData, setCardData] = useState<Ntag424WriteData | undefined>();
  const [cardStatus, setCardStatus] = useState(CardStatus.IDLE);
  const [skin, setSkin] = useState<Skin | undefined>();
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string>();
  const [skinAspect, setSkinAspect] = useState(1.586);

  const [refreshing, setRefreshing] = useState(false);
  const refreshSpin = useRef(new Animated.Value(0)).current;

  const navigation = useNavigation();
  const {isLogged, skins, authFetch, baseUrl, fetchDesigns} = useLaWallet();

  const cancelledByUser = useRef(false);
  // Timestamp of the last scroll event — used to ignore taps mid-scroll.
  const lastScrollTs = useRef(0);

  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    // Spin animation while fetching
    Animated.loop(
      Animated.timing(refreshSpin, {
        toValue: 1,
        duration: 700,
        useNativeDriver: true,
      }),
    ).start();
    try {
      await fetchDesigns();
    } finally {
      setRefreshing(false);
      refreshSpin.stopAnimation();
      refreshSpin.setValue(0);
    }
  }, [refreshing, fetchDesigns, refreshSpin]);

  // Filtered skins list
  const filteredSkins = skins.filter(s =>
    s.label.toLowerCase().includes(search.toLowerCase()),
  );

  // ── Card creation ──────────────────────────────────────────────────────────

  const requestCreateCard = useCallback(
    async (_cardUID: string, _skin: Skin) => {
      setCardStatus(CardStatus.CREATING_CARD);
      setError(undefined);

      ToastAndroid.showWithGravity(
        'Creating card…',
        ToastAndroid.SHORT,
        ToastAndroid.TOP,
      );

      try {
        const createRes = await authFetch('/api/cards', {
          method: 'POST',
          body: JSON.stringify({
            id: _cardUID,
            designId: _skin.value,
            kind: 'SIMPLE',
          }),
        });

        if (!createRes.ok) {
          const raw = await createRes.text().catch(() => '');
          let parsed: any = null;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {}
          const serverMsg = parsed?.message || raw;

          if (createRes.status === 409) {
            // The chip UID is already registered on the server.
            const msg = serverMsg || 'A card with this UID already exists.';
            setError(msg);
            Alert.alert(
              'Card already registered',
              `${msg}\n\nIf you want to re-provision it, wipe the card first.`,
            );
          } else {
            const msg = serverMsg || `Server error ${createRes.status}`;
            setError(msg);
            Alert.alert('Could not create card', msg);
          }
          setCardStatus(CardStatus.IDLE);
          return;
        }

        const createdCard = await createRes.json();
        const cardId: string = createdCard.id;

        let writeData: Ntag424WriteData;
        try {
          const writeRes = await fetch(`${baseUrl}/api/cards/${cardId}/write`);
          if (writeRes.ok) {
            writeData = await writeRes.json();
          } else {
            throw new Error(`write endpoint returned ${writeRes.status}`);
          }
        } catch (writeErr) {
          console.warn('CreateBulk: write endpoint failed, using POST keys', writeErr);
          const ntag = createdCard.ntag424;
          const host = (() => {
            try { return new URL(baseUrl).host; }
            catch { return baseUrl.replace(/^https?:\/\//, '').split('/')[0]; }
          })();
          writeData = {
            card_name: createdCard.title || 'New Card',
            id: ntag.cid,
            k0: ntag.k0, k1: ntag.k1, k2: ntag.k2, k3: ntag.k3, k4: ntag.k4,
            lnurlw_base: `lnurlw://${host}/api/cards/${cardId}/scan`,
            protocol_name: 'new_bolt_card_response',
            protocol_version: '1',
          };
        }

        setCardData(writeData);
        setCardStatus(CardStatus.WRITING);
      } catch (err) {
        if (err instanceof AuthError && err.kind === 'expired') {
          ToastAndroid.showWithGravity(
            'Session expired — re-login on the Login tab',
            ToastAndroid.LONG,
            ToastAndroid.TOP,
          );
        } else {
          const msg = err instanceof Error ? err.message : JSON.stringify(err);
          setError(msg);
          alert(msg);
        }
        setCardStatus(CardStatus.IDLE);
      }
    },
    [authFetch, baseUrl],
  );

  const onReadCard = useCallback(
    (event: any) => {
      const _cardUID = event.id?.toLowerCase();
      if (event.key0Changed) {
        ToastAndroid.showWithGravity(
          'The card is already setup',
          ToastAndroid.SHORT,
          ToastAndroid.TOP,
        );
        return;
      }
      try {
        requestCreateCard(_cardUID, skin!);
      } catch (e: any) {
        alert(e.reason);
        setCardStatus(CardStatus.IDLE);
      }
    },
    [requestCreateCard, skin],
  );

  const startReading = useCallback(async () => {
    cancelledByUser.current = false;
    await NfcManager.start();
    await NfcManager.cancelTechnologyRequest();
    await NfcManager.clearBackgroundTag();
    try {
      await NfcManager.requestTechnology(NfcTech.IsoDep);
      const tag = await NfcManager.getTag();
      onReadCard(tag);
    } catch (e: any) {
      setCardStatus(CardStatus.IDLE);
      // Only surface genuine errors — suppress user-initiated cancels and
      // message-less rejections (which would render a blank "Alert").
      if (!cancelledByUser.current && e?.message) {
        alert(e.message);
      }
      cancelledByUser.current = false;
    }
  }, [onReadCard]);

  // Cancel NFC on tab blur
  useEffect(() => {
    const unsubscribe = navigation.addListener('blur', () => {
      cancelledByUser.current = true;
      setCardStatus(CardStatus.IDLE);
      NfcManager.cancelTechnologyRequest();
    });
    return unsubscribe;
  }, [navigation]);

  // Measure the selected skin image so the bottom preview shows it in full.
  useEffect(() => {
    if (!skin?.file) {
      return;
    }
    let active = true;
    const src = skin.file;
    if (typeof src === 'string') {
      Image.getSize(
        src,
        (w, h) => {
          if (active && w && h) setSkinAspect(w / h);
        },
        () => {},
      );
    } else {
      const resolved = Image.resolveAssetSource(src);
      if (resolved?.width && resolved?.height) {
        setSkinAspect(resolved.width / resolved.height);
      }
    }
    return () => {
      active = false;
    };
  }, [skin]);

  // Drive NFC on status change.
  useEffect(() => {
    switch (cardStatus) {
      case CardStatus.READING:
        // Fresh read: clear any stale card + error, then arm NFC.
        setError(undefined);
        setCardData(undefined);
        startReading();
        break;
      case CardStatus.IDLE:
        // Back to the gallery: drop the card data.
        setCardData(undefined);
        break;
      // CREATING_CARD / WRITING: do NOT touch cardData — the WriteModal needs
      // it for the whole write. Clearing it here (the old `default` branch) is
      // exactly why the real write showed the card but never the progress ring:
      // cardData was reset to undefined the instant WRITING began, so the
      // modal's `{cardData && <ring/>}` rendered nothing while write() ran on.
      default:
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardStatus]);

  // ── Render ─────────────────────────────────────────────────────────────────

  // Build the main content (NFC-waiting vs gallery). The WriteModal is rendered
  // once, OUTSIDE this conditional, so it stays mounted and its progress ring
  // keeps its state across the content switch.
  let content;
  if (cardStatus === CardStatus.READING || cardStatus === CardStatus.CREATING_CARD) {
    const screen = Dimensions.get('window');
    let previewW = screen.width - 32; // ~16px margin each side
    let previewH = previewW / skinAspect;
    const maxH = screen.height * 0.4;
    if (previewH > maxH) {
      previewH = maxH;
      previewW = previewH * skinAspect;
    }
    content = (
      <View style={styles.nfcCenter}>
        <View style={styles.nfcMain}>
          <Animated.View>
            <Ionicons name="wifi-outline" size={80} color="#f58340" style={styles.nfcIcon} />
          </Animated.View>
          <Text style={styles.nfcTitle}>
            {cardStatus === CardStatus.CREATING_CARD ? 'Creating card…' : 'Hold card to phone'}
          </Text>
          {cardStatus === CardStatus.CREATING_CARD && (
            <ActivityIndicator size="small" color="#f58340" style={{marginTop: 8}} />
          )}
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={() => {
              cancelledByUser.current = true;
              NfcManager.cancelTechnologyRequest();
              setCardStatus(CardStatus.IDLE);
            }}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>

        {/* Card being written — bottom preview */}
        {skin && (
          <View style={styles.nfcCardPreview}>
            <Text style={styles.nfcCardCaption}>CARD TO WRITE</Text>
            <View style={styles.nfcCardImageWrap}>
              <Image
                source={
                  typeof skin.file === 'string' ? {uri: skin.file} : skin.file
                }
                style={{width: previewW, height: previewH}}
                resizeMode="contain"
              />
            </View>
            <Text style={styles.nfcCardLabel}>{skin.label}</Text>
          </View>
        )}
      </View>
    );
  } else {
    // Skin gallery (IDLE state)
    content = (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Select Skin</Text>
        <View style={styles.headerActions}>
          {skin && (
            <TouchableOpacity onPress={() => setSkin(undefined)} style={styles.clearBtn}>
              <Text style={styles.clearBtnText}>Clear</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={handleRefresh}
            style={styles.refreshBtn}
            disabled={refreshing}>
            <Animated.View style={{
              transform: [{
                rotate: refreshSpin.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0deg', '360deg'],
                }),
              }],
            }}>
              <Ionicons name="refresh" size={20} color={refreshing ? '#ccc' : '#555'} />
            </Animated.View>
          </TouchableOpacity>
        </View>
      </View>

      {/* Hint */}
      <Text style={styles.headerHint}>Tap a card to select it</Text>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={16} color="#aaa" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search skins…"
          placeholderTextColor="#aaa"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={16} color="#aaa" />
          </TouchableOpacity>
        )}
      </View>

      {/* Error banner */}
      {error && (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle-outline" size={14} color="#fff" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Skin list */}
      <ScrollView
        style={styles.list}
        contentContainerStyle={[
          styles.listContent,
          // Extra bottom padding when action bar is visible
          skin ? {paddingBottom: 90} : {paddingBottom: 20},
        ]}
        scrollEventThrottle={16}
        onScroll={() => {
          lastScrollTs.current = Date.now();
        }}
        keyboardShouldPersistTaps="handled">
        {filteredSkins.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Ionicons name="images-outline" size={40} color="#ccc" />
            <Text style={styles.emptyText}>No skins found</Text>
          </View>
        ) : (
          filteredSkins.map(item => (
            <SkinItem
              key={item.value}
              item={item}
              selected={skin?.value === item.value}
              onPress={() => {
                // Ignore taps that land during or right after a scroll gesture.
                if (Date.now() - lastScrollTs.current > 150) {
                  setSkin(item);
                }
              }}
            />
          ))
        )}
      </ScrollView>

      {/* Sticky action bar */}
      {skin && (
        <View style={styles.actionBar}>
          <TouchableOpacity
            style={styles.tapCardBtn}
            onPress={() => setCardStatus(CardStatus.READING)}
            activeOpacity={0.85}>
            <Ionicons name="wifi-outline" size={20} color="#fff" style={styles.nfcIcon} />
            <Text style={styles.tapCardBtnText}>Tap Card to Write</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
    );
  }

  return (
    <View style={{flex: 1}}>
      {content}
      <WriteModal
        visible={cardStatus === CardStatus.WRITING}
        onCancel={() => setCardStatus(CardStatus.IDLE)}
        onSuccess={() => setCardStatus(CardStatus.READING)}
        cardData={cardData}
        skin={skin}
      />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#f2f2f2'},

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#111',
  },
  headerHint: {
    fontSize: 12,
    color: '#999',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  clearBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#eee',
  },
  clearBtnText: {fontSize: 13, color: '#555'},
  refreshBtn: {
    padding: 8,
    borderRadius: 8,
  },

  // Search
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: {width: 0, height: 2},
  },
  searchIcon: {},
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#222',
    paddingVertical: 0,
  },

  // Error
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#c0392b',
    marginHorizontal: 16,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  errorText: {fontSize: 13, color: '#fff', flex: 1},

  // List
  list: {flex: 1},
  listContent: {paddingHorizontal: 16, gap: 12},
  emptyWrap: {alignItems: 'center', paddingTop: 60, gap: 12},
  emptyText: {fontSize: 14, color: '#bbb'},

  // Skin card
  skinCard: {
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#fff',
    borderWidth: 2.5,
    borderColor: 'transparent',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: {width: 0, height: 3},
  },
  skinCardSelected: {
    borderColor: '#f58340',
  },
  skinImageWrap: {
    width: '100%',
    backgroundColor: '#e8e8e8',
  },
  skinImageSkeleton: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#e8e8e8',
  },
  skinImage: {width: '100%', height: '100%'},
  skinCheckOverlay: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(245,131,64,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  skinFooter: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  skinName: {fontSize: 14, fontWeight: '600', color: '#333'},
  skinNameSelected: {color: '#f58340'},

  // Sticky action bar
  actionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    backgroundColor: '#f2f2f2',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ddd',
  },
  tapCardBtn: {
    backgroundColor: '#f58340',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    borderRadius: 12,
  },
  tapCardBtnText: {color: '#fff', fontWeight: 'bold', fontSize: 17},

  // NFC waiting screen
  nfcCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 40,
    paddingBottom: 28,
    backgroundColor: '#f2f2f2',
  },
  nfcMain: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  nfcCardPreview: {
    alignItems: 'center',
    gap: 10,
  },
  nfcCardCaption: {
    fontSize: 12,
    fontWeight: '600',
    color: '#999',
    letterSpacing: 1,
  },
  nfcCardImageWrap: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#fff',
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: {width: 0, height: 3},
  },
  nfcCardLabel: {fontSize: 15, fontWeight: '600', color: '#333'},
  nfcIcon: {transform: [{rotate: '90deg'}]},
  nfcTitle: {fontSize: 20, fontWeight: 'bold', color: '#333', textAlign: 'center'},
  cancelBtn: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  cancelBtnText: {fontSize: 14, color: '#666'},
});
