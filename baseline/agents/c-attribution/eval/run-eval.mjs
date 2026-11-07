// Layer B: REAL LLM evaluation. Not part of npm test (file name does not match test patterns).
// Run manually from the repository root:
//   node --env-file=baseline/llm/.env baseline/agents/c-attribution/eval/run-eval.mjs --repeat 5 [--policy ask_first|apply_confirmed]
import { mkdirSync, writeFileSync } from 'node:fs';
import { createLlmFromEnv } from '../../../llm/index.mjs';
import { createInterpreter } from '../interpreter.mjs';
import { PROMPT_VERSION } from '../prompts.mjs';
import { loadEvalSet, runEval, summarize } from './evaluate.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const repeat = Number(arg('repeat', '5'));
const mixedPolicy = arg('policy', 'ask_first');
if (!Number.isSafeInteger(repeat) || repeat < 1 || repeat > 20) throw new RangeError('--repeat must be 1..20');

const llm = createLlmFromEnv(process.env);
if (!llm.configured) {
  console.error(JSON.stringify({ ok: false, code: 'configuration', hint: 'node --env-file=baseline/llm/.env 로 실행했는지 확인하세요.' }));
  process.exit(1);
}
const { items, sha256 } = loadEvalSet(new URL('./attribution-eval.jsonl', import.meta.url));
const runs = await runEval({ items, repeat, createInterpret: onStats => createInterpreter({ llm, mixedPolicy, onStats }) });
const summary = summarize(items, runs);
const date = new Date().toISOString();
const report = { model: llm.model, provider: llm.provider, promptVersion: PROMPT_VERSION, mixedPolicy, date, evalSetSha256: sha256, repeat, summary, runs };

const dir = new URL('./results/', import.meta.url);
mkdirSync(dir, { recursive: true });
const name = `${date.slice(0, 10)}-${llm.model.replace(/[^A-Za-z0-9._-]/g, '_')}-${PROMPT_VERSION}-${mixedPolicy}.json`;
writeFileSync(new URL(name, dir), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
const { byType, ...headline } = summary;
console.log(JSON.stringify({ ok: true, file: `eval/results/${name}`, model: llm.model, promptVersion: PROMPT_VERSION, mixedPolicy, evalSetSha256: sha256, repeat, ...headline }, null, 2));
