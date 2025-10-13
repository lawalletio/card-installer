import React, {createContext, useContext, useState} from 'react';
import {Skin} from '../types/skin';
import {skins as skinsFile} from '../constants/skins';
import {LoginResponse} from '../types/response';

const LaWalletContext = createContext<{
  isLogged: boolean;
  login: (apiEndpoint: string) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
  apiEndpoint: string;
  skins: Skin[];
  lnurlwBase: string;
}>({
  isLogged: false,
  login: async () => {},
  logout: () => {},
  isLoading: false,
  apiEndpoint: '',
  skins: [],
  lnurlwBase: '',
});

export const LaWalletProvider = ({children}) => {
  const [isLogged, setIsLogged] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [apiEndpoint, setApiEndpoint] = useState('');
  const [skins, setSkins] = useState<Skin[]>([]);
  const [lnurlwBase, setLnurlwBase] = useState<string>('');

  const login = async (_apiEndpoint: string) => {
    setIsLoading(true);

    try {
      const {skins: _skins, lnurlwBase: _lnurlwBase} = await mockEndpoint();
      setApiEndpoint(_apiEndpoint);
      setSkins(_skins);
      setLnurlwBase(_lnurlwBase);
      setIsLogged(true);
    } catch (error) {
      logout();
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    setIsLogged(false);
    setApiEndpoint('');
    setLnurlwBase('');
    setSkins([]);
  };

  return (
    <LaWalletContext.Provider
      value={{
        isLogged,
        login,
        logout,
        isLoading,
        apiEndpoint,
        skins,
        lnurlwBase,
      }}>
      {children}
    </LaWalletContext.Provider>
  );
};

async function mockEndpoint(): Promise<LoginResponse> {
  return new Promise((resolve: (value: LoginResponse) => void) => {
    setTimeout(() => {
      resolve({
        skins: skinsFile,
        lnurlwBase: 'https://lnurlw.ar',
      });
    }, 1000);
  });
}

export const useLaWallet = () => useContext(LaWalletContext);
