// Offline paired evaluation: frozen catalog/date, fake authentication, no external requests.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { catalog, eligibleProduct } from '../tests/scenarios/recommend-eval.mjs';
import { createLocalChatService } from '../mobile/src/services/chatService.ts';
import { createApi } from '../api/worker.mjs';
import { singleInitial } from '../lib/single-gift.mjs';
import { engineState } from '../lib/single-gift.mjs';
import { feedbackContext, productFeedbackKey } from '../lib/feedback.mjs';
import { crossContextOverlap } from './feedback-evaluation-metrics.mjs';

const date = '2026-11-16', scope = 'offline-evaluation', output = new URL('../work/context-feedback/', import.meta.url);
const baselineRef = 'c55d9a4b918656d95f3e397a71475525277bbb51';
const hashedSources = ['lib/engine.mjs', 'lib/feedback.mjs', 'baseline/src/vendor/engine.mjs', 'baseline/src/vendor/feedback.mjs'];
const sourceHashes = Object.fromEntries(await Promise.all(hashedSources.map(async file =>
  [file, createHash('sha256').update(await readFile(new URL(`../${file}`, import.meta.url))).digest('hex')])));
const cases = [
  ['mother-birthday-tea', '어머니', '생일', 'coffee_tea', 'type:tea'],
  ['father-birthday-watch', '아버지', '생일', 'watch'],
  ['friend-exam-stationery', '친구', '수험', 'stationery'],
  ['partner-birthday-flower', '연인', '생일', 'flower'],
  ['parents-holiday-health', '부모님', '명절', 'health'],
  ['colleague-thanks-coffee', '직장동료', '감사', 'coffee_tea', 'type:coffee'],
  ['friend-birthday-audio', '친구', '생일', 'audio'],
  ['mother-birthday-beauty', '어머니', '생일', 'beauty'],
  ['father-thanks-bag', '아버지', '감사', 'bag'],
  ['child-birthday-toy', '아이', '생일', 'toy'],
  ['partner-anniversary-jewelry', '연인', '기념일', 'jewelry'],
  ['friend-graduation-decor', '친구', '졸업', 'decor'],
];
const histories = ['none', 'related', 'other-recipient', 'other-occasion', 'opposing-concentrated', 'legacy-and-explanation'];
const env = { CHAT_AGENT: 'a-router', SUPABASE_URL: 'https://pass-mock.test', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic',
  IP_LIMITER: { limit: async () => ({ success: true }) }, USER_LIMITER: { limit: async () => ({ success: true }) } };
const vote = (p, state, helpful = true, extra = {}) => ({ version: 2, kind: 'gift_preference', giftId: p.id, productKey: productFeedbackKey(p),
  helpful, context: feedbackContext(state, scope), at: `${date}T01:00:00Z`, ...extra });
const ids = result => result.items.map(p => p.id);
const results = [], hashes = {}, failures = [], paired = [];
const blind = [], blindKey = [];
const previousDir = new URL('previous-engine/', output);
await mkdir(previousDir, { recursive: true });
for (const file of ['engine.mjs', 'allergens.mjs', 'catalog.mjs', 'fragrance.mjs', 'ranking.mjs']) {
  const bytes = execFileSync('git', ['show', `${baselineRef}:lib/${file}`], { cwd: fileURLToPath(new URL('../', import.meta.url)), windowsHide: true });
  await writeFile(new URL(file, previousDir), bytes);
}
const previous = await import(new URL('engine.mjs', previousDir).href);
function appendBlindPair(source, name, state, before, after) {
  const versions = [{ version: 'before', items: before }, { version: 'after', items: after }];
  if (createHash('sha256').update(`${source}:${name}`).digest()[0] % 2) versions.reverse();
  for (const [i, { version, items }] of versions.entries()) {
    const blindId = `task-${source}-${name}-${i + 1}`;
    const blank = () => ({ recipientFit: null, occasionFit: null, requestFit: null, unsuitableReason: '' });
    blind.push({ blindId, conditions: state,
      products: items.map(p => ({ id: p.id, name: p.name, category: p.category, price_krw: p.price_krw,
        shipping_fee_krw: p.shipping_fee_per_set_krw, raterA: blank(), raterB: blank() })) });
    blindKey.push({ blindId, version });
  }
}
async function saveHumanSheets() {
  await writeFile(new URL('human-evaluation.json', output), JSON.stringify({ rubric: 'Two independent human raters: 0 unsuitable, 1 partly suitable, 2 suitable. Blank ratings are not completed user validation. These are development scenarios, not independent holdout data.', tasks: blind }, null, 2) + '\n');
  await writeFile(new URL('human-evaluation-key.json', output), JSON.stringify(blindKey, null, 2) + '\n');
}
if (process.argv.includes('--prepare-only')) {
  const saved = JSON.parse(await readFile(new URL('evaluation.json', output), 'utf8')), sources = new Map();
  for (const row of saved.paired.filter(r => r.history === 'opposing-concentrated')) {
    if (!sources.has(row.source)) sources.set(row.source, new Map(catalog(row.source, date).map(p => [p.id, p])));
    const [, recipient, occasion, category, type] = cases.find(c => c[0] === row.name);
    const conditions = { recipients: [recipient], occasion, preferences: [`category:${category}`, ...(type ? [type] : [])], budget: { amount_krw: 200000, shipping_included: true } };
    appendBlindPair(row.source, row.name, conditions, row.before.map(id => sources.get(row.source).get(id)), row.after.map(id => sources.get(row.source).get(id)));
  }
  await saveHumanSheets(); console.log(JSON.stringify({ humanEvaluationTasks: blind.length, ratingsCompleted: 0 }));
  process.exit(0);
}

for (const source of ['amazon', 'web', 'both']) {
  const products = catalog(source, date);
  hashes[source] = createHash('sha256').update(JSON.stringify(products)).digest('hex');
  const api = createApi({ catalog: async () => products, fetcher: async url => {
    assert.equal(String(url), 'https://pass-mock.test/auth/v1/user');
    return Response.json({ id: 'offline-owner', role: 'authenticated' });
  } });
  for (const [name, recipient, occasion, category, type] of cases) {
    const state = { ...singleInitial(), recipients: [recipient], occasion, preferences: [`category:${category}`, ...(type ? [type] : [])],
      budget: { amount_krw: 200000, shipping_included: true } };
    const session = { state, issues: [] }, before = JSON.stringify(session);
    const baseline = createLocalChatService(products).view(session).result;
    const selected = baseline.items[1] ?? baseline.items[0];
    const rawEligible = products.filter(p => eligibleProduct(p, state));
    const wantedEligible = rawEligible.filter(p => p.category === category);
    const concentrated = products.filter(p => p.category !== category).slice(0, 4);
    for (const history of histories) {
      let feedback = [];
      if (selected) {
        if (history === 'related') feedback = [vote(selected, state)];
        if (history === 'other-recipient') feedback = [vote(selected, { ...state, recipients: ['다른 사람'] })];
        if (history === 'other-occasion') feedback = [vote(selected, { ...state, occasion: '다른 상황' })];
        if (history === 'opposing-concentrated') feedback = [...wantedEligible.slice(0, 3).map(p => vote(p, state, false)), ...concentrated.map(p => vote(p, state))];
        if (history === 'legacy-and-explanation') feedback = [{ giftId: selected.id, helpful: false }, vote(selected, state, false, { kind: 'reason_helpfulness' })];
      }
      const actual = {};
      for (const path of ['guest', 'server']) {
        const started = performance.now();
        let result;
        if (path === 'guest') result = createLocalChatService(products, feedback, scope).view(session).result;
        else {
          const response = await api.fetch(new Request('https://pass-mock.test/api/chat', { method: 'POST', headers: { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json' },
            body: JSON.stringify({ operation: 'view', session, feedback, feedbackScope: scope, agentMode: 'a-router' }) }), env);
          const body = await response.json();
          assert.equal(response.status, 200, JSON.stringify(body));
          result = body.view.result;
        }
        const errors = [];
        if (result.items.some(p => !eligibleProduct(p, state))) errors.push('hard_constraint');
        if (wantedEligible.length && result.items[0]?.category !== category) errors.push('explicit_category');
        if (['none', 'other-recipient', 'other-occasion', 'legacy-and-explanation'].includes(history) && JSON.stringify(result) !== JSON.stringify(baseline)) errors.push('irrelevant_history');
        if (JSON.stringify(session) !== before) errors.push('mutated_session');
        actual[path] = ids(result);
        const row = { source, name, history, path, elapsedMs: performance.now() - started, ids: ids(result),
          candidateCount: rawEligible.length, wantedCandidateCount: wantedEligible.length,
          candidateShortage: wantedEligible.length < 3, scores: result.items.map(p => ({ id: p.id, score: p.score, feedback: p.feedback_score ?? 0 })), errors };
        results.push(row); if (errors.length) failures.push(row);
      }
      if (JSON.stringify(actual.guest) !== JSON.stringify(actual.server)) failures.push({ source, name, history, error: 'guest_server_mismatch' });
      const priorRanking = { ...previous.APP_RANKING, feedback: { liked: feedback.filter(f => f.helpful).map(f => f.giftId), disliked: feedback.filter(f => !f.helpful).map(f => f.giftId) } };
      const prior = previous.recommend(products, engineState(state), priorRanking);
      const priorPlain = previous.recommend(products, engineState(state), previous.APP_RANKING);
      const priorErrors = [];
      if (prior.items.some(p => !eligibleProduct(p, state))) priorErrors.push('hard_constraint');
      if (wantedEligible.length && prior.items[0]?.category !== category) priorErrors.push('explicit_category');
      if (['none', 'other-recipient', 'other-occasion', 'legacy-and-explanation'].includes(history) && JSON.stringify(ids(prior)) !== JSON.stringify(ids(priorPlain))) priorErrors.push('irrelevant_history');
      paired.push({ source, name, history, noHistory: ids(baseline), before: ids(prior), after: actual.guest, previousPolicyErrors: priorErrors });
      if (history === 'opposing-concentrated') {
        appendBlindPair(source, name, state, prior.items, actual.guest.map(id => products.find(p => p.id === id)));
      }
    }
  }
}
const elapsed = results.map(r => r.elapsedMs).sort((a, b) => a - b);
const concentration = rows => {
  const counts = new Map();
  for (const ids of rows) if (ids[0]) counts.set(ids[0], (counts.get(ids[0]) ?? 0) + 1);
  return { uniqueTop1: counts.size, maxTop1Share: Math.max(0, ...counts.values()) / Math.max(1, rows.length), uniqueProducts: new Set(rows.flat()).size };
};
const summary = { date, cases: cases.length, histories: histories.length, catalogs: hashes, executions: results.length,
  failures: failures.length, candidateShortages: results.filter(r => r.candidateShortage).length,
  medianMs: elapsed[Math.floor(elapsed.length / 2)], p95Ms: elapsed[Math.floor(elapsed.length * .95)],
  before: concentration(paired.map(r => r.before)), after: concentration(paired.map(r => r.after)),
  previousPolicyFailures: paired.filter(r => r.previousPolicyErrors.length).length,
  crossContextOverlap: crossContextOverlap(paired),
  changed: paired.filter(r => JSON.stringify(r.before) !== JSON.stringify(r.after)).length,
  baselineRef,
  note: 'Offline policy and consistency checks, not independent user accuracy. Before = pinned baseline engine with the old global helpfulness-to-category conversion.' };
await mkdir(output, { recursive: true });
for (const file of hashedSources) assert.equal(createHash('sha256').update(await readFile(new URL(`../${file}`, import.meta.url))).digest('hex'), sourceHashes[file], `Source changed during evaluation: ${file}`);
await writeFile(new URL('evaluation.json', output), JSON.stringify({ summary, sourceHashes, results, paired, failures }, null, 2) + '\n');
await saveHumanSheets();
console.log(JSON.stringify(summary, null, 2));
assert.equal(failures.length, 0, JSON.stringify(failures.slice(0, 5)));
