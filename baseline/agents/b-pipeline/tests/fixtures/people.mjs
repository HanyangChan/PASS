// Shared people for memory tests: userA's parents/friend, userB's professor.
import { createMemoryStore } from '../../db/memory-store.mjs';
import { createSqliteStore } from '../../db/store.mjs';

export const stores = { memory: () => createMemoryStore(), sqlite: () => createSqliteStore() };

export async function seedPeople(store) {
  const mom = await store.createRecipient('userA', { name: '어머니', aliases: ['엄마', '어머님'], groupName: '부모님' });
  const dad = await store.createRecipient('userA', { name: '아버지', aliases: ['아빠'], groupName: '부모님' });
  const friend = await store.createRecipient('userA', { name: '민지', aliases: [], groupName: '친구' });
  const prof = await store.createRecipient('userB', { name: '교수님', aliases: [], groupName: null, budgetCapKrw: 30000 });
  return { mom, dad, friend, prof };
}

/** S2 starting point: parents' confirmed memories as P1/P3 tests expect them after S1. */
export async function seedS1Memories(store, { mom, dad }) {
  const add = (recipientId, key, polarity, evidence) =>
    store.addMemory('userA', { recipientId, key, polarity, status: 'confirmed', source: 'explicit', evidence });
  return {
    sweet: await add(mom.id, 'pref:less_sweet', 1, '엄마는 단 거 싫어하시고'),
    peanut: await add(mom.id, 'allergy:땅콩', -1, '땅콩 알레르기'),
    hiking: await add(dad.id, 'hobby:등산', 1, '아빠는 등산 좋아하셔'),
  };
}
