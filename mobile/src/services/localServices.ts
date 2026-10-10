import AsyncStorage from '@react-native-async-storage/async-storage';
import products from '../../../lib/products.json';
import { categoryNames } from '../catalog';
import { createLocalChatService } from './chatService';
import { createGiftRepository } from './giftRepository';

// Composition point: screens depend on services, not engine data or storage drivers.
export const chatService = createLocalChatService(products, categoryNames);
export const giftRepository = createGiftRepository(AsyncStorage);
