import test from 'node:test';
import assert from 'node:assert/strict';
import { createGiftRepository } from '../src/services/giftRepository.ts';
const savedKey = 'pass.saved-gifts.v1';
const recentKey = 'pass.recent-gifts.v1';
const gift = id => ({ id, name: '선물', category: '차', price: 30000, description: '예시', icon: 'gift' });

test('existing v1 records restore with their original keys and full gift fields', async () => {
  const saved = { ...gift('saved'), source: 'engine', shippingIncluded: true, arrival: '2026-10-20' };
  const values = new Map([[savedKey, JSON.stringify([saved])], [recentKey, JSON.stringify([gift('recent')])]]);
  const repo = createGiftRepository({ getItem: async key => values.get(key) ?? null, multiSet: async () => {} });
  const restored = await repo.load();
  assert.deepEqual(restored.saved, [saved]);
  assert.deepEqual(restored.recent, [gift('recent')]);
  assert.deepEqual(restored.failed, []);
});

test('one corrupt collection does not block restoring the other', async () => {
  const repo = createGiftRepository({ getItem: async key => key === savedKey ? '{broken' : JSON.stringify([gift('recent')]), multiSet: async () => {} });
  const restored = await repo.load();
  assert.deepEqual(restored.saved, []);
  assert.deepEqual(restored.recent, [gift('recent')]);
  assert.deepEqual(restored.failed, ['saved']);
});

test('queued writes capture snapshots, remain ordered and recover after failure', async () => {
  const captured = [];
  let release;
  const firstWrite = new Promise(resolve => { release = resolve; });
  const repo = createGiftRepository({
    getItem: async () => null,
    multiSet: async entries => {
      captured.push(entries);
      if (captured.length === 1) { await firstWrite; throw new Error('disk full'); }
    },
  });
  const firstRecords = { saved: [gift('first')], recent: [] };
  const first = repo.save(firstRecords);
  const rejection = assert.rejects(first, /disk full/);
  firstRecords.saved[0].name = 'changed after enqueue';
  const second = repo.save({ saved: [gift('second')], recent: [] });
  await Promise.resolve();
  assert.equal(captured.length, 1);
  release(); await rejection; await second;
  assert.equal(JSON.parse(captured[0][0][1])[0].name, '선물');
  assert.equal(JSON.parse(captured[1][0][1])[0].id, 'second');
  assert.deepEqual(captured[1].map(([key]) => key), [savedKey, recentKey]);
});
