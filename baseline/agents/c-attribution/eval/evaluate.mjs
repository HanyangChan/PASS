// Layer B metrics (pure functions). The real-LLM runner is run-eval.mjs; tests import only this file.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { claimPatchValue } from '../attribution.mjs';

export const EVAL_TYPES = Object.freeze(['giver', 'recipient', 'unknown', 'third_party', 'quoted', 'negation', 'tense', 'mixed', 'injection', 'condition']);

export function loadEvalSet(file) {
  const raw = readFileSync(file, 'utf8');
  const items = raw.split('\n').filter(line => line.trim()).map((line, i) => {
    try { return JSON.parse(line); } catch { throw new SyntaxError(`attribution-eval.jsonl line ${i + 1} is not JSON`); }
  });
  return { items, sha256: createHash('sha256').update(raw).digest('hex') };
}

const squash = s => s.replace(/\s+/g, '');
const overlaps = (a, b) => squash(a).includes(squash(b)) || squash(b).includes(squash(a));
const ratio = (n, d) => (d ? n / d : 0);
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Score one run of one item. run = {result, stats, error}. */
export function scoreRun(item, { result, stats = {}, error } = {}) {
  const predicted = stats.claims ?? [];
  const effectivePatch = error ? null : (result.unresolved ? {} : result.patch);
  const asked = !error && (result.unresolved || result.questions.length > 0);
  let ownerCorrect = 0, giverClaims = 0, giverLeaks = 0;
  for (const expected of item.claims) {
    const match = predicted.find(p => overlaps(p.span, expected.span));
    if (match?.owner === expected.owner) ownerCorrect++;
    if (expected.owner !== 'giver') continue;
    giverClaims++;
    const added = match?.owner === 'recipient' ? claimPatchValue(match) : null;
    if (added && effectivePatch?.[added.field]?.includes(added.value)) giverLeaks++;
  }
  // A value is wrongly confirmed when it is new (not in state) and not expected.
  const wrongConfirm = effectivePatch !== null && Object.entries(effectivePatch).some(([field, values]) =>
    values.some(v => !(item.state[field] ?? []).includes(v) && !(item.expected_patch[field] ?? []).includes(v)));
  return {
    ownerTotal: item.claims.length, ownerCorrect, giverClaims, giverLeaks,
    hasUnknown: item.claims.some(c => c.owner === 'unknown'), asked,
    wrongConfirm, exact: effectivePatch !== null && canonical(effectivePatch) === canonical(item.expected_patch),
    questionOk: item.expect_question === null ? !error : asked === item.expect_question,
    effectivePatch, error: error ?? null, timedOut: Boolean(stats.timedOut),
    llmCalls: stats.llmCalls ?? 0, latencyMs: stats.latencyMs ?? 0, totalTokens: stats.usage?.total_tokens ?? 0,
    predictedClaims: predicted, calls: stats.calls ?? [],
  };
}

/** Run every item `repeat` times, one after another (no parallel bursts against the provider). */
export async function runEval({ items, repeat = 1, createInterpret }) {
  const runs = [];
  for (const item of items) {
    for (let r = 0; r < repeat; r++) {
      let stats = {};
      const interpret = createInterpret(s => { stats = s; });
      let result, error;
      try { result = await interpret({ text: item.text, state: structuredClone(item.state) }); }
      catch (e) { error = e?.code ?? 'error'; }
      runs.push({ id: item.id, type: item.type, repeat: r, ...scoreRun(item, { result, stats, error }) });
    }
  }
  return runs;
}

function aggregate(runs) {
  const sum = key => runs.reduce((n, r) => n + Number(r[key]), 0);
  const unknownRuns = runs.filter(r => r.hasUnknown);
  return {
    runs: runs.length,
    ownerAccuracy: ratio(sum('ownerCorrect'), sum('ownerTotal')),
    giverLeakRate: ratio(sum('giverLeaks'), sum('giverClaims')),
    unknownQuestionRate: ratio(unknownRuns.filter(r => r.asked).length, unknownRuns.length),
    wrongConfirmRate: ratio(runs.filter(r => r.wrongConfirm).length, runs.length),
    exactPatchRate: ratio(runs.filter(r => r.exact).length, runs.length),
    questionAccuracy: ratio(runs.filter(r => r.questionOk).length, runs.length),
    errors: runs.filter(r => r.error).length,
    timeouts: runs.filter(r => r.timedOut).length,
    llmCalls: sum('llmCalls'),
    meanLatencyMs: ratio(sum('latencyMs'), runs.length),
    totalTokens: sum('totalTokens'),
  };
}

export function summarize(items, runs) {
  const byId = Map.groupBy(runs, r => r.id);
  const unstableItems = [...byId.values()].filter(rs => new Set(rs.map(r => canonical(r.effectivePatch))).size > 1).length;
  const byType = Object.fromEntries(EVAL_TYPES.map(type => [type, aggregate(runs.filter(r => (r.type ?? items.find(i => i.id === r.id)?.type) === type))]));
  return { items: items.length, ...aggregate(runs), unstableItems, byType };
}
