import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { tasks, ingredientEvidence } from './fixtures.mjs';
import { scoreTurn } from './scoring.mjs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const { values } = parseArgs({ options: {
  repo: { type: 'string', default: repoRoot },
  data: { type: 'string', default: 'data/amazon-en/run' },
  'catalog-dir': { type: 'string', default: 'data/amazon-en/catalog' },
  'config-root': { type: 'string' },
  mode: { type: 'string', default: 'ABC' },
  model: { type: 'string', default: 'deepseek-v4-flash' },
  validate: { type: 'boolean', default: false },
  worktree: { type: 'boolean', default: false },
} });
const repetitions = 3;
const day = '2026-11-30';
const allModes = { A: 'a-router', B: 'full-chat', C: 'full-chat-feedback-2' };
assert.match(values.mode, /^(?:A|B|C|AB|BC|ABC)$/, 'mode must be A, B, C, AB, BC or ABC');
const modes = Object.fromEntries([...values.mode].map(mode => [mode, allModes[mode]]));
const expectedModel = values.model;
const modelRates = new Map([
  ['deepseek-v4-flash', { INPUT: 0.06, CACHED_INPUT: 0.06, OUTPUT: 0.17 }],
  ['gpt-5.6-luna', { INPUT: 0.20, CACHED_INPUT: 0.20, OUTPUT: 1.20 }],
]);
const rates = modelRates.get(expectedModel);
assert.ok(rates, `unsupported model: ${expectedModel}`);
const repo = resolve(values.repo);
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
const baseline = git('rev-parse', 'HEAD');
const sourceRoots=['api','baseline','lib','scripts/catalog','supabase/seed'];
const runtimeFiles=git('ls-files','--others','--exclude-standard','--',...sourceRoots)
  .split('\n').filter(name=>/\.(?:mjs|cjs|js|json)$/.test(name));
const trackedChanges=git('diff','--binary','HEAD','--',...sourceRoots);
if(!values.worktree) {
  assert.equal(trackedChanges,'','use --worktree with a new results directory when testing edited runtime files');
  assert.equal(runtimeFiles.length,0,'use --worktree with newly added runtime files');
}
const sourceHash=createHash('sha256').update(baseline).update('\0'+trackedChanges);
for (const file of runtimeFiles) sourceHash.update('\0'+file+'\0').update(await readFile(join(repo,file)));
const sourceRevision=sourceHash.digest('hex');
const methodHash=createHash('sha256')
  .update(await readFile(new URL('./run.mjs',import.meta.url)))
  .update(await readFile(new URL('./scoring.mjs',import.meta.url))).digest('hex');
const loadModule = path => import(pathToFileURL(join(repo, path)).href);
const [{ createApi }, { toEngineProduct }, { imageUrl, toRow }, { singleInitial }, { loadLocalEnv }] = await Promise.all([
  loadModule('api/worker.mjs'), loadModule('lib/catalog.mjs'),
  loadModule('scripts/catalog/transform.mjs'), loadModule('lib/single-gift.mjs'), loadModule('api/local-env.mjs'),
]);

const local = await loadLocalEnv({
  root: pathToFileURL(resolve(values['config-root'] ?? repo) + '/'),
  processEnv: {
    ...process.env, LLM_PROVIDER: 'openai-compatible', LLM_MODEL: expectedModel,
    LLM_REASONING_ENABLED: 'false', A_ROUTER_LLM_MODE: 'single',
  },
});
if (!values.validate) assert.ok(local.LLM_API_KEY, 'configure the compatible LLM provider before a live run');

const dataDir = resolve(values.data);
const catalogDir = resolve(values['catalog-dir']);
const manifest = JSON.parse(await readFile(join(catalogDir, 'manifest.json'), 'utf8'));
const startedLoading = performance.now();
const source = createReadStream(join(catalogDir, 'catalog.jsonl'));
const digest = createHash('sha256');
source.on('data', chunk => digest.update(chunk));
const products = [];
for await (const line of createInterface({ input: source, crlfDelay: Infinity })) {
  const p = JSON.parse(line);
  const row = toRow({
    asin: p.asin, name: p.name, inr: p.inr, rating: p.rating, count: p.count,
    image: p.image ? imageUrl(p.image) : null, link: `https://www.amazon.in/dp/${p.asin}`,
  }, { name_ko: p.name, category: p.category });
  row.description = p.subCategory || p.mainCategory;
  products.push(toEngineProduct(row, day));
}
const loadMs = performance.now() - startedLoading;
assert.equal(digest.digest('hex'), manifest.catalog_sha256, 'catalog hash mismatch');
assert.equal(products.length, manifest.selected, 'catalog count mismatch');
const byId = new Map(products.map(product => [product.id, product]));
assert.equal(byId.size, products.length, 'duplicate catalog ID');
assert.equal(products.length, 300000);
assert.equal(manifest.catalog_sha256, '70ab2f30b179efae0807dd6441f1c13881a0deb7a694f05db0bb0c8eee3b478c');
for (const id of [...tasks.flatMap(task => task.steps.flatMap(step => step.expectedIds ?? [])), ...Object.keys(ingredientEvidence)]) {
  assert.ok(byId.has(id), `fixture product missing: ${id}`);
}

const limiter = { limit: async () => ({ success: true }) };
const common = {
  ...local, CATALOG_SOURCE: 'amazon', ITEM_FILTER: 'off',
  SUPABASE_URL: 'https://benchmark.invalid', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_benchmark',
  IP_LIMITER: limiter, USER_LIMITER: limiter,
};
const headers = { Authorization: 'Bearer synthetic-benchmark', 'Content-Type': 'application/json' };
function normalizeUsage(body) {
  const usage = body?.usage;
  const isCount = number => Number.isSafeInteger(number) && number >= 0;
  if (!isCount(usage?.prompt_tokens) || !isCount(usage?.completion_tokens)) return null;
  const reportedCached = usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens;
  const cached = isCount(reportedCached) && reportedCached <= usage.prompt_tokens ? reportedCached : null;
  return { input: usage.prompt_tokens, output: usage.completion_tokens, cached };
}

function cost(attempts) {
  if (!attempts.length) return 0;
  const { INPUT, OUTPUT, CACHED_INPUT } = rates;
  if (INPUT === null || OUTPUT === null) return null;
  if (attempts.some(attempt => !attempt.usage || (attempt.usage.cached === null && INPUT !== CACHED_INPUT) ||
      (attempt.usage.cached > 0 && CACHED_INPUT === null))) return null;
  return attempts.reduce((sum, { usage }) => {
    const cached = usage.cached ?? 0;
    return sum + (usage.input - cached) * INPUT + cached * (CACHED_INPUT ?? 0) + usage.output * OUTPUT;
  }, 0) / 1e6;
}

async function run(task, agent, repeat) {
  const attempts = [];
  const api = createApi({
    catalog: async () => products,
    fetcher: async (url, options) => {
      if (String(url) === 'https://benchmark.invalid/auth/v1/user') {
        return Response.json({ id: 'synthetic-owner', role: 'authenticated' });
      }
      const attempt = { status: null, usage: null };
      attempts.push(attempt);
      const start = performance.now();
      let response;
      try {
        response = await fetch(url, options);
      } catch (error) {
        attempt.networkCode = error.cause?.code ?? error.name;
        throw error;
      } finally {
        attempt.latencyMs = performance.now() - start;
      }
      attempt.status = response.status;
      const body = await response.clone().json().catch(() => null);
      attempt.usage = normalizeUsage(body);
      attempt.gatewayCost = Number.isFinite(body?.usage?.cost) ? body.usage.cost : null;
      attempt.providerError = typeof body?.error?.code === 'string' ? body.error.code : null;
      attempt.model = typeof body?.model === 'string' ? body.model : null;
      return response;
    },
  });
  const env = { ...common, CHAT_AGENT: agent };
  const history = [];
  let session = { state: singleInitial(), issues: [] };
  if (task.group === 'exact' || task.group === 'allergy') {
    session.state.recipients = ['친구'];
    session.state.budget = { amount_krw: 80000, shipping_included: true };
  }
  const turns = [];
  for (const spec of task.steps) {
    const previous = attempts.length;
    const start = performance.now();
    const response = await api.fetch(new Request('https://benchmark.invalid/api/chat', {
      method: 'POST', headers,
      body: JSON.stringify({ operation: 'turn', agentMode: agent, text: spec.text, session, history: history.slice(-6), source: 'typed' }),
    }), env);
    const decoded = await response.json().catch(()=>null);
    const data = decoded && typeof decoded === 'object' && !Array.isArray(decoded) ? decoded : {};
    const invalidApiResponse = response.ok && (!data.session?.state || !Array.isArray(data.view?.result?.items)
      || !data.question || data.agent !== agent || data.view.result.items.some(item=>typeof item?.id!=='string'));
    const latencyMs = performance.now() - start;
    const ids = !response.ok || invalidApiResponse ? [] : data.view.result.items.slice(0, 3).map(item => item?.id).filter(id => typeof id==='string');
    const turnAttempts = attempts.slice(previous);
    turns.push({
      status: response.status, agent: data.agent ?? null, errorCode: data.code ?? null, route: data.routing?.route ?? null, routingFailure: data.routing?.failureCode ?? null, stopReason: data.routing?.stopReason ?? null,
      latencyMs, ids, invalidApiResponse, response: data.message ?? data.error ?? null, notice: data.view?.result?.notice ?? null,
      appliedConditions: invalidApiResponse || !response.ok ? null : {
        budget: data.session.state.budget, deliveryBy: data.session.state.delivery_by,
        excludedIngredients: data.session.state.excluded_ingredients,
      },
      steps: data.routing?.steps ?? [],
      review: data.routing?.feedback?.reviews ?? [],
      toolCalls: data.routing?.toolCalls ?? 0,
      question: data.question ?? null, score: scoreTurn(spec, data, invalidApiResponse ? 502 : response.status, ids, byId, ingredientEvidence),
      llmCalls: data.routing?.llmCalls ?? 0, attempts: turnAttempts, usd: cost(turnAttempts),
    });
    if (response.ok && !invalidApiResponse) session = data.session;
    history.push({ role: 'user', text: spec.text }, { role: 'assistant', text: String(data.message ?? data.error ?? '').slice(0, 1200) });
  }
  return { task: task.id, group: task.group, agent, repeat, turns, usd: cost(attempts) };
}

function summarize(rows) {
  const turns = rows.flatMap(row => row.turns);
  const exact = turns.filter(turn => Object.hasOwn(turn.score, 'hit1'));
  const conditional = rows.filter(row => ['recommendation', 'multiturn'].includes(row.group));
  const recommendations = conditional.flatMap(row => row.turns).filter(turn => Object.hasOwn(turn.score, 'eligibleItems'));
  const allergies = turns.filter(turn => turn.score.needsReview);
  const clarifications = allergies.filter(turn => turn.score.clarificationRequired);
  const attempts = turns.flatMap(turn => turn.attempts);
  const sum = (list, value) => list.reduce((total, entry) => total + value(entry), 0);
  const rate = (count, total) => total ? count / total : null;
  const percentiles = times => {
    const ordered = [...times].sort((a, b) => a - b);
    return { median: ordered[Math.ceil(ordered.length * 0.5) - 1] ?? null,
      p95: ordered[Math.ceil(ordered.length * 0.95) - 1] ?? null };
  };
  const usd = cost(attempts);
  const recommendationRows = rows.filter(row => row.turns.every(turn => Object.hasOwn(turn.score, 'eligibleItems')));
  const successfulRecommendations = recommendationRows.filter(row => row.turns.every(turn =>
    turn.status === 200 && (Object.hasOwn(turn.score, 'hit3') ? turn.score.hit3 : turn.score.answeredWithEligibleRecommendation)));
  const recommendationUsd = cost(recommendationRows.flatMap(row => row.turns.flatMap(turn => turn.attempts)));
  return {
    tasks: rows.length, requests: turns.length, httpErrors: turns.filter(turn => turn.status !== 200).length,
    invalidApiResponses: turns.filter(turn => turn.invalidApiResponse).length,
    gracefulFallbacks: turns.filter(turn => turn.route==='fallback').length,
    unsupportedQuantityCases: turns.filter(turn=>turn.score.unsupportedQuantity).length,
    quantityLimitExplained: turns.filter(turn=>turn.score.quantityLimitExplained).length,
    requestLatencyMs: percentiles(turns.map(turn => turn.latencyMs)),
    cumulativeTaskLatencyMs: percentiles(rows.map(row => sum(row.turns, turn => turn.latencyMs))),
    exactCases: exact.length, hit1: rate(exact.filter(turn => turn.score.hit1).length, exact.length),
    hit3: rate(exact.filter(turn => turn.score.hit3).length, exact.length),
    eligibleItemShare: rate(sum(recommendations, t => t.score.eligibleItems), sum(recommendations, t => t.score.recommendedItems)),
    conditionalRequests: recommendations.length,
    conditionalAnswered: recommendations.filter(t => t.score.answeredWithEligibleRecommendation).length,
    recommendationSuccess: rate(recommendations.filter(turn => turn.score.hasEligibleRecommendation).length, recommendations.length),
    allergyCases: allergies.length,
    knownIngredientCases: allergies.length - clarifications.length,
    ingredientStoredCases: allergies.filter(t => t.score.ingredientStored).length,
    clarificationCases: clarifications.length,
    clarificationCards: clarifications.filter(t => t.score.questionsWithCards).length, knownViolationCases: allergies.filter(turn => turn.score.knownViolations.length).length,
    unverifiedFoodCases: allergies.filter(turn => turn.score.unverifiedFoodIds.length).length,
    allergyClarificationRate: rate(clarifications.filter(turn => turn.score.clarified).length, clarifications.length),
    httpAttempts: attempts.length, llmCalls: sum(turns, turn => turn.llmCalls),
    usageReports: attempts.filter(attempt => attempt.usage).length,
    reportedInputTokens: sum(attempts, attempt => attempt.usage?.input ?? 0),
    reportedOutputTokens: sum(attempts, attempt => attempt.usage?.output ?? 0),
    reportedCachedInputTokens: sum(attempts, attempt => attempt.usage?.cached ?? 0),
    knownUsd: cost(attempts.filter(attempt => attempt.usage)),
    usd, usdPer100Tasks: !rows.length || usd === null ? null : usd * 100 / rows.length,
    usdPerSuccessfulRecommendation: recommendationUsd === null
      ? null : rate(recommendationUsd, successfulRecommendations.length),
  };
}

const metadata = {
  baseline, sourceRevision, scoringVersion: 2, methodHash, day, modes, model: local.LLM_MODEL, rates, repetitions,
  catalog: { ...manifest }, catalogDir, reasoning: local.LLM_REASONING_ENABLED ?? null,
  aMode: local.A_ROUTER_LLM_MODE,
  fixtures: tasks, ingredientEvidence,
};
const signature = createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
if (values.validate) {
  console.log(JSON.stringify({ signature, tasks: tasks.length, products: products.length,
    scenarios: tasks.length * repetitions * Object.keys(modes).length, model: expectedModel, modes, sourceRevision, scoringVersion: 2, methodHash, loadMs }, null, 2));
  process.exit(0);
}

await mkdir(dataDir,{recursive:true});
const journal = join(dataDir, 'runs.jsonl');
const report = join(dataDir, 'progress.json');
const lockPath = join(dataDir, 'run.lock');
const lock = await open(lockPath, 'wx');
try {
  await lock.writeFile(String(process.pid));
  await lock.close();
  const results = [];
  let startedAt = new Date().toISOString();
  const completed = new Set();
  const key = ({ repeat, task, agent }) => JSON.stringify([repeat, task, agent]);
  try {
    const raw = await readFile(journal, 'utf8');
    const saved = raw.trimEnd().split('\n').map(line => JSON.parse(line));
    const header = saved.shift();
    assert.equal(header.signature, signature, 'saved run has different fixtures or configuration');
    startedAt = header.startedAt;
    for (const row of saved) {
      const rowKey = key(row);
      assert.ok(!completed.has(rowKey), 'duplicate saved result');
      completed.add(rowKey);
      results.push(row);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeFile(journal, JSON.stringify({ signature, startedAt, ...metadata, loadMs }) + '\n', { flag: 'wx' });
  }
  const order = [...tasks].sort((a, b) => keyFor(a).localeCompare(keyFor(b)));
  function keyFor(task) {
    return createHash('sha256').update('pass-amazon-main-v1:' + task.id).digest('hex');
  }
  const labels = Object.keys(modes);
  const planned = tasks.length * repetitions * labels.length;
  const save = async status => {
    const summary = Object.fromEntries(Object.entries(modes).map(([label, agent]) =>
      [label, summarize(results.filter(row => row.agent === agent))]));
    await writeFile(report + '.tmp', JSON.stringify({
      signature, startedAt, updatedAt: new Date().toISOString(), model: local.LLM_MODEL,
      status, completed: results.length, planned, summary,
    }, null, 2) + '\n');
    await rename(report + '.tmp', report);
  };
  await save('running');
  for (let repeat = 1; repeat <= repetitions; repeat++) {
    const start = (repeat - 1) * 41 % order.length;
    const ordered = order.slice(start).concat(order.slice(0, start));
    for (const [index, task] of ordered.entries()) {
      for (const offset of labels.keys()) {
        const label = labels[(index + repeat - 1 + offset) % labels.length];
        const agent = modes[label];
        if (completed.has(key({ repeat, task: task.id, agent }))) continue;
        const row = await run(task, agent, repeat);
        const attempts = row.turns.flatMap(turn => turn.attempts);
        if (attempts.some(attempt => [401, 403].includes(attempt.status))) {
          await save('interrupted');
          throw Error('provider authorization failed');
        }
        if (attempts.some(attempt => attempt.model && attempt.model !== local.LLM_MODEL)) {
          await save('interrupted');
          throw Error('provider returned a different model');
        }
        if (attempts.length && attempts.every(attempt => ['ENOTFOUND','EAI_AGAIN','ENETUNREACH'].includes(attempt.networkCode))) {
          await save('interrupted');
          throw Error('provider is unreachable: ' + attempts[0].networkCode);
        }
        await appendFile(journal, JSON.stringify(row) + '\n');
        completed.add(key(row));
        results.push(row);
        console.log(JSON.stringify({ repeat, task: row.task, mode: label,
          completed: results.length, planned, codes: row.turns.map(turn => turn.status), calls: attempts.length }));
      }
      if (results.length % 15 === 0) await save('running');
    }
  }
  assert.equal(results.length, planned);
  await save('complete');
  console.log(report);
} finally {
  await unlink(lockPath);
}
