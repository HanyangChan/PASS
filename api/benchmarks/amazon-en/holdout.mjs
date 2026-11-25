import assert from 'node:assert/strict';

const groups = new Set(['exact', 'recommendation', 'allergy', 'multiturn']);
const productId = /^amz-[A-Z0-9]{10}$/;
const normalize = text => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function validateHoldout(holdout, regression, regressionEvidence, baseline) {
  assert.ok(object(holdout), 'holdout must be a JSON object');
  assert.equal(holdout.baseline, baseline, 'holdout baseline must match the frozen Git revision');
  const {tasks, ingredientEvidence = {}} = holdout;
  assert.ok(Array.isArray(tasks) && tasks.length, 'holdout tasks must be a nonempty array');
  assert.ok(object(ingredientEvidence), 'ingredientEvidence must be an object');
  const usedText = new Set(regression.flatMap(task => task.steps.map(step => normalize(step.text))));
  const usedIds = new Set([...Object.keys(regressionEvidence),
    ...regression.flatMap(task => task.steps.flatMap(step => step.expectedIds ?? []))]);
  const taskIds = new Set();
  const seenText = new Set();
  const exactIds = new Set();
  for (const entry of tasks) {
    assert.ok(object(entry) && typeof entry.id === 'string' && /^[a-z0-9-]{1,60}$/.test(entry.id) && !taskIds.has(entry.id), 'invalid or duplicate holdout task ID');
    taskIds.add(entry.id);
    assert.ok(groups.has(entry.group), 'unknown holdout group');
    assert.ok(Array.isArray(entry.steps) && entry.steps.length === (entry.group === 'multiturn' ? 2 : 1), 'invalid holdout step count');
    for (const step of entry.steps) {
      assert.ok(object(step) && typeof step.text === 'string' && step.text.length <= 1200, 'invalid holdout text');
      const text = normalize(step.text);
      assert.ok(text && !usedText.has(text) && !seenText.has(text), 'holdout text overlaps an existing case');
      seenText.add(text);
      if (entry.group === 'exact') {
        assert.ok(Array.isArray(step.expectedIds) && step.expectedIds.length, 'exact holdout case needs target IDs');
        for (const id of step.expectedIds) {
          assert.ok(productId.test(id) && !usedIds.has(id) && !exactIds.has(id), 'invalid, repeated, or previously used exact target ID');
          assert.ok(!step.text.toUpperCase().includes(id.slice(4)), 'holdout request contains its answer identifier');
          exactIds.add(id);
        }
      } else {
        assert.ok(!Object.hasOwn(step,'expectedIds'), 'expectedIds is only scored for exact cases');
      }
      if (['recommendation','multiturn'].includes(entry.group)) {
        assert.ok(Array.isArray(step.categories) && step.categories.length && step.categories.every(c=>typeof c==='string'&&c),
          'recommendation holdout case needs categories');
        assert.ok(Number.isSafeInteger(step.budget) && step.budget>0, 'recommendation holdout case needs a positive budget cap');
      }
      assert.ok(entry.group==='allergy' ? (step.ingredient===null || typeof step.ingredient==='string'&&step.ingredient.trim()) :
        !Object.hasOwn(step,'ingredient'), 'ingredient is required for allergy cases only');
    }
  }
  for (const [id, entry] of Object.entries(ingredientEvidence)) {
    assert.ok(productId.test(id) && !usedIds.has(id) && object(entry) &&
      Array.isArray(entry.contains) && entry.contains.length && entry.contains.every(x=>typeof x==='string'&&x) &&
      typeof entry.source==='string' && /^https:\/\//.test(entry.source), 'invalid or previously used ingredient evidence');
  }
  return {tasks,ingredientEvidence};
}
