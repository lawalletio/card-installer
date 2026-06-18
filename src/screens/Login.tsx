/* eslint-disable react-native/no-inline-styles */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {useNavigation} from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  NativeModules,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {Card, ProgressBar, Title} from 'react-native-paper';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {useLaWallet} from '../providers/LaWallet';
import {secondsUntilExpiry} from '../lib/jwt';
import type {InstanceSettings} from '../types/response';

// App version from the native BuildConfig (exposed by MyReactModule), with a
// package.json fallback so something always shows.
const APP_VERSION = (() => {
  const mod = (NativeModules as any).MyReactModule;
  const name = mod?.versionName ?? require('../../package.json').version;
  const code = mod?.versionCode;
  return code != null ? `v${name} (build ${code})` : `v${name}`;
})();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCountdown(secs: number): string {
  if (secs <= 0) return 'expired';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ─── Instance Hero Card ───────────────────────────────────────────────────────

const AVATAR_SIZE = 112;
const AVATAR_HALF = AVATAR_SIZE / 2;

/** Pulsing skeleton shown while settings are loading. */
function HeroSkeleton() {
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {toValue: 0.9, duration: 750, useNativeDriver: true}),
        Animated.timing(pulse, {toValue: 0.4, duration: 750, useNativeDriver: true}),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);

  return (
    <View style={styles.heroWrapper}>
      <View style={styles.heroCover}>
        <View style={styles.heroBg} />
        <View style={styles.heroContent}>
          <Animated.View style={[styles.skelTitle, {opacity: pulse}]} />
          <View style={styles.heroPills}>
            <Animated.View style={[styles.skelPill, {opacity: pulse}]} />
            <Animated.View style={[styles.skelPill, {opacity: pulse, width: 140}]} />
          </View>
        </View>
      </View>
      {/* Avatar circle skeleton */}
      <View style={styles.heroAvatarRow}>
        <Animated.View style={[styles.heroAvatarCircle, styles.skelAvatar, {opacity: pulse}]}>
          <ActivityIndicator size="small" color="#bbb" />
        </Animated.View>
      </View>
    </View>
  );
}

/** Loaded hero card with entrance animation. */
function InstanceHero({settings}: {settings: InstanceSettings}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(12)).current;
  const [avatarLoading, setAvatarLoading] = useState(true);
  const avatarFade = useRef(new Animated.Value(0)).current;

  // Entrance animation on mount
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {toValue: 1, duration: 400, useNativeDriver: true}),
      Animated.timing(slideAnim, {toValue: 0, duration: 400, useNativeDriver: true}),
    ]).start();
  }, [fadeAnim, slideAnim]);

  return (
    <Animated.View style={[
      styles.heroWrapper,
      {opacity: fadeAnim, transform: [{translateY: slideAnim}]},
    ]}>
      {/* Black cover */}
      <View style={styles.heroCover}>
        <View style={styles.heroBg} />
        <View style={styles.heroContent}>
          <Text style={styles.heroName}>{settings.community_name}</Text>
          <View style={styles.heroPills}>
            <View style={styles.heroPill}>
              <Ionicons name="globe-outline" size={11} color="rgba(255,255,255,0.75)" />
              <Text style={styles.heroPillText}>{settings.domain}</Text>
            </View>
            <View style={styles.heroPill}>
              <Ionicons name="server-outline" size={11} color="rgba(255,255,255,0.75)" />
              <Text style={styles.heroPillText} numberOfLines={1}>
                {settings.endpoint.replace(/^https?:\/\//, '')}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Avatar — centred, half above the cover */}
      <View style={styles.heroAvatarRow}>
        <View style={styles.heroAvatarCircle}>
          {/* Spinner while image loads */}
          {avatarLoading && (
            <View style={styles.heroAvatarSpinner}>
              <ActivityIndicator size="small" color="#bbb" />
            </View>
          )}
          {settings.isotypo_url ? (
            <Animated.Image
              source={{uri: settings.isotypo_url}}
              style={[styles.heroAvatarImg, {opacity: avatarFade}]}
              resizeMode="contain"
              onLoadStart={() => {
                setAvatarLoading(true);
                avatarFade.setValue(0);
              }}
              onLoad={() => {
                setAvatarLoading(false);
                Animated.timing(avatarFade, {
                  toValue: 1,
                  duration: 350,
                  useNativeDriver: true,
                }).start();
              }}
            />
          ) : (
            <Ionicons name="globe" size={48} color="#888" />
          )}
        </View>
      </View>
    </Animated.View>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function LoginScreen({route}) {
  const {
    baseUrl,
    loginWithToken,
    logout,
    isLogged,
    isLoading,
    pubkey,
    scopes,
    claims,
    tokenError,
  } = useLaWallet();

  const navigation = useNavigation();
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [instanceSettings, setInstanceSettings] =
    useState<InstanceSettings | null>(null);

  // Fetch instance settings when logged in
  const [settingsLoading, setSettingsLoading] = useState(false);
  useEffect(() => {
    if (!isLogged || !baseUrl) {
      setInstanceSettings(null);
      return;
    }
    setSettingsLoading(true);
    fetch(`${baseUrl}/api/settings`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => setInstanceSettings(data))
      .catch(() => {})
      .finally(() => setSettingsLoading(false));
  }, [isLogged, baseUrl]);

  // Expiry countdown ticker.
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (!isLogged || !claims) {
      setCountdown(0);
      return;
    }
    setCountdown(secondsUntilExpiry(claims));
    intervalRef.current = setInterval(() => {
      setCountdown(secondsUntilExpiry(claims));
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isLogged, claims]);

  // Receive QR scan result and attempt login.
  const {data: qrData, timestamp} = route.params || {};
  useEffect(() => {
    if (!qrData?.raw || !timestamp) return;
    (async () => {
      setIsLoggingIn(true);
      try {
        const res = await loginWithToken(qrData.raw);
        if (!res.ok) {
          Alert.alert(
            'Login failed',
            res.reason === 'expired'
              ? 'Token is already expired — ask the admin for a fresh QR.'
              : 'That QR is not a valid device token.',
          );
        }
      } finally {
        setIsLoggingIn(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrData, timestamp]);

  const handleScan = useCallback(() => {
    (navigation as any).navigate('ScanScreenLogin', {
      backScreen: 'LoginScreen',
      mode: 'raw',
    });
  }, [navigation]);

  const handleLogout = useCallback(() => logout(), [logout]);

  const shortPubkey = pubkey
    ? `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`
    : '';

  return (
    <View style={{flex: 1}}>
      <ScrollView contentContainerStyle={styles.scrollContent}>

        {/* ── Logged-in view ── */}
        {isLogged ? (
          <>
            {/* Instance hero — skeleton while loading, card when ready */}
            {settingsLoading && !instanceSettings && <HeroSkeleton />}
            {instanceSettings && <InstanceHero settings={instanceSettings} />}

            {/* Session card */}
            <Card style={styles.card}>
              <Card.Content>
                <Title>Session</Title>
                <View style={styles.infoRow}>
                  <Ionicons name="checkmark-circle" size={18} color="green" />
                  <Text style={styles.infoText}> Logged in</Text>
                </View>
                <Text style={styles.detail}>Pubkey: {shortPubkey}</Text>
                <Text style={styles.detail}>
                  Scopes: {scopes.join(', ') || '—'}
                </Text>
                <Text style={styles.detail}>
                  Expires in: {formatCountdown(countdown)}
                </Text>
                <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
                  <Ionicons name="log-out" size={16} color="#c0392b" />
                  <Text style={styles.logoutBtnText}>Logout</Text>
                </TouchableOpacity>
              </Card.Content>
            </Card>
          </>
        ) : (
          <>
            {/* ── Logged-out view ── */}
            {isLoading ? null : (
              <Card style={styles.card}>
                <Card.Content>
                  <Title>Session</Title>

                  {tokenError === 'expired' && (
                    <View style={styles.banner}>
                      <Ionicons name="warning" size={16} color="#fff" />
                      <Text style={styles.bannerText}>
                        {' '}Session expired — scan a new token
                      </Text>
                    </View>
                  )}

                  <View style={styles.instructionsBox}>
                    <Text style={styles.instructionsTitle}>
                      How to get your device token
                    </Text>
                    <View style={styles.instructionStep}>
                      <Text style={styles.instructionNum}>1</Text>
                      <Text style={styles.instructionText}>
                        Log in to your LaWallet instance as admin{'\n'}
                        <Text style={styles.instructionUrl}>
                          e.g. beta.lawallet.io
                        </Text>
                      </Text>
                    </View>
                    <View style={styles.instructionStep}>
                      <Text style={styles.instructionNum}>2</Text>
                      <Text style={styles.instructionText}>
                        Go to{' '}
                        <Text style={styles.instructionBold}>
                          Settings → Device Token
                        </Text>
                      </Text>
                    </View>
                    <View style={styles.instructionStep}>
                      <Text style={styles.instructionNum}>3</Text>
                      <Text style={styles.instructionText}>
                        Tap{' '}
                        <Text style={styles.instructionBold}>
                          Generate token
                        </Text>{' '}
                        and scan the QR with this app
                      </Text>
                    </View>
                  </View>

                  <TouchableOpacity style={styles.scanBtn} onPress={handleScan}>
                    <Ionicons name="qr-code" size={22} color="white" />
                    <Text style={styles.scanBtnText}>Scan device token</Text>
                  </TouchableOpacity>
                </Card.Content>
              </Card>
            )}
          </>
        )}

        <Text style={styles.versionText}>{APP_VERSION}</Text>
      </ScrollView>

      {isLoggingIn && (
        <View style={styles.loginOverlay}>
          <Text style={styles.loginOverlayTitle}>Logging in…</Text>
          <ProgressBar
            indeterminate
            color="#1976D2"
            style={styles.loginProgressBar}
          />
        </View>
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: 24,
  },
  versionText: {
    textAlign: 'center',
    color: '#9aa0a6',
    fontSize: 12,
    marginTop: 16,
    marginBottom: 8,
  },

  // ── Instance hero ──
  heroWrapper: {
    marginHorizontal: 10,
    marginTop: AVATAR_HALF + 10, // space above for avatar overflow
    marginBottom: 4,
    position: 'relative',
  },
  heroCover: {
    backgroundColor: '#111',
    borderRadius: 16,
    overflow: 'hidden',
    paddingTop: AVATAR_HALF + 14, // clears the avatar
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  heroBg: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: '#2a2a2a',
    top: -100,
    right: -80,
  },
  heroAvatarRow: {
    position: 'absolute',
    top: -AVATAR_HALF,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  heroAvatarCircle: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_HALF,
    backgroundColor: '#fff',
    borderWidth: 4,
    borderColor: '#f2f2f2', // matches page background
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  heroAvatarImg: {
    width: AVATAR_SIZE - 16,
    height: AVATAR_SIZE - 16,
    borderRadius: (AVATAR_SIZE - 16) / 2,
  },
  heroAvatarSpinner: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Skeleton elements
  skelAvatar: {
    backgroundColor: '#333',
  },
  skelTitle: {
    height: 24,
    width: 160,
    borderRadius: 6,
    backgroundColor: '#333',
    marginBottom: 4,
  },
  skelPill: {
    height: 24,
    width: 100,
    borderRadius: 20,
    backgroundColor: '#333',
  },
  heroContent: {
    alignItems: 'center',
    gap: 10,
  },
  heroName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  heroPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
  },
  heroPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#2a2a2a',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  heroPillText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.8)',
    fontFamily: 'monospace',
  },

  // ── Session card ──
  card: {
    marginBottom: 12,
    marginTop: 10,
    marginHorizontal: 10,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    marginTop: 4,
  },
  infoText: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#222',
  },
  detail: {
    fontSize: 13,
    color: '#444',
    marginBottom: 4,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#c0392b',
    alignSelf: 'flex-start',
  },
  logoutBtnText: {
    color: '#c0392b',
    fontWeight: 'bold',
    fontSize: 14,
  },

  // ── Instructions ──
  instructionsBox: {
    backgroundColor: '#f0f4ff',
    borderRadius: 8,
    padding: 12,
    marginBottom: 14,
    gap: 10,
  },
  instructionsTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  instructionStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  instructionNum: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#1976D2',
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
    textAlign: 'center',
    lineHeight: 20,
    overflow: 'hidden',
  },
  instructionText: {
    flex: 1,
    fontSize: 13,
    color: '#444',
    lineHeight: 18,
  },
  instructionBold: {
    fontWeight: 'bold',
    color: '#222',
  },
  instructionUrl: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#1976D2',
  },

  // ── Scan button ──
  scanBtn: {
    backgroundColor: 'rgb(0,122,255)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    borderRadius: 10,
    marginTop: 4,
  },
  scanBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 17,
  },

  // ── Banner ──
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#c0392b',
    borderRadius: 6,
    padding: 8,
    marginBottom: 10,
  },
  bannerText: {
    color: '#fff',
    fontWeight: 'bold',
  },

  // ── Loading overlay ──
  loginOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 40,
  },
  loginOverlayTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  loginProgressBar: {
    width: '100%',
    height: 6,
    borderRadius: 3,
  },
});
