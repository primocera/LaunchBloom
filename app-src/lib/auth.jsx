import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';
import { microcopy } from './microcopy';

const AuthContext = createContext(null);

// v13 SC-P0-01: how many times /api/auth/me is retried when the SERVER says it
// could not verify the plan (503 PLAN_UNAVAILABLE). Bounded on purpose — the
// user gets an explicit retry action instead of an indefinite spinner.
const PLAN_RETRIES = 1;
const PLAN_RETRY_DELAY_MS = 1500;

export function AuthProvider({ children }) {
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  // Set when entitlement verification is unavailable. It NEVER downgrades the
  // account we already hold — access is preserved until a retry succeeds.
  const [planUnavailable, setPlanUnavailable] = useState(null);

  // Sessions live in HttpOnly cookies we can't read from JS, so we always ask
  // the server once on mount. A 401 simply means signed-out.
  const refresh = useCallback(async (attempt = 0) => {
    setLoading(true);
    try {
      const data = await api.me();
      setAccount(data);
      setPlanUnavailable(null);
      return data;
    } catch (err) {
      if (err && err.code === 'PLAN_UNAVAILABLE') {
        if (attempt < PLAN_RETRIES) {
          await new Promise((r) => setTimeout(r, PLAN_RETRY_DELAY_MS));
          // `await` (not a bare `return`) so THIS call's `finally` — which flips
          // loading back to false — does not run until the retry has resolved
          // and set planUnavailable. Without it, loading briefly reads false
          // while planUnavailable is still null, and the guard bounces a
          // still-signed-in user to /app/login on a transient plan-read outage.
          return await refresh(attempt + 1);
        }
        // Keep whatever account state we already have — do not sign the user
        // out and do not render them as Free because of a lookup failure.
        setPlanUnavailable(err.userMessage || microcopy('plan_unavailable'));
        return null;
      }
      setAccount(null);
      setPlanUnavailable(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    refresh().finally(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const login = useCallback(async (email, password) => {
    const data = await api.login(email, password);
    setAccount(data);
    return data;
  }, []);

  // Returns { requiresVerification } so the UI can show a "check your inbox"
  // notice. Only sets the account when the server logged us straight in
  // (email confirmation disabled).
  const signup = useCallback(async (email, password, acceptTerms, marketingOptIn) => {
    const data = await api.signup(email, password, acceptTerms, marketingOptIn);
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
    <AuthContext.Provider
      value={{ account, loading, login, signup, logout, planUnavailable, retryPlan: () => refresh(PLAN_RETRIES) }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
