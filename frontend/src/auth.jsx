import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { authApi, refreshSession, setAccessToken } from './api.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const clear = useCallback(() => { setAccessToken(null); setUser(null); }, []);

  // On page load there is no access token in memory; try to restore the session from the refresh cookie.
  useEffect(() => {
    refreshSession().then((r) => setUser(r.user)).catch(clear).finally(() => setLoading(false));
  }, [clear]);

  // Fired by api.js when a refresh fails (session expired, revoked, user deactivated).
  useEffect(() => {
    window.addEventListener('auth:expired', clear);
    return () => window.removeEventListener('auth:expired', clear);
  }, [clear]);

  const login = async (email, password) => {
    const r = await authApi.login(email, password);
    setUser(r.user);
  };

  const logout = async () => {
    try { await authApi.logout(); } catch { /* server unreachable: still end the local session */ }
    clear();
  };

  const hasRole = (...roles) => !!user && roles.includes(user.role);

  return <AuthContext.Provider value={{ user, loading, login, logout, hasRole }}>{children}</AuthContext.Provider>;
}
