import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  // A stored token may be expired or minted by an older deploy; treat any
  // failure as signed-out rather than trapping the user on a spinner.
  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;

    api
      .me()
      .then((data) => !cancelled && setAccount(data))
      .catch(() => setToken(null))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await api.login(email, password);
    setToken(data.token);
    setAccount(data);
  }, []);

  const signup = useCallback(async (email, password) => {
    const data = await api.signup(email, password);
    setToken(data.token);
    setAccount(data);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setAccount(null);
  }, []);

  return (
    <AuthContext.Provider value={{ account, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
