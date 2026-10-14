import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabaseConfig } from '../auth/client';
import { createGiftRepository } from './giftRepository';
import { createProductRepository } from './productRepository';

// Composition point: screens depend on services, not engine data or storage drivers.
export const giftRepository = createGiftRepository(AsyncStorage);
export const productRepository = supabaseConfig
  ? createProductRepository({ url: supabaseConfig.url, key: supabaseConfig.key, storage: AsyncStorage })
  : null;
