/* eslint-disable react-native/no-inline-styles */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {useNavigation} from '@react-navigation/native';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {Card, ProgressBar, Title} from 'react-native-paper';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {useLaWallet} from '../providers/LaWallet';
import {secondsUntilExpiry} from '../lib/jwt';

function formatCountdown(secs: number): string {
  if (secs <= 0) return 'expired';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function LoginScreen({route}) {
  const {
    baseUrl,
    setBaseUrl,
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

  // Local state for the base URL text input (not persisted until Save).
  const [urlInput, setUrlInput] = useState(baseUrl);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sync text input when baseUrl changes (e.g. on hydration).
  useEffect(() => {
    setUrlInput(baseUrl);
  }, [baseUrl]);

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

  const handleSaveUrl = useCallback(async () => {
    await setBaseUrl(urlInput);
  }, [setBaseUrl, urlInput]);

  const handleLogout = useCallback(() => logout(), [logout]);

  const shortPubkey = pubkey
    ? `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`
    : '';

  return (
    <View style={{flex: 1}}>
    <ScrollView>
      {/* Base URL configuration */}
      <Card style={styles.card}>
        <Card.Content>
          <Title>LaWallet backend</Title>
          <Text style={styles.label}>Base URL</Text>
          <View style={styles.row}>
            <TextInput
              style={styles.urlInput}
              value={urlInput}
              onChangeText={setUrlInput}
              placeholder="https://beta.lawallet.io"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <TouchableOpacity style={styles.saveBtn} onPress={handleSaveUrl}>
              <Text style={styles.saveBtnText}>Save</Text>
            </TouchableOpacity>
          </View>
        </Card.Content>
      </Card>

      {/* Auth status */}
      <Card style={styles.card}>
        <Card.Content>
          <Title>Session</Title>

          {/* Expired banner */}
          {tokenError === 'expired' && !isLogged && (
            <View style={styles.banner}>
              <Ionicons name="warning" size={16} color="#fff" />
              <Text style={styles.bannerText}>
                {' '}Session expired — scan a new token
              </Text>
            </View>
          )}

          {isLoading ? (
            <Text>Loading…</Text>
          ) : isLogged ? (
            <>
              <View style={styles.infoRow}>
                <Ionicons name="checkmark-circle" size={18} color="green" />
                <Text style={styles.infoText}> Logged in</Text>
              </View>
              <Text style={styles.detail}>Pubkey: {shortPubkey}</Text>
              <Text style={styles.detail}>Scopes: {scopes.join(', ') || '—'}</Text>
              <Text style={styles.detail}>
                Expires in: {formatCountdown(countdown)}
              </Text>
              <TouchableOpacity style={styles.button} onPress={handleLogout}>
                <Text style={styles.buttonText}>
                  <Ionicons name="log-out" size={18} color="white" /> Logout
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.detail}>Not logged in</Text>
              <TouchableOpacity
                style={[styles.button, !baseUrl && styles.buttonDisabled]}
                onPress={handleScan}
                disabled={!baseUrl}>
                <Text style={styles.buttonText}>
                  <Ionicons name="qr-code" size={18} color="white" /> Scan device token
                </Text>
              </TouchableOpacity>
              {!baseUrl && (
                <Text style={styles.hint}>Set the base URL above first.</Text>
              )}
            </>
          )}
        </Card.Content>
      </Card>
    </ScrollView>

      {isLoggingIn && (
        <View style={styles.loginOverlay}>
          <Text style={styles.loginOverlayTitle}>Logging in…</Text>
          <ProgressBar indeterminate color="#1976D2" style={styles.loginProgressBar} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: 12,
    marginTop: 10,
    marginHorizontal: 10,
  },
  label: {
    fontSize: 13,
    color: '#555',
    marginBottom: 4,
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  urlInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 14,
  },
  saveBtn: {
    backgroundColor: '#555',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  saveBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 13,
  },
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
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
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
  hint: {
    fontSize: 12,
    color: '#888',
    marginTop: 6,
  },
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
  button: {
    backgroundColor: 'rgb(0,122,255)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 10,
  },
  buttonDisabled: {
    backgroundColor: '#aaa',
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 14,
  },
});
