import React, { createContext, useContext, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { authService, authConfigurationError } from './client';
import { authErrorMessage, type AuthUser } from '../services/authService';
const AuthContext = createContext<{ user: AuthUser | null; ready: boolean; error: string; configured: boolean; service: typeof authService } | null>(null);
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(authConfigurationError);
  useEffect(() => {
    let mounted = true, revision = 0;
    const unsubscribe = authService.subscribe(next => {
      revision += 1;
      if (mounted) { setUser(next); setReady(true); setError(authConfigurationError); }
    });
    const initialRevision = revision;
    authService.restore().then(next => {
      if (mounted && revision === initialRevision) setUser(next);
    }).catch(failure => { if (mounted && revision === initialRevision) setError(authErrorMessage(failure)); })
      .finally(() => { if (mounted) setReady(true); });
    const refresh = (state: string) => state === 'active' ? authService.startRefresh() : authService.stopRefresh();
    if (Platform.OS !== 'web') refresh(AppState.currentState);
    const subscription = Platform.OS !== 'web' ? AppState.addEventListener('change', refresh) : null;
    return () => { mounted = false; unsubscribe(); subscription?.remove(); if (Platform.OS !== 'web') authService.stopRefresh(); };
  }, []);
  return <AuthContext.Provider value={{ user, ready, error, configured: authService.configured, service: authService }}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider is required');
  return context;
}
