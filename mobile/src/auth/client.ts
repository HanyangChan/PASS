import 'react-native-url-polyfill/auto';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';
import { resolveAuthConfig } from './config';
import { createSecureSessionStorage } from './secureSessionStorage';
import { createAuthService } from '../services/authService';
let configurationError = '';
const config = (() => {
  try { return resolveAuthConfig(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY); }
  catch (error) { configurationError = (error as Error).message; return null; }
})();
const nativeStorage = createSecureSessionStorage({
  getItemAsync: key => SecureStore.getItemAsync(key),
  setItemAsync: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  deleteItemAsync: key => SecureStore.deleteItemAsync(key),
});
export const supabase = config ? createClient(config.url, config.key, {
  auth: {
    ...(Platform.OS !== 'web' ? { storage: nativeStorage } : {}),
    persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
  },
}) : null;
export const authService = createAuthService(supabase);
export const authConfigurationError = configurationError;
