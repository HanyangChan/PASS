import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabaseConfig } from '../auth/client';
import { createGiftRepository } from './giftRepository';
import { createFeedbackRepository } from './feedbackRepository';
import { createProductRepository } from './productRepository';
import { createCalendarRepository } from './calendarRepository';
import { resolveCatalogSource } from './catalogSource';

// Composition point: screens depend on services, not engine data or storage drivers.
export const giftRepository = createGiftRepository(AsyncStorage);
export const feedbackRepository = createFeedbackRepository(AsyncStorage);
export const productRepository = supabaseConfig
  ? createProductRepository({
    url: supabaseConfig.url, key: supabaseConfig.key, storage: AsyncStorage,
    source: () => resolveCatalogSource({ chatApiUrl: process.env.EXPO_PUBLIC_CHAT_API_URL, fallback: process.env.EXPO_PUBLIC_CATALOG_SOURCE }),
    // A static require keeps the JSON in the main bundle: Metro cannot serve lazy chunks from outside mobile/.
    webItems: async () => require('../../../supabase/seed/products-kr.json'),
  })
  : null;
export const calendarRepository = createCalendarRepository(AsyncStorage);
