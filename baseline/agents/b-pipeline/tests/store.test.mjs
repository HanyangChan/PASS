import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSession } from '../../../src/index.mjs';
import { createSqliteStore } from '../db/store.mjs';
import { createMemoryStore } from '../db/memory-store.mjs';

const memory = { key: 'allergy:땅콩', polarity: -1, status: 'confirmed', source: 'explicit', evidence: '엄마는 땅콩 알레르기' };
const stores = { sqlite: () => createSqliteStore(), memory: () => createMemoryStore() };

for (const [name, make] of Object.entries(stores)) {
  test(`${name} store: recipients and memories are filtered by owner (AC6 premise)`, async () => {
    const s = make();
    const mom = await s.createRecipient('userA', { name: '어머니', aliases: ['엄마'], groupName: '부모님' });
    const prof = await s.createRecipient('userB', { name: '교수님', budgetCapKrw: 30000 });
    await s.addMemory('userA', { ...memory, recipientId: mom.id });
    assert.deepEqual((await s.listRecipients('userA')).map(r => r.name), ['어머니']);
    assert.equal(prof.budgetCapKrw, 30000);
    assert.equal(mom.priceSensitivity, 'balanced');
    assert.deepEqual(mom.aliases, ['엄마']);
    assert.equal(await s.getRecipient('userB', mom.id), null);
    assert.deepEqual(await s.listMemories('userB', mom.id), []);
    await assert.rejects(s.addMemory('userB', { ...memory, recipientId: mom.id }), { code: 'not_found' });
    const [m] = await s.listMemories('userA', mom.id);
    assert.equal(await s.getMemory('userB', m.id), null);
    assert.equal(await s.deleteMemory('userB', m.id), false);
    await assert.rejects(s.updateMemory('userB', m.id, { strength: 0.1 }), { code: 'not_found' });
    s.close();
  });

  test(`${name} store: memory delete is real; recipient delete cascades (AC9 premise)`, async () => {
    const s = make();
    const mom = await s.createRecipient('userA', { name: '어머니' });
    const m = await s.addMemory('userA', { ...memory, recipientId: mom.id });
    const m2 = await s.addMemory('userA', { recipientId: mom.id, key: 'pref:less_sweet', polarity: 1, status: 'suggested', source: 'feedback', evidence: '단 거 싫어하셔' });
    assert.deepEqual((await s.listMemories('userA', mom.id, { status: 'suggested' })).map(x => x.id), [m2.id]);
    assert.equal(await s.deleteMemory('userA', m.id), true);
    assert.equal(await s.getMemory('userA', m.id), null);
    assert.deepEqual((await s.listMemories('userA', mom.id)).map(x => x.id), [m2.id]);
    await s.addGift('userA', { recipientId: mom.id, productId: 'green-tea', occasion: '추석', givenAt: '2026-09-25' });
    assert.equal(await s.deleteRecipient('userA', mom.id), true);
    assert.equal(await s.getMemory('userA', m2.id), null);
    assert.deepEqual(await s.listGifts('userA', mom.id), []);
    s.close();
  });

  test(`${name} store: memory fields are shape-checked and identity fields are not editable`, async () => {
    const s = make();
    const r = await s.createRecipient('userA', { name: '아버지' });
    for (const bad of [{ polarity: 0 }, { status: 'inferred' }, { source: 'age' }, { evidence: '' }, { evidence: 'x'.repeat(201) }, { strength: 2 }]) {
      await assert.rejects(s.addMemory('userA', { ...memory, recipientId: r.id, ...bad }), { code: 'invalid_store_input' });
    }
    for (const bad of [{ signals: 'a' }, { signals: [1] }, { signals: ['x'.repeat(101)] }]) {
      await assert.rejects(s.addMemory('userA', { ...memory, recipientId: r.id, ...bad }), { code: 'invalid_store_input' }, JSON.stringify(bad));
    }
    const m = await s.addMemory('userA', { ...memory, recipientId: r.id });
    assert.deepEqual(m.signals, [], 'signals default to an empty list');
    await assert.rejects(s.updateMemory('userA', m.id, { key: 'pref:less_sweet' }), { code: 'invalid_store_input' });
    const edited = await s.updateMemory('userA', m.id, { strength: 0.9 });
    assert.equal(edited.strength, 0.9);
    assert.equal(edited.key, memory.key);
    await s.touchMemories('userA', [m.id], '2026-11-05T00:00:00.000Z');
    assert.equal((await s.getMemory('userA', m.id)).lastUsedAt, '2026-11-05T00:00:00.000Z');
    await assert.rejects(s.createRecipient('userA', { name: 'x', budgetCapKrw: -1 }), { code: 'invalid_store_input' });
    await assert.rejects(s.updateRecipient('userA', r.id, { ownerId: 'userB' }), { code: 'invalid_store_input' });
    assert.equal((await s.updateRecipient('userA', r.id, { priceSensitivity: 'value' })).priceSensitivity, 'value');
    s.close();
  });

  test(`${name} store: gift history with satisfaction 1..5`, async () => {
    const s = make();
    const r = await s.createRecipient('userA', { name: '어머니' });
    const g = await s.addGift('userA', { recipientId: r.id, productId: 'green-tea', occasion: '추석', givenAt: '2026-09-25' });
    assert.equal(g.satisfaction, null);
    assert.equal((await s.updateGift('userA', g.id, { satisfaction: 5 })).satisfaction, 5);
    await assert.rejects(s.updateGift('userA', g.id, { satisfaction: 6 }), { code: 'invalid_store_input' });
    await assert.rejects(s.updateGift('userB', g.id, { satisfaction: 4 }), { code: 'not_found' });
    assert.deepEqual((await s.listGifts('userA', r.id)).map(x => [x.productId, x.satisfaction]), [['green-tea', 5]]);
    s.close();
  });

  test(`${name} store: session state is baseline-only, meta separate, CAS on version`, async () => {
    const s = make();
    const session = createSession('sess-1');
    const meta = { recipientId: 'r1', sensitivity: 'balanced', experiment: 'B', provenance: {} };
    await s.insertSession('userA', session, meta);
    await assert.rejects(s.insertSession('userA', session, meta), { code: 'session_exists' });
    const loaded = await s.getSession('userA', 'sess-1');
    assert.deepEqual(loaded, { session, meta });
    assert.deepEqual(Object.keys(loaded.session).sort(), ['id', 'state', 'version']);
    assert.equal(await s.getSession('userB', 'sess-1'), null);
    // Pipeline fields cannot be smuggled into the baseline state or the session object.
    await assert.rejects(s.saveSession('userA', { ...session, state: { ...session.state, sensitivity: 'value' } }, meta, 0), { code: 'invalid_input' });
    await assert.rejects(s.saveSession('userA', { ...session, meta }, meta, 0), { code: 'invalid_store_input' });
    const next = { ...structuredClone(session), version: 1 };
    next.state.recipients = ['부모님'];
    await s.saveSession('userA', next, { ...meta, sensitivity: 'value' }, 0);
    // Stale writer (still expects version 0) loses.
    await assert.rejects(s.saveSession('userA', { ...next, version: 2 }, meta, 0), { code: 'version_conflict' });
    await assert.rejects(s.saveSession('userB', { ...next, version: 2 }, meta, 1), { code: 'version_conflict' });
    const after = await s.getSession('userA', 'sess-1');
    assert.equal(after.session.version, 1);
    assert.deepEqual(after.session.state.recipients, ['부모님']);
    assert.equal(after.meta.sensitivity, 'value');
    s.close();
  });

  test(`${name} store: events refuse raw-utterance fields`, async () => {
    const s = make();
    await s.logEvent({ sessionId: 'sess-1', type: 'llm_usage', payload: { role: 'dialogue', inputTokens: 5, latencyMs: 10 } });
    await assert.rejects(s.logEvent({ sessionId: 'sess-1', type: 'turn', payload: { text: '엄마는 땅콩 알레르기' } }), { code: 'forbidden_event_field' });
    await assert.rejects(s.logEvent({ sessionId: 'sess-1', type: 'turn', payload: { nested: { utterance: 'x' } } }), { code: 'forbidden_event_field' });
    const events = await s.listEvents('sess-1');
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].payload, { role: 'dialogue', inputTokens: 5, latencyMs: 10 });
    s.close();
  });
}

test('sqlite store persists to a file path and reopens', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'b-pipeline-'));
  try {
    const path = join(dir, 'nested', 'pipeline.sqlite');
    const a = createSqliteStore({ path });
    const r = await a.createRecipient('userA', { name: '어머니' });
    await a.addMemory('userA', { ...memory, recipientId: r.id });
    a.close();
    const b = createSqliteStore({ path });
    assert.equal((await b.listMemories('userA', r.id)).length, 1);
    b.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const [name, make] of Object.entries(stores)) {
  test(`${name} store: signals (suggested-feedback sessions) are their own column and never touch evidence`, async () => {
    const s = make();
    const r = await s.createRecipient('userA', { name: '어머니' });
    const m = await s.addMemory('userA', { recipientId: r.id, key: 'pref:category:fitness', polarity: 1, status: 'suggested', source: 'feedback', evidence: '행동 피드백', signals: ['s1'] });
    assert.deepEqual(m.signals, ['s1']);
    const u = await s.updateMemory('userA', m.id, { signals: ['s1', 's2'] });
    assert.deepEqual(u.signals, ['s1', 's2']);
    assert.equal(u.evidence, '행동 피드백');
    assert.deepEqual((await s.getMemory('userA', m.id)).signals, ['s1', 's2']);
    s.close();
  });
}
