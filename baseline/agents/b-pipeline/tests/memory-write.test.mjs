// TRD §5.3 rules 1–7, AC4, AC7 (write side), AC8, AC9. Runs on both stores.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryWriter } from '../memory/write.mjs';
import { stores, seedPeople, seedS1Memories } from './fixtures/people.mjs';

const cand = (recipientId, key, polarity, evidence, extra = {}) => ({ recipientId, key, polarity, evidence, basis: 'explicit', ...extra });
const all = async (store, ids) => (await Promise.all(ids.map(id => store.listMemories('userA', id)))).flat();

for (const [name, make] of Object.entries(stores)) {
  const setup = async () => { const store = make(); const p = await seedPeople(store); return { store, w: createMemoryWriter({ store }), ...p }; };

  test(`[${name}] AC4 S1: accepting saves mother's and father's memories separately, each with its evidence sentence`, async () => {
    const { store, w, mom, dad } = await setup();
    const candidates = [
      cand(mom.id, 'pref:less_sweet', 1, '엄마는 단 거 싫어하시고'),
      cand(mom.id, 'allergy:땅콩', -1, '땅콩 알레르기'),
      cand(dad.id, 'hobby:등산', 1, '아빠는 등산 좋아하셔'),
    ];
    const proposal = await w.propose('userA', candidates);
    assert.equal(proposal.accepted.length, 3);
    assert.equal((await all(store, [mom.id, dad.id])).length, 0, 'proposing must not write');
    const res = await w.confirm('userA', proposal.accepted);
    assert.equal(res.saved.length, 3);
    const m = await store.listMemories('userA', mom.id), d = await store.listMemories('userA', dad.id);
    assert.deepEqual(m.map(x => x.key).sort(), ['allergy:땅콩', 'pref:less_sweet']);
    assert.deepEqual(d.map(x => x.key), ['hobby:등산']);
    for (const x of [...m, ...d]) { assert.equal(x.status, 'confirmed'); assert.equal(x.source, 'explicit'); assert.ok(x.evidence.length > 0); }
    assert.equal(d[0].evidence, '아빠는 등산 좋아하셔');
  });

  test(`[${name}] AC4: declining saves nothing`, async () => {
    const { store, w, mom, dad } = await setup();
    await w.propose('userA', [cand(mom.id, 'allergy:땅콩', -1, '땅콩 알레르기'), cand(dad.id, 'hobby:등산', 1, '등산')]);
    // the user says "아니요": the caller never calls confirm
    assert.equal((await all(store, [mom.id, dad.id])).length, 0);
    assert.deepEqual(await store.listGifts('userA', mom.id), []);
  });

  test(`[${name}] rule 1: the same memory proposed twice is saved once; a re-confirm of stale candidates is re-validated`, async () => {
    const { store, w, mom } = await setup();
    const c = cand(mom.id, 'pref:unsweetened', 1, '무가당만 드세요');
    await w.confirm('userA', [c]);
    const again = await w.confirm('userA', [c]);
    assert.equal(again.saved.length, 0);
    assert.equal((await store.listMemories('userA', mom.id)).length, 1);
    const bad = await w.confirm('userA', [cand(mom.id, 'pref:age:60s', 1, '어머니는 60대'), { ...c, key: 'pref:category:fitness', basis: 'inferred' }]);
    assert.equal(bad.saved.length, 0);
    assert.deepEqual(bad.rejected.map(r => r.reason).sort(), ['not_explicit', 'unknown_key']);
  });

  test(`[${name}] rule 1: confirm never writes for another owner's recipient`, async () => {
    const { store, w, prof } = await setup();
    await assert.rejects(w.confirm('userA', [cand(prof.id, 'pref:unsweetened', 1, '무가당')]), { code: 'not_found' });
    assert.deepEqual(await store.listMemories('userB', prof.id), []);
  });

  test(`[${name}] rule 2 / AC7: allergy needs an explicit sentence that names the allergen`, async () => {
    const { store, w, mom } = await setup();
    const r = await w.propose('userA', [
      cand(mom.id, 'allergy:땅콩', -1, '엄마는 단 거 싫어하셔'),               // sentence does not mention 땅콩
      cand(mom.id, 'allergy:땅콩', -1, '땅콩 알레르기', { basis: 'inferred' }),  // LLM guess
      cand(mom.id, 'allergy:땅콩', -1, '땅콩 알레르기', { source: 'feedback' }), // feedback path
    ]);
    assert.equal(r.accepted.length, 0);
    assert.deepEqual(r.rejected.map(x => x.reason), ['allergy_needs_explicit_mention', 'not_explicit', 'allergy_explicit_only']);
    assert.equal((await store.listMemories('userA', mom.id)).length, 0);
  });

  test(`[${name}] rule 2 / AC7: an opposite allergy statement never removes or changes the allergy`, async () => {
    const { store, w, mom, dad } = await setup();
    const { peanut } = await seedS1Memories(store, { mom, dad });
    const r = await w.propose('userA', [cand(mom.id, 'allergy:땅콩', 1, '이제 땅콩 먹어도 돼')]);
    assert.equal(r.accepted.length, 0);
    assert.equal(r.conflicts.length, 0, 'no "change it?" question for allergies');
    assert.equal(r.rejected[0].reason, 'allergy_cannot_decrease');
    await assert.rejects(w.resolveConflict('userA', { existingId: peanut.id, accept: true }), { code: 'allergy_cannot_decrease' });
    assert.ok(await store.getMemory('userA', peanut.id));
  });

  test(`[${name}] rule 2 / AC7: only the evidence sentence of an allergy is editable; polarity, status and strength are locked`, async () => {
    const { store, w, mom, dad } = await setup();
    const { peanut } = await seedS1Memories(store, { mom, dad });
    for (const patch of [{ polarity: 1 }, { status: 'suggested' }, { strength: 0 }, { strength: 0.2 }])
      await assert.rejects(w.edit('userA', peanut.id, patch), { code: 'allergy_cannot_decrease' }, JSON.stringify(patch));
    const ok = await w.edit('userA', peanut.id, { evidence: '엄마는 땅콩 알레르기가 있어요' });
    assert.equal(ok.evidence, '엄마는 땅콩 알레르기가 있어요');
    assert.equal(ok.status, 'confirmed'); assert.equal(ok.polarity, -1);
  });

  test(`[${name}] rule 2: feedback never creates an allergy, and explicit user deletion is the only way to remove one`, async () => {
    const { store, w, mom, dad } = await setup();
    const { peanut } = await seedS1Memories(store, { mom, dad });
    const fb = await w.recordFeedback('userA', { recipientId: mom.id, key: 'allergy:우유', polarity: -1, sessionId: 's1', productId: 'x' });
    assert.equal(fb.memory, null); assert.equal(fb.rejected.reason, 'allergy_explicit_only');
    assert.equal((await store.listMemories('userA', mom.id)).filter(m => m.key.startsWith('allergy:')).length, 1);
    assert.equal(await w.remove('userA', peanut.id), true, 'explicit deletion by the user');
    assert.equal(await store.getMemory('userA', peanut.id), null);
  });

  test(`[${name}] rule 3: feedback is stored as suggested; the same direction in a second session asks to confirm`, async () => {
    const { store, w, mom } = await setup();
    const fb = (sessionId, productId = 'hiking-poles') => w.recordFeedback('userA', { recipientId: mom.id, key: 'pref:category:fitness', polarity: 1, sessionId, productId });
    const first = await fb('s1');
    assert.equal(first.prompt, null);
    assert.equal(first.memory.status, 'suggested'); assert.equal(first.memory.source, 'feedback');
    const same = await fb('s1', 'hiking-socks');
    assert.equal(same.prompt, null, 'same session does not count twice');
    const second = await fb('s2');
    assert.equal(second.prompt.type, 'memory_prompt');
    assert.equal(second.prompt.candidates[0].memoryId, first.memory.id);
    assert.equal((await store.listMemories('userA', mom.id)).length, 1, 'one row per key');
    const accepted = await w.acceptSuggested('userA', [first.memory.id]);
    assert.equal(accepted[0].status, 'confirmed');
  });

  test(`[${name}] rule 3: suggested memories are not confirmed by themselves, and feedback cannot contradict a confirmed memory`, async () => {
    const { store, w, mom } = await setup();
    await w.confirm('userA', [cand(mom.id, 'pref:category:coffee_tea', 1, '차 좋아하세요')]);
    const fb = await w.recordFeedback('userA', { recipientId: mom.id, key: 'dislike:category:coffee_tea', polarity: -1, sessionId: 's1', productId: 'x' });
    assert.equal(fb.memory, null);
    assert.equal(fb.conflict.existing.key, 'pref:category:coffee_tea');
    assert.deepEqual((await store.listMemories('userA', mom.id)).map(m => m.status), ['confirmed']);
  });

  test(`[${name}] rule 4: nothing is inferred from age, gender, relation or health`, async () => {
    const { store, w, mom } = await setup();
    const r = await w.propose('userA', ['pref:age:60s', 'pref:gender:female', 'hobby:', 'health:당뇨', 'relation:부모님']
      .map(key => cand(mom.id, key, 1, '어머니니까')));
    assert.equal(r.accepted.length, 0);
    assert.ok(r.rejected.every(x => x.reason === 'unknown_key'));
    assert.equal((await store.listMemories('userA', mom.id)).length, 0);
  });

  test(`[${name}] rule 5 / AC8 S5: an opposite statement asks "기억을 바꿀까요?" and changes nothing`, async () => {
    const { store, w, mom, dad } = await setup();
    const { sweet } = await seedS1Memories(store, { mom, dad });
    const r = await w.propose('userA', [cand(mom.id, 'pref:less_sweet', -1, '요즘은 단 것도 드셔')]);
    assert.equal(r.accepted.length, 0);
    assert.equal(r.conflicts.length, 1);
    assert.equal(r.conflicts[0].question, '기억을 바꿀까요?');
    assert.equal(r.conflicts[0].existing.id, sweet.id);
    assert.equal(r.conflicts[0].existing.evidence, '엄마는 단 거 싫어하시고');
    const after = await store.getMemory('userA', sweet.id);
    assert.deepEqual(after, sweet, 'memory untouched');
    const confirmed = await w.confirm('userA', [cand(mom.id, 'pref:less_sweet', -1, '요즘은 단 것도 드셔')]);
    assert.equal(confirmed.saved.length, 0, 'confirming candidates never overwrites a conflicting memory');
    assert.equal(confirmed.conflicts.length, 1);
    assert.deepEqual(await store.getMemory('userA', sweet.id), sweet);
  });

  test(`[${name}] rule 5: "no" keeps the memory, "yes" removes it (non-allergy only)`, async () => {
    const { store, w, mom, dad } = await setup();
    const { sweet } = await seedS1Memories(store, { mom, dad });
    await w.resolveConflict('userA', { existingId: sweet.id, accept: false });
    assert.ok(await store.getMemory('userA', sweet.id));
    await w.resolveConflict('userA', { existingId: sweet.id, accept: true });
    assert.equal(await store.getMemory('userA', sweet.id), null);
  });

  test(`[${name}] rule 5: a negation with nothing to contradict is dropped, not stored`, async () => {
    const { store, w, mom } = await setup();
    const r = await w.propose('userA', [cand(mom.id, 'pref:less_sweet', -1, '단 것도 드셔')]);
    assert.equal(r.accepted.length, 0); assert.equal(r.conflicts.length, 0);
    assert.equal(r.rejected[0].reason, 'nothing_to_negate');
  });

  test(`[${name}] rule 6: purchase goes to gift_history; satisfaction is asked once, 1..5`, async () => {
    const { store, w, mom } = await setup();
    const g = await w.recordPurchase('userA', { recipientId: mom.id, productId: 'yakgwa-set', occasion: '추석', givenAt: '2026-09-25' });
    assert.equal(g.satisfaction, null);
    assert.equal((await store.listMemories('userA', mom.id)).length, 0, 'purchase alone is not a preference');
    const pending = await w.pendingSatisfaction('userA', mom.id);
    assert.deepEqual(pending.map(x => x.id), [g.id]);
    await assert.rejects(w.rateGift('userA', g.id, 6), { code: 'invalid_store_input' });
    const rated = await w.rateGift('userA', g.id, 4);
    assert.equal(rated.satisfaction, 4);
    assert.deepEqual(await w.pendingSatisfaction('userA', mom.id), []);
    await assert.rejects(w.rateGift('userB', g.id, 5), { code: 'not_found' });
  });

  test(`[${name}] rule 7 / AC9: delete removes the row for real (and the owner check holds)`, async () => {
    const { store, w, mom, dad } = await setup();
    const { hiking } = await seedS1Memories(store, { mom, dad });
    assert.equal(await w.remove('userB', hiking.id), false);
    assert.ok(await store.getMemory('userA', hiking.id));
    assert.equal(await w.remove('userA', hiking.id), true);
    assert.equal(await store.getMemory('userA', hiking.id), null);
    assert.deepEqual((await store.listMemories('userA', dad.id)).map(m => m.id), []);
    assert.equal(await w.remove('userA', hiking.id), false);
  });
}
