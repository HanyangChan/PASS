// AC16 local measurement (R10): time from sending a POST /api/chat turn to the whole JSON answer (cards and template tags
// are in it, P9; there is no stream), over a real 127.0.0.1 socket, with the real catalog snapshot and an in-memory sqlite store. Run: node scripts/latency.mjs [--runs=20]
//   rules path (sentence solved by parseRules, no LLM call): must be <= 1000 ms
//   LLM path: only with --llm AND a provider configured in the environment (costs real calls, ask first); otherwise skipped.
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
const RULES_LIMIT_MS = 1000, LLM_LIMIT_MS = 3000;
const RULES_TEXT = '부모님 한 세트 세트당 예산 5만원 이하 배송비 포함 추천';
const LLM_TEXT = '어머니께 센스 있는 선물 5만원 정도로 골라줘';

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

const products = loadCatalog();
const store = createSqliteStore();
const llm = args.llm ? createLlm({ env: process.env }) : null;
if (args.llm && !llm) console.log('llm: no provider configured in the environment -> LLM path skipped');
const pipeline = createPipeline({ store, products, llm, dialogueLlm: llm ? dialogueLlmFrom(process.env, { llm }) : null });
const server = createServer(createListener(createHandlers({ store, products, pipeline })));
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
let ok = true;
try {
  await turnMs(base, { participant_id: 'warmup', session_id: 'w', text: RULES_TEXT }); // JIT / first-query warm-up
  ok = (await measure(base, 'rules', RULES_TEXT, RUNS, RULES_LIMIT_MS)) && ok;
  if (llm) ok = (await measure(base, 'llm', LLM_TEXT, Math.min(RUNS, 5), LLM_LIMIT_MS)) && ok;
  else console.log('llm: not measured (R10: the LLM path is measured only after approval, with --llm)');
} finally { server.close(); }
process.exit(ok ? 0 : 1);
