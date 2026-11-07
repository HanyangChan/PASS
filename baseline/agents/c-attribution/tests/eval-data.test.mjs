// T1-B1, T1-B2: evaluation set format and metric code, checked without a real LLM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedPatch, validateState } from '../../../src/contracts.mjs';
import { createInterpreter } from '../index.mjs';
import { EVAL_TYPES, loadEvalSet, runEval, scoreRun, summarize } from '../eval/evaluate.mjs';

const EVAL_FILE = new URL('../eval/attribution-eval.jsonl', import.meta.url);

test('T1-B1 every evaluation line follows the schema', () => {
  const { items, sha256 } = loadEvalSet(EVAL_FILE);
  assert.match(sha256, /^[0-9a-f]{64}$/);
  assert.equal(new Set(items.map(i => i.id)).size, items.length);
  for (const type of EVAL_TYPES) assert.equal(items.filter(i => i.type === type).length, 3, type);
  for (const item of items) {
    assert.deepEqual(Object.keys(item).sort(), ['claims', 'expect_question', 'expected_patch', 'id', 'state', 'text', 'type'], item.id);
    assert.ok(EVAL_TYPES.includes(item.type), item.id);
    validateState(item.state);
    checkedPatch(item.state, item.expected_patch);
    assert.ok([true, false, null].includes(item.expect_question), item.id);
    for (const c of item.claims) {
      assert.ok(item.text.includes(c.span), `${item.id}: ${c.span}`);
      assert.ok(['giver', 'recipient', 'unknown'].includes(c.owner), item.id);
    }
  }
});

test('T1-B2 metrics count giver leaks, wrong confirmations and question behaviour', () => {
  const item = {
    id: 'x', type: 'giver', text: '나는 단 것을 좋아해', state: {}, expected_patch: {}, expect_question: false,
    claims: [{ span: '단 것을 좋아해', owner: 'giver' }],
  };
  const leaked = scoreRun(item, {
    result: { patch: { preferences: ['less_sweet'] }, questions: [], unresolved: false },
    stats: { claims: [{ span: '단 것을 좋아해', kind: 'sweetness', value: 'less_sweet', polarity: 'avoid', owner: 'recipient' }], llmCalls: 1, latencyMs: 5, usage: { total_tokens: 15 } },
  });
  assert.equal(leaked.giverClaims, 1); assert.equal(leaked.giverLeaks, 1); assert.equal(leaked.wrongConfirm, true); assert.equal(leaked.exact, false);
  const clean = scoreRun(item, {
    result: { patch: {}, questions: [], unresolved: false },
    stats: { claims: [{ span: '단 것을 좋아해', kind: 'sweetness', value: null, polarity: 'prefer', owner: 'giver' }], llmCalls: 0, latencyMs: 1, usage: {} },
  });
  assert.equal(clean.giverLeaks, 0); assert.equal(clean.ownerCorrect, 1); assert.equal(clean.exact, true); assert.equal(clean.questionOk, true);
  const failed = scoreRun(item, { error: 'timeout', stats: { claims: [], llmCalls: 1, latencyMs: 9, usage: {} } });
  assert.equal(failed.exact, false); assert.equal(failed.error, 'timeout');
  const summary = summarize([item], [{ id: 'x', repeat: 0, ...leaked }, { id: 'x', repeat: 1, ...clean }]);
  assert.equal(summary.giverLeakRate, 0.5); assert.equal(summary.unstableItems, 1); assert.equal(summary.runs, 2);
});

test('T1-B2 the runner works end to end with the no-network interpreter', async () => {
  const { items } = loadEvalSet(EVAL_FILE);
  const runs = await runEval({ items, repeat: 1, createInterpret: onStats => createInterpreter({ onStats }) });
  assert.equal(runs.length, items.length);
  const summary = summarize(items, runs);
  for (const key of ['ownerAccuracy', 'giverLeakRate', 'unknownQuestionRate', 'wrongConfirmRate', 'exactPatchRate', 'errors', 'llmCalls', 'meanLatencyMs', 'maxLatencyMs', 'totalTokens', 'outputTokens'])
    assert.equal(typeof summary[key], 'number', key);
  assert.equal(summary.llmCalls, 0);
  assert.equal(summary.giverLeakRate, 0);
});

test('T1-B4 scoring: span overlap, owner n/a for owner-free kinds, n/a denominators, timeout-free view', () => {
  const base = { type: 'mixed', text: 'x', state: {}, expect_question: null };
  // S1: rule span and label span differ at both ends but are the same claim.
  const overlap = scoreRun({ ...base, id: 'o', claims: [{ span: '견과류 알레르기가 있고', owner: 'recipient' }], expected_patch: {} }, {
    result: { patch: {}, questions: [], unresolved: false },
    stats: { claims: [{ span: '엄마는 견과류 알레르기가 있', kind: 'ingredient', value: '견과류', polarity: 'avoid', owner: 'recipient' }] },
  });
  assert.equal(overlap.ownerCorrect, 1); assert.equal(overlap.ownerTotal, 1);
  // S2: an owner-free prediction is n/a only when the item expects no patch.
  const pastTaste = { claims: [{ span: '예전엔 커피 좋아했는데', kind: 'other', value: null, polarity: null, owner: null }] };
  const na = scoreRun({ ...base, id: 'n', claims: [{ span: '예전엔 커피 좋아했는데', owner: 'recipient' }], expected_patch: {} }, { result: { patch: {}, questions: ['q'], unresolved: true }, stats: pastTaste });
  assert.equal(na.ownerNA, 1); assert.equal(na.ownerTotal, 0);
  const counted = scoreRun({ ...base, id: 'c', claims: [{ span: '예전엔 커피 좋아했는데', owner: 'recipient' }], expected_patch: { preferences: ['category:coffee_tea'] } }, { result: { patch: {}, questions: ['q'], unresolved: true }, stats: pastTaste });
  assert.equal(counted.ownerNA, 0); assert.equal(counted.ownerTotal, 1); assert.equal(counted.ownerCorrect, 0);
  // S3: no denominator → null, not 0.
  const condition = { ...base, id: 'k', type: 'condition', claims: [], expected_patch: {}, expect_question: true };
  const run = scoreRun(condition, { result: { patch: {}, questions: ['q'], unresolved: true }, stats: { claims: [] } });
  const summary = summarize([condition], [{ id: 'k', type: 'condition', repeat: 0, ...run }, { id: 'k', type: 'condition', repeat: 1, ...scoreRun(condition, { error: 'timeout', stats: { timedOut: true } }) }]);
  assert.equal(summary.ownerAccuracy, null); assert.equal(summary.byType.condition.ownerAccuracy, null); assert.equal(summary.giverLeakRate, null);
  // S4: the same metrics without timed-out runs.
  assert.equal(summary.runs, 2); assert.equal(summary.errors, 1);
  assert.equal(summary.excludingTimeouts.runs, 1); assert.equal(summary.excludingTimeouts.errors, 0); assert.equal(summary.excludingTimeouts.exactPatchRate, 1);
  assert.equal(summary.ownerNA, 0);
});
