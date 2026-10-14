import test from 'node:test';
import assert from 'node:assert/strict';
import {ALLERGEN_NAMES,tagAllergens,mentionedAllergens} from '../lib/allergens.mjs';
test('vocabulary covers the labelled allergens plus a nut tag',()=>{for(const n of ['알류','우유','메밀','땅콩','대두','밀','고등어','게','새우','돼지고기','복숭아','토마토','아황산류','호두','닭고기','쇠고기','오징어','조개류','잣','견과류'])assert.ok(ALLERGEN_NAMES.includes(n),n);});
test('product names prove presence only',()=>{
 assert.deepEqual(tagAllergens('Sunfeast Dark Fantasy Choco Fills cookies with milk').sort(),['밀','우유'].sort());
 assert.deepEqual(tagAllergens('Happilo Premium Californian Almonds 200g'),['견과류']);
 assert.ok(tagAllergens('Peanut Butter Crunchy').includes('땅콩'));
 assert.deepEqual(tagAllergens('Tata Tea Gold 500g'),[]);
 assert.ok(tagAllergens('Nutella hazelnut spread').includes('견과류'));
 assert.deepEqual(tagAllergens('boAt Nutrition Tracker'),[]);
});
test('user speech ignores names glued to a preceding syllable',()=>{
 assert.deepEqual(mentionedAllergens('땅콩 알레르기가 있어요'),['땅콩']);
 assert.deepEqual(mentionedAllergens('호두도 피해야 해'),['호두']);
 assert.deepEqual(mentionedAllergens('선물하게 해줘'),[]);
});
