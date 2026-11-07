// Layer B: REAL LLM evaluation. Not part of npm test (file name does not match test patterns).
// Run manually from the repository root:
//   node --env-file=baseline/llm/.env baseline/agents/c-attribution/eval/run-eval.mjs --repeat 2 [--reasoning off|low|none] [--policy ask_first|apply_confirmed] [--timeout-ms 8000]
// --timeout-ms is for measurement only (1..17000, below the common client's 18 s per request). Default: the interpreter's 8 s.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createLlmFromEnv } from '../../../llm/index.mjs';
import { DEFAULT_TIMEOUT_MS, createInterpreter } from '../interpreter.mjs';
import { PROMPT_VERSION } from '../prompts.mjs';
import { loadEvalSet, runEval, summarize } from './evaluate.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
function usage(message) { console.error(JSON.stringify({ ok: false, code: 'usage', message })); process.exit(1); }
const repeat = Number(arg('repeat', '5'));
const mixedPolicy = arg('policy', 'ask_first');
if (!Number.isSafeInteger(repeat) || repeat < 1 || repeat > 20) usage('--repeat must be 1..20');
const reasoningArg = arg('reasoning', 'off');
const REASONING = { off: undefined, low: { effort: 'low' }, none: null };
if (!Object.hasOwn(REASONING, reasoningArg)) usage('--reasoning must be off, low or none');
const timeoutMs = Number(arg('timeout-ms', String(DEFAULT_TIMEOUT_MS)));
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 17000) usage('--timeout-ms must be an integer 1..17000');

const llm = createLlmFromEnv(process.env);
if (!llm.configured) {
  console.error(JSON.stringify({ ok: false, code: 'configuration', hint: 'node --env-file=baseline/llm/.env 로 실행했는지 확인하세요.' }));
  process.exit(1);
}
const { items, sha256 } = loadEvalSet(new URL('./attribution-eval.jsonl', import.meta.url));
const runs = await runEval({ items, repeat, createInterpret: onStats => createInterpreter({ llm, mixedPolicy, timeoutMs, reasoning: REASONING[reasoningArg], onStats }) });
const summary = summarize(items, runs);
const date = new Date().toISOString();
const report = { model: llm.model, provider: llm.provider, promptVersion: PROMPT_VERSION, reasoning: reasoningArg, mixedPolicy, timeoutMs, date, evalSetSha256: sha256, repeat, summary, runs };

const dir = new URL('./results/', import.meta.url);
mkdirSync(dir, { recursive: true });
const name = `${date.slice(0, 19).replace(/[:]/g, '')}-${llm.model.replace(/[^A-Za-z0-9._-]/g, '_')}-${PROMPT_VERSION}-${reasoningArg}-${mixedPolicy}.json`;
writeFileSync(new URL(name, dir), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
const pct = x => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
const quality = s => ({
  ownerAccuracy: pct(s.ownerAccuracy), ownerNA: s.ownerNA, giverLeakRate: pct(s.giverLeakRate),
  unknownQuestionRate: pct(s.unknownQuestionRate), wrongConfirmRate: pct(s.wrongConfirmRate),
  exactPatchRate: pct(s.exactPatchRate), questionAccuracy: pct(s.questionAccuracy),
});
console.log(JSON.stringify({
  ok: true, file: `eval/results/${name}`,
  run: { model: llm.model, promptVersion: PROMPT_VERSION, reasoning: reasoningArg, mixedPolicy, timeoutMs, date, evalSetSha256: sha256, items: summary.items, repeat, runs: summary.runs },
  quality: { ...quality(summary), unstableItems: summary.unstableItems },
  qualityExcludingTimeouts: { runs: summary.excludingTimeouts.runs, ...quality(summary.excludingTimeouts) },
  failures: { errors: summary.errors, timeouts: summary.timeouts },
  cost: { llmCalls: summary.llmCalls, outputTokens: summary.outputTokens, totalTokens: summary.totalTokens, meanLatencyMs: Math.round(summary.meanLatencyMs), maxLatencyMs: summary.maxLatencyMs },
  byType: Object.fromEntries(Object.entries(summary.byType).map(([type, s]) => [type, { runs: s.runs, ownerAccuracy: pct(s.ownerAccuracy), ownerNA: s.ownerNA, giverLeakRate: pct(s.giverLeakRate), wrongConfirmRate: pct(s.wrongConfirmRate), errors: s.errors }])),
}, null, 2));
