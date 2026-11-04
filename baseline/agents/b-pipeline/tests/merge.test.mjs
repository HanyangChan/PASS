// pipeline/merge.mjs: utterance > confirmed memory > gift history. AC5 (fill), AC6, AC7 (never shrink), AC8-adjacent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initial } from '../../../src/vendor/engine.mjs';
import { checkedPatch } from '../../../src/contracts.mjs';
import { mergeConditions } from '../pipeline/merge.mjs';
import { products } from './fixtures/catalog.mjs';

const state = (over = {}) => ({ ...initial(), ...over, budget: { ...initial().budget, ...(over.budget ?? {}) } });
const mem = (items, extra = {}) => ({
  conditions: { preferences: [], excluded_categories: [], excluded_ingredients: [], packaging: null, ...extra },
  items, hobbies: [], giftHistory: [],
});
const item = (memoryId, field, value, key = `k:${memoryId}`) => ({ memoryId, key, field, value, recipientId: 'r1', label: value, evidence: 'e' });
const S2_MEMORY = () => mem([item('m1', 'preferences', 'less_sweet'), item('m2', 'excluded_ingredients', '땅콩')], { preferences: ['less_sweet'], excluded_ingredients: ['땅콩'] });
const prov = (out, field, value) => out.provenance[field]?.find(p => p.value === value)?.sources;

test('AC5 S2: "부모님 설 선물 추천해줘" alone pulls memory conditions into the same patch as the recipients', () => {
  const out = mergeConditions({ state: state(), utterancePatch: { occasion: '설', recipients: ['부모님'] }, memory: S2_MEMORY(), products });
  assert.deepEqual(out.patch, { occasion: '설', recipients: ['부모님'], preferences: ['less_sweet'], excluded_ingredients: ['땅콩'] });
  assert.deepEqual(prov(out, 'excluded_ingredients', '땅콩'), ['memory:m2']);
  assert.deepEqual(prov(out, 'preferences', 'less_sweet'), ['memory:m1']);
  assert.deepEqual(prov(out, 'occasion', '설'), ['utterance']);
  assert.deepEqual(out.questions, []);
  checkedPatch(state(), out.patch);
});

test('recipient change: baseline resets state, so memory fields are in the patch even when the old state had them', () => {
  const cur = state({ recipients: ['친구'], preferences: ['category:beauty'], excluded_ingredients: ['우유'] });
  const out = mergeConditions({ state: cur, utterancePatch: { recipients: ['부모님'] }, memory: S2_MEMORY(), products });
  assert.deepEqual(out.patch.preferences, ['less_sweet']);
  assert.deepEqual(out.patch.excluded_ingredients, ['땅콩'], "the friend's 우유 does not leak into the parents' turn (baseline reset)");
  assert.deepEqual(out.questions, []);
});

test('AC6 S3: with no memory the patch is exactly the utterance patch', () => {
  const u = { recipients: ['친구'], budget: { amount_krw: 30000 }, preferences: ['category:coffee_tea'] };
  const out = mergeConditions({ state: state(), utterancePatch: u, memory: mem([]), products });
  assert.deepEqual(out.patch, u);
  assert.deepEqual(prov(out, 'preferences', 'category:coffee_tea'), ['utterance']);
});

test('R3: budget is never filled from memory or recipient cap; an utterance budget passes through untouched', () => {
  const out = mergeConditions({ state: state(), utterancePatch: { recipients: ['교수님'] }, memory: S2_MEMORY(), products, budgetCapKrw: 30000 });
  assert.equal(Object.hasOwn(out.patch, 'budget'), false);
  const out2 = mergeConditions({ state: state(), utterancePatch: { budget: { amount_krw: 50000 } }, memory: mem([]), products, budgetCapKrw: 30000 });
  assert.deepEqual(out2.patch.budget, { amount_krw: 50000 });
});

test('priority: the utterance beats memory for packaging; memory fills it when the utterance is silent', () => {
  const m = mem([item('m3', 'packaging', 'formal')], { packaging: 'formal' });
  assert.equal(mergeConditions({ state: state(), utterancePatch: { packaging: 'basic' }, memory: m, products }).patch.packaging, 'basic');
  const filled = mergeConditions({ state: state(), utterancePatch: {}, memory: m, products });
  assert.equal(filled.patch.packaging, 'formal'); assert.deepEqual(prov(filled, 'packaging', 'formal'), ['memory:m3']);
});

test('a preference removed by the user this session is not re-added from memory (utterance > memory)', () => {
  const cur = state({ recipients: ['부모님'], preferences: ['less_sweet', 'category:fitness'] });
  const out = mergeConditions({ state: cur, utterancePatch: { preferences: ['category:fitness'] }, memory: S2_MEMORY(), products });
  assert.deepEqual(out.patch.preferences, ['category:fitness']);
  assert.deepEqual(out.suppressed, [{ field: 'preferences', value: 'less_sweet', memoryIds: ['m1'] }]);
});

test('same value from utterance and memory records both sources', () => {
  const out = mergeConditions({ state: state(), utterancePatch: { recipients: ['부모님'], excluded_ingredients: ['땅콩'] }, memory: S2_MEMORY(), products });
  assert.deepEqual(prov(out, 'excluded_ingredients', '땅콩').sort(), ['memory:m2', 'utterance']);
  assert.deepEqual(out.patch.excluded_ingredients, ['땅콩']);
});

test('excluded categories are a union of state/utterance and memory dislikes', () => {
  const m = mem([item('m4', 'excluded_categories', 'snack')], { excluded_categories: ['snack'] });
  const out = mergeConditions({ state: state({ recipients: ['부모님'] }), utterancePatch: { excluded_categories: ['beauty'] }, memory: m, products });
  assert.deepEqual(out.patch.excluded_categories.sort(), ['beauty', 'snack']);
});

test('AC7: an utterance (or LLM/chip) patch that empties or shrinks allergies keeps them and asks to delete the memory (R5)', () => {
  const cur = state({ recipients: ['부모님'], excluded_ingredients: ['땅콩', '우유'] });
  for (const u of [{ excluded_ingredients: [] }, { excluded_ingredients: ['우유'] }]) {
    const out = mergeConditions({ state: cur, utterancePatch: u, memory: S2_MEMORY(), products });
    assert.ok(out.patch.excluded_ingredients.includes('땅콩'), JSON.stringify(u));
    assert.ok(out.patch.excluded_ingredients.includes('우유'));
    assert.equal(out.questions.length, 1);
    assert.equal(out.questions[0].type, 'allergy_release');
    assert.equal(out.questions[0].text, '기억에서도 삭제할까요?');
    assert.ok(out.questions[0].ingredients.includes('땅콩'));
    checkedPatch(cur, out.patch);
  }
});

test('AC7: allergies never shrink for any non-recipient patch, including an LLM patch with unrelated fields', () => {
  const cur = state({ recipients: ['부모님'], excluded_ingredients: ['땅콩'] });
  const out = mergeConditions({ state: cur, utterancePatch: { budget: { amount_krw: 70000 } }, memory: mem([]), products });
  assert.deepEqual(out.patch.excluded_ingredients ?? cur.excluded_ingredients, ['땅콩']);
  assert.deepEqual(out.questions, []);
});

test('AC7: memory allergies survive an utterance that simply names other allergies', () => {
  const out = mergeConditions({ state: state(), utterancePatch: { recipients: ['부모님'], excluded_ingredients: ['우유'] }, memory: S2_MEMORY(), products });
  assert.deepEqual(out.patch.excluded_ingredients.sort(), ['땅콩', '우유'].sort());
});

test('AC8 / AC9: after the memory is deleted the next merge no longer carries it', () => {
  const out = mergeConditions({ state: state(), utterancePatch: { recipients: ['부모님'] }, memory: mem([]), products });
  assert.equal(Object.hasOwn(out.patch, 'excluded_ingredients'), false);
});

test('gift history: a well-liked past gift adds its category as the weakest preference; low scores and excluded categories add nothing', () => {
  const m = { ...mem([]), giftHistory: [
    { id: 'g1', productId: 'yakgwa-set', satisfaction: 5, occasion: '추석', givenAt: '2025-09-30' },
    { id: 'g2', productId: 'hiking-socks', satisfaction: 2, occasion: '생일', givenAt: '2025-05-01' },
    { id: 'g3', productId: 'coffee-beans', satisfaction: null, occasion: null, givenAt: null },
  ] };
  const out = mergeConditions({ state: state(), utterancePatch: { recipients: ['부모님'] }, memory: m, products });
  assert.deepEqual(out.patch.preferences, ['category:food']);
  assert.deepEqual(prov(out, 'preferences', 'category:food'), ['history:g1']);
  const blocked = mergeConditions({ state: state(), utterancePatch: { recipients: ['부모님'], excluded_categories: ['food'] }, memory: m, products });
  assert.equal(Object.hasOwn(blocked.patch, 'preferences'), false);
});

test('RAG candidates join as preferences with source "rag" and never override an exclusion', () => {
  const out = mergeConditions({ state: state(), utterancePatch: { recipients: ['부모님'], excluded_categories: ['health'] }, memory: mem([]), products,
    ragCandidates: [{ field: 'preferences', value: 'category:fitness', from: 'memory:m9' }, { field: 'preferences', value: 'category:health', from: 'memory:m9' }] });
  assert.deepEqual(out.patch.preferences, ['category:fitness']);
  assert.deepEqual(prov(out, 'preferences', 'category:fitness'), ['rag', 'memory:m9']);
});

test('the merged patch always passes checkedPatch, and invalid values are refused instead of repaired', () => {
  assert.throws(() => mergeConditions({ state: state(), utterancePatch: { recipients: 'mom' }, memory: mem([]), products }), { code: 'invalid_input' });
  assert.throws(() => mergeConditions({ state: state(), utterancePatch: { rank: 1 }, memory: mem([]), products }), { code: 'invalid_input' });
});

test('merge does not mutate its inputs', () => {
  const cur = state({ recipients: ['부모님'] }), u = { preferences: ['category:fitness'] }, m = S2_MEMORY();
  const snap = structuredClone([cur, u, m]);
  mergeConditions({ state: cur, utterancePatch: u, memory: m, products });
  assert.deepEqual([cur, u, m], snap);
});
