import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {Skin} from '../types/skin';
import {CardDesign} from '../types/response';
import {skins as skinsFile} from '../constants/skins';
import {decodeJwt, isExpired, isJwtFormat} from '../lib/jwt';
import type {DeviceJwtClaims} from '../lib/jwt';
import SecureStorage, {STORAGE_KEYS} from '../lib/secureStorage';

export class AuthError extends Error {
  kind: 'no-token' | 'expired';
  constructor(kind: 'no-token' | 'expired') {
    super(kind === 'expired' ? 'Session token expired' : 'No auth token');
    this.kind = kind;
  }
}

function normalizeBaseUrl(url: string): string {
  let u = url.trim();
  if (!u) return '';
  if (!u.startsWith('http://') && !u.startsWith('https://')) {
    u = 'https://' + u;
  }
  return u.replace(/\/+$/, '');
}

function extractHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0];
  }
}

interface LaWalletContextType {
  isLogged: boolean;
  isLoading: boolean;
  baseUrl: string;
  jwt: string | null;
  claims: DeviceJwtClaims | null;
  pubkey: string | null;
  scopes: string[];
  exp: number | null;
  tokenError: 'expired' | 'invalid' | null;
  skins: Skin[];
  lnurlwBase: string;
  setBaseUrl: (url: string) => Promise<void>;
  loginWithToken: (
    token: string,
  ) => Promise<{ok: boolean; reason?: 'invalid' | 'expired'}>;
  logout: () => Promise<void>;
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
  fetchDesigns: () => Promise<void>;
  hasScope: (scope: string) => boolean;
}

const LaWalletContext = createContext<LaWalletContextType>({
  isLogged: false,
  isLoading: true,
  baseUrl: '',
  jwt: null,
  claims: null,
  pubkey: null,
  scopes: [],
  exp: null,
  tokenError: null,
  skins: skinsFile,
  lnurlwBase: '',
  setBaseUrl: async () => {},
  loginWithToken: async () => ({ok: false, reason: 'invalid'}),
  logout: async () => {},
  authFetch: async () => {
    throw new AuthError('no-token');
  },
  fetchDesigns: async () => {},
  hasScope: () => false,
});

export const LaWalletProvider = ({children}: {children: React.ReactNode}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [baseUrl, setBaseUrlSt] = useState('https://beta.lawallet.io');
  const [jwt, setJwtSt] = useState<string | null>(null);
  const [claims, setClaimsSt] = useState<DeviceJwtClaims | null>(null);
  const [tokenError, setTokenError] = useState<'expired' | 'invalid' | null>(
    null,
  );
  const [skins, setSkins] = useState<Skin[]>(skinsFile);

  // Refs keep the latest values accessible in stable callbacks without
  // recreating them on every state change.
  const jwtRef = useRef<string | null>(null);
  const baseUrlRef = useRef<string>('https://beta.lawallet.io');
  const claimsRef = useRef<DeviceJwtClaims | null>(null);

  // Helpers that keep refs and state in sync.
  const applyJwt = useCallback(
    (token: string | null, decoded: DeviceJwtClaims | null) => {
      jwtRef.current = token;
      claimsRef.current = decoded;
      setJwtSt(token);
      setClaimsSt(decoded);
    },
    [],
  );

  const applyBaseUrl = useCallback((url: string) => {
    baseUrlRef.current = url;
    setBaseUrlSt(url);
  }, []);

  // Hydrate from secure storage on mount.
  useEffect(() => {
    (async () => {
      try {
        const [storedUrl, storedToken] = await Promise.all([
          SecureStorage.getItem(STORAGE_KEYS.BASE_URL),
          SecureStorage.getItem(STORAGE_KEYS.DEVICE_TOKEN),
        ]);
        if (storedUrl) applyBaseUrl(storedUrl);
        if (storedToken) {
          const decoded = decodeJwt(storedToken);
          if (decoded && !isExpired(decoded)) {
            applyJwt(storedToken, decoded);
          } else {
            // Keep the base URL but drop the stale token.
            await SecureStorage.removeItem(STORAGE_KEYS.DEVICE_TOKEN);
            if (storedToken) setTokenError('expired');
          }
        }
      } catch (e) {
        console.error('LaWallet: hydration error', e);
      } finally {
        setIsLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stable authenticated fetch — reads from refs so it never goes stale.
  const authFetch = useCallback(
    async (path: string, init: RequestInit = {}): Promise<Response> => {
      const token = jwtRef.current;
      if (!token) throw new AuthError('no-token');
      const url = baseUrlRef.current + path;
      const mergedHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...((init.headers as Record<string, string>) || {}),
      };
      const res = await fetch(url, {...init, headers: mergedHeaders});
      if (res.status === 401) {
        jwtRef.current = null;
        claimsRef.current = null;
        setJwtSt(null);
        setClaimsSt(null);
        setTokenError('expired');
        SecureStorage.removeItem(STORAGE_KEYS.DEVICE_TOKEN).catch(() => {});
        throw new AuthError('expired');
      }
      return res;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Fetch designs from the API, falling back to the hardcoded list on any error.
  const fetchDesigns = useCallback(async () => {
    const currentScopes = claimsRef.current?.scopes ?? [];
    if (!currentScopes.includes('card_designs:read')) {
      setSkins(skinsFile);
      return;
    }
    try {
      const res = await authFetch('/api/card-designs/list');
      if (res.ok) {
        const designs: CardDesign[] = await res.json();
        const mapped: Skin[] = designs
          .filter(d => !d.archivedAt)
          .map(d => ({label: d.description, value: d.id, file: d.imageUrl}));
        setSkins(mapped.length > 0 ? mapped : skinsFile);
      } else {
        setSkins(skinsFile);
      }
    } catch {
      setSkins(skinsFile);
    }
  }, [authFetch]);

  const setBaseUrl = useCallback(
    async (url: string) => {
      const normalized = normalizeBaseUrl(url);
      applyBaseUrl(normalized);
      if (normalized) {
        await SecureStorage.setItem(STORAGE_KEYS.BASE_URL, normalized);
      }
    },
    [applyBaseUrl],
  );

  const loginWithToken = useCallback(
    async (
      token: string,
    ): Promise<{ok: boolean; reason?: 'invalid' | 'expired'}> => {
      if (!isJwtFormat(token)) return {ok: false, reason: 'invalid'};
      const decoded = decodeJwt(token);
      if (!decoded) return {ok: false, reason: 'invalid'};
      if (isExpired(decoded)) return {ok: false, reason: 'expired'};

      // Update refs first so authFetch (used by fetchDesigns) sees the new token.
      applyJwt(token, decoded);
      setTokenError(null);
      SecureStorage.setItem(STORAGE_KEYS.DEVICE_TOKEN, token).catch(() => {});

      // Non-blocking; refs are already updated so authFetch has the right token.
      fetchDesigns().catch(() => {});

      return {ok: true};
    },
    [applyJwt, fetchDesigns],
  );

  const logout = useCallback(async () => {
    applyJwt(null, null);
    setTokenError(null);
    setSkins(skinsFile);
    await SecureStorage.removeItem(STORAGE_KEYS.DEVICE_TOKEN).catch(() => {});
    // Keep baseUrl persisted so the operator doesn't have to re-enter it.
  }, [applyJwt]);

  const hasScope = useCallback(
    (scope: string): boolean => (claims?.scopes ?? []).includes(scope),
    [claims],
  );

  const isLogged = !!jwt && !isExpired(claims);
  const pubkey = claims?.pubkey ?? null;
  const scopes = claims?.scopes ?? [];
  const exp = claims?.exp ?? null;
  const lnurlwBase = baseUrl ? `lnurlw://${extractHost(baseUrl)}` : '';

  const value = useMemo<LaWalletContextType>(
    () => ({
      isLogged,
      isLoading,
      baseUrl,
      jwt,
      claims,
      pubkey,
      scopes,
      exp,
      tokenError,
      skins,
      lnurlwBase,
      setBaseUrl,
      loginWithToken,
      logout,
      authFetch,
      fetchDesigns,
      hasScope,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      isLogged,
      isLoading,
      baseUrl,
      jwt,
      claims,
      tokenError,
      skins,
      setBaseUrl,
      loginWithToken,
      logout,
      authFetch,
      fetchDesigns,
      hasScope,
    ],
  );

  return (
    <LaWalletContext.Provider value={value}>
      {children}
    </LaWalletContext.Provider>
  );
};

export const useLaWallet = () => useContext(LaWalletContext);
