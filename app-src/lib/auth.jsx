import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);

  // Sessions live in HttpOnly cookies we can't read from JS, so we always ask
  // the server once on mount. A 401 simply means signed-out.
  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((data) => !cancelled && setAccount(data))
      .catch(() => !cancelled && setAccount(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await api.login(email, password);
    setAccount(data);
    return data;
  }, []);

  // Returns { requiresVerification } so the UI can show a "check your inbox"
  // notice. Only sets the account when the server logged us straight in
  // (email confirmation disabled).
  const signup = useCallback(async (email, password) => {
    const data = await api.signup(email, password);
    if (data && data.requiresVerification === false) setAccount(data);
    return data;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* clear locally regardless */
    }
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
