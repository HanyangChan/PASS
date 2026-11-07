import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES } from '../../../src/vendor/catalog.mjs';
import { ALLERGEN_NAMES } from '../../../src/vendor/allergens.mjs';
import { checkKey, keyToField, keyLabel } from '../memory/keys.mjs';

test('TRD §5.2 table: every key kind maps to its engine field', () => {
  assert.deepEqual(keyToField('pref:category:fitness'), { field: 'preferences', value: 'category:fitness' });
  assert.deepEqual(keyToField('pref:less_sweet'), { field: 'preferences', value: 'less_sweet' });
  assert.deepEqual(keyToField('pref:unsweetened'), { field: 'preferences', value: 'unsweetened' });
  assert.deepEqual(keyToField('dislike:category:snack'), { field: 'excluded_categories', value: 'snack' });
  assert.deepEqual(keyToField('allergy:땅콩'), { field: 'excluded_ingredients', value: '땅콩' });
  assert.deepEqual(keyToField('constraint:packaging:formal'), { field: 'packaging', value: 'formal' });
  assert.equal(keyToField('hobby:등산'), null, 'hobby keys are mapped by RAG, not directly');
});

test('every engine category and allergen is a valid key', () => {
  for (const c of CATEGORIES) { assert.ok(checkKey(`pref:category:${c}`, 1).ok); assert.ok(checkKey(`dislike:category:${c}`, -1).ok); }
  for (const a of ALLERGEN_NAMES) assert.ok(checkKey(`allergy:${a}`, -1).ok);
});

test('keys outside the table are rejected (inference by age, gender, relation, health)', () => {
  for (const key of ['pref:category:spaceship', 'dislike:category:', 'allergy:딸기', 'constraint:packaging:gold', 'pref:age:60s',
    'pref:gender:female', 'relation:부모님', 'health:당뇨', 'pref:sweet', 'hobby:', 'hobby:' + 'x'.repeat(60), '', 'allergy', 42, null])
    assert.equal(checkKey(key, 1).ok, false, String(key));
});

test('polarity: allergy and dislike are avoidance (-1); a pref/hobby/constraint is +1; the flipped sign is a negation', () => {
  assert.deepEqual(checkKey('allergy:땅콩', -1), { ok: true, negation: false });
  assert.deepEqual(checkKey('allergy:땅콩', 1), { ok: true, negation: true });
  assert.deepEqual(checkKey('pref:less_sweet', 1), { ok: true, negation: false });
  assert.deepEqual(checkKey('pref:less_sweet', -1), { ok: true, negation: true });
  assert.equal(checkKey('pref:less_sweet', 0).ok, false);
});

test('labels are Korean and short (used in the "반영했어요" line)', () => {
  assert.equal(keyLabel('pref:less_sweet'), '단 음식 X');
  assert.equal(keyLabel('allergy:땅콩'), '땅콩 제외');
  assert.equal(keyLabel('hobby:등산'), '등산');
});
