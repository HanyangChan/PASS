// AC16 local measurement (R10): time from sending a POST /api/chat turn to the whole JSON answer (cards and template tags
// are in it, P9; there is no stream), over a real 127.0.0.1 socket, with the real catalog snapshot and an in-memory sqlite store. Run: node scripts/latency.mjs [--runs=20]
//   rules path (sentence solved by parseRules, no LLM call): must be <= 1000 ms
//   LLM path: only with --llm AND a provider configured in the environment (costs real calls, ask first); otherwise skipped.
//     3 turns + 1 explain per run, --llm-runs=5: turn <= 25 s, explain <= 8 s. node --env-file=.env scripts/latency.mjs --llm
// No user sentence is printed or stored: only timings.
import { createServer } from 'node:http';
import { createSqliteStore } from '../db/store.mjs';
import { loadCatalog } from '../data/load.mjs';
import { createPipeline } from '../pipeline/index.mjs';
import { createHandlers, createListener, dialogueLlmFrom } from '../server/index.mjs';
import { createLlm } from '../llm/index.mjs';
import { singleInitial } from '../proto/lib/single-gift.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v = 'true'] = a.replace(/^--/, '').split('='); return [k, v]; }));
const RUNS = Number(args.runs) || 20;
const RULES_LIMIT_MS = 1000;
const RULES_TEXT = '부모님 한 세트 세트당 예산 5만원 이하 배송비 포함 추천';
const LLM_TURNS = ['엄마 추석 선물 5만원', '세트당 10만원', '네']; // K72 3-turn check
const TURN_LIMIT_MS = 25000, EXPLAIN_LIMIT_MS = 8000;

const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(xs.length * p) - 1)];

const SESSION0 = { state: singleInitial(), issues: [] };

/** One turn: ms until the whole answer is read, or null when it is not a 200 with cards. */
async function turnMs(base, body) {
  const started = performance.now();
  const res = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation: 'turn', experiment: 'B', session: SESSION0, history: [], source: 'typed', ...body }) });
  const json = await res.json();
  return res.ok && json.view?.result?.items?.length ? performance.now() - started : null;
}

async function measure(base, label, text, runs, limit) {
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t = await turnMs(base, { participant_id: `lat-${label}`, session_id: `${label}-${i}`, text });
    if (t !== null) times.push(t);
  }
  const worst = Math.max(...times), p50 = pct(times, 0.5), p95 = pct(times, 0.95);
  const ok = times.length === runs && worst <= limit;
  console.log(`${label}: runs=${times.length}/${runs} p50=${p50.toFixed(0)}ms p95=${p95.toFixed(0)}ms max=${worst.toFixed(0)}ms limit=${limit}ms -> ${ok ? 'PASS' : 'FAIL'}`);
  return ok;
}

/** LLM path (R10, approved 2026-11-05): per run one session of 3 turns, then one explain. Times only; never text, keys or answers. */
async function measureLlm(base, runs) {
  const sources = {}, modes = [];
  const rows = { turn1: [], turn2: [], turn3: [], explain: [] }, fails = { turn1: 0, turn2: 0, turn3: 0, explain: 0 };
  for (let i = 0; i < runs; i++) {
    const body = { participant_id: 'lat-llm', session_id: `llm-${i}` };
    const history = [];
    let session = SESSION0;
    for (const [n, text] of LLM_TURNS.entries()) {
      const key = `turn${n + 1}`, started = performance.now();
      const res = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation: 'turn', experiment: 'B', session, history: history.slice(-6), source: 'typed', text, ...body }) });
      const json = await res.json();
      const ms = performance.now() - started;
      if (res.ok) { modes.push(json.mode); rows[key].push(ms); session = json.session; history.push({ role: 'user', text }, { role: 'assistant', text: json.message }); } else fails[key]++;
    }
    const started = performance.now();
    const res = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation: 'explain', experiment: 'B', session, ...body }) });
    const json = await res.json();
    if (res.ok && Object.keys(json.pipeline?.tags ?? {}).length) { rows.explain.push(performance.now() - started); sources[json.pipeline.explanation_source] = (sources[json.pipeline.explanation_source] ?? 0) + 1; } else fails.explain++;
  }
  let ok = true;
  console.log('| step | runs ok | p50 ms | p95 ms | max ms | limit ms | result |\n|---|---|---|---|---|---|---|');
  for (const [key, times] of Object.entries(rows)) {
    const limit = key === 'explain' ? EXPLAIN_LIMIT_MS : TURN_LIMIT_MS;
    const pass = times.length === runs && Math.max(...times) <= limit;
    ok = ok && pass;
    console.log(times.length ? `| ${key} | ${times.length}/${runs} | ${pct(times, 0.5).toFixed(0)} | ${pct(times, 0.95).toFixed(0)} | ${Math.max(...times).toFixed(0)} | ${limit} | ${pass ? 'PASS' : 'FAIL'} |` : `| ${key} | 0/${runs} | - | - | - | ${limit} | FAIL |`);
  }
  const count = xs => xs.reduce((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {});
  console.log(`dialogue modes: ${JSON.stringify(count(modes))} · explanation source: ${JSON.stringify(sources)}`);
  return ok;
}

const products = loadCatalog();
const store = createSqliteStore();
const llm = args.llm ? createLlm({ env: process.env }) : null;
if (args.llm && !llm) console.log('llm: no provider configured in the environment -> LLM path skipped');
// the rules path is measured without a dialogue LLM (with one, a free sentence would go to the model, which is the LLM path below)
const listen = async pipeline => {
  const server = createServer(createListener(createHandlers({ store, products, pipeline })));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
};
const rules = await listen(createPipeline({ store, products, llm: null }));
const withLlm = llm ? await listen(createPipeline({ store, products, llm, dialogueLlm: dialogueLlmFrom(process.env, { llm }) })) : null;
let ok = true;
try {
  await turnMs(rules.base, { participant_id: 'warmup', session_id: 'w', text: RULES_TEXT }); // JIT / first-query warm-up
  ok = (await measure(rules.base, 'rules', RULES_TEXT, RUNS, RULES_LIMIT_MS)) && ok;
  if (withLlm) ok = (await measureLlm(withLlm.base, Number(args['llm-runs']) || 5)) && ok;
  else console.log('llm: not measured (R10: the LLM path is measured only after approval, with --llm)');
} finally { rules.server.close(); withLlm?.server.close(); }
process.exit(ok ? 0 : 1);
