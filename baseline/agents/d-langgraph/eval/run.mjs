// Synthetic scenario evaluation for A (rules), C (attribution) and D (attribution + advisors).
//   node eval/run.mjs            replay recorded Gemini answers (no network, no key)
//   node --env-file=<.env> eval/run.mjs --live   record answers missing from the cassette
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession, runTurn } from '../../../src/index.mjs';
import { extract, initial } from '../../../src/vendor/engine.mjs';
import { toEngineProduct } from '../../../src/vendor/catalog.mjs';
import { PERSON_FIELDS } from '../../c-attribution/attribute.mjs';
import { createGeminiCall, fromItems, PROMPT_VERSION } from '../../c-attribution/gemini.mjs';
import { createDeepSeekCall } from '../../c-attribution/deepseek.mjs';
import { runAgentTurn, agentNames } from '../orchestrator.mjs';

const here = p => fileURLToPath(new URL(p, import.meta.url));
const live = process.argv.includes('--live');
// LLM_PROVIDER=deepseek uses DEEPSEEK_* settings and its own cassette, so recordings never mix.
const deepseek = process.env.LLM_PROVIDER === 'deepseek';
const model = deepseek ? process.env.DEEPSEEK_MODEL || 'deepseek-chat' : process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const { scenarios, defaults, version } = JSON.parse(readFileSync(here('./scenarios.json'), 'utf8'));
const rows = JSON.parse(readFileSync(here('../../../../supabase/seed/products-amazon.json'), 'utf8'));
const cassettePath = here(deepseek ? './cassette-deepseek.json' : './cassette.json');
const cassette = existsSync(cassettePath) ? JSON.parse(readFileSync(cassettePath, 'utf8')) : { model, prompt: PROMPT_VERSION, entries: {} };
if (cassette.prompt !== PROMPT_VERSION) throw new Error(`cassette prompt ${cassette.prompt} != ${PROMPT_VERSION}; re-record with --live`);
const call = !live ? null : deepseek
  ? createDeepSeekCall({ apiKey: process.env.DEEPSEEK_API_KEY, model, ...(process.env.DEEPSEEK_BASE_URL ? { baseUrl: process.env.DEEPSEEK_BASE_URL } : {}), timeoutMs: 30000 })
  : createGeminiCall({ apiKey: process.env.GEMINI_API_KEY, model });

// The cassette stores Gemini's labelled items per (message, recipient); mapping stays in code.
const used = new Set();
const llm = async ({ text, state }) => {
  const key = `${state.recipients[0] ?? ''}|${text}`;
  used.add(key);
  if (!cassette.entries[key]) {
    if (!call) throw new Error(`no recorded LLM answer for "${key}"; run with --live`);
    const t = performance.now();
    cassette.entries[key] = { parsed: await call({ text, state }), ms: Math.round(performance.now() - t) };
  }
  return fromItems(cassette.entries[key].parsed, state);
};

const CONDITIONS = { A: null, C: agentNames, D: [], ...Object.fromEntries(agentNames.map(a => [`D-${a}`, [a]])) };

async function runOne(sc, condition) {
  const today = sc.today ?? defaults.today;
  const products = rows.map(r => toEngineProduct(r, today));
  const budget = sc.budget === undefined ? defaults.budget : sc.budget;
  const base = await runTurn({ session: createSession(sc.id), products, request: { kind: 'patch', expectedVersion: 0, patch: { recipients: [sc.recipient], quantity: 1, same_product: true, budget: { amount_krw: budget, scope: 'per_set', shipping_included: true } } } });
  const t = performance.now();
  let out, items, llmCalls = 0;
  if (condition === 'A') {
    // The app's rule path: the whole message through the common extractor, no attribution.
    const { patch, questions } = extract(sc.message, base.session.state);
    if (questions.length && !Object.keys(patch).length) out = { kind: 'question', session: base.session };
    else out = await runTurn({ session: base.session, products, request: { kind: 'patch', expectedVersion: base.session.version, patch } });
    items = PERSON_FIELDS.flatMap(f => (patch[f] ?? []).filter(v => !base.session.state[f].includes(v)).map(value => ({ field: f, value, holder: 'recipient', applied: true })));
  } else {
    out = await runAgentTurn({ session: base.session, products, llm, disabled: CONDITIONS[condition], context: { today, ...sc.context }, request: { kind: 'message', expectedVersion: base.session.version, text: sc.message } });
    items = out.agents?.attribution ?? [];
    llmCalls = out.agents?.trace.llmCalls ?? (sc.llm ? 1 : 0);
  }
  const ms = performance.now() - t;
  const g = sc.gold, state = out.evaluatedState ?? out.session.state;
  const byId = new Map(products.map(p => [p.id, p]));
  const top = (out.result?.cards ?? []).map(c => byId.get(c.id));
  const violation = top.some(p => p.allergens_declared.some(a => (g.must_exclude_ingredients ?? []).includes(a)) || (g.must_exclude_categories ?? []).includes(p.category));
  const filter = PERSON_FIELDS.flatMap(f => state[f]);
  const holders = (g.holders ?? []).map(h => {
    const hit = items.find(i => i.field === h.field && i.value === h.value);
    return hit ? hit.holder === h.holder && (h.holder !== 'recipient' || hit.applied) : h.holder === 'unclear' && out.kind === 'question';
  });
  const ids = (out.agents?.suggestions ?? []).map(s => s.id);
  const deadline = out.agents?.suggestions.find(s => s.id === 'occasion:deadline')?.patch.delivery_by;
  const hint = out.agents?.suggestions.find(s => s.id === 'spending:budget')?.patch.budget.amount_krw;
  return {
    id: sc.id, type: sc.type, condition, kind: out.kind, ms, llmCalls,
    violation, leaked: (g.forbid ?? []).some(v => filter.includes(v)),
    holdersRight: holders.filter(Boolean).length, holdersTotal: holders.length,
    askRight: (out.kind === 'question') === g.ask,
    hit: g.hidden ? top.slice(0, 3).some(p => p.category === g.hidden) : null,
    suggestRight: g.suggest ? g.suggest.every(id => ids.includes(id)) && (!g.deadline || deadline === g.deadline) && (!g.budget_hint || hint === g.budget_hint) : null,
    falseSuggest: (g.no_suggest ?? []).filter(id => ids.includes(id)).length,
    opinionRight: g.opinion ? (out.agents?.opinions ?? []).some(o => o.text.includes(g.opinion)) : null,
    opinions: out.agents?.opinions.length ?? 0, sourced: out.agents?.opinions.filter(o => o.source).length ?? 0,
  };
}

const results = [];
for (const sc of scenarios) for (const c of Object.keys(CONDITIONS)) results.push(await runOne(sc, c));
const entries = Object.fromEntries(Object.entries(cassette.entries).filter(([k]) => used.has(k)));
if (live) writeFileSync(cassettePath, JSON.stringify({ ...cassette, model, recorded: new Date().toISOString().slice(0, 10), entries }, null, 1) + '\n');

const pct = (n, d) => d ? `${Math.round(100 * n / d)}% (${n}/${d})` : '—';
const sum = (rs, f) => rs.reduce((v, r) => v + f(r), 0);
const count = (rs, k) => [sum(rs, r => r[k] === true ? 1 : 0), sum(rs, r => r[k] === null ? 0 : 1)];
const summary = Object.keys(CONDITIONS).map(c => {
  const rs = results.filter(r => r.condition === c), ms = rs.map(r => r.ms).sort((a, b) => a - b);
  return {
    condition: c,
    violations: sum(rs, r => r.violation), leaked: sum(rs, r => r.leaked),
    attribution: pct(sum(rs, r => r.holdersRight), sum(rs, r => r.holdersTotal)),
    ask: pct(sum(rs, r => r.askRight), rs.length),
    hit3: pct(...count(rs, 'hit')),
    suggestions: pct(...count(rs, 'suggestRight')), falseSuggestions: sum(rs, r => r.falseSuggest),
    opinionsChecked: c.startsWith('D') ? pct(...count(rs, 'opinionRight')) : '—',
    sourced: c.startsWith('D') ? pct(sum(rs, r => r.sourced), sum(rs, r => r.opinions)) : '—',
    llmPerTurn: (sum(rs, r => r.llmCalls) / rs.length).toFixed(2), maxLlm: Math.max(...rs.map(r => r.llmCalls)),
    p95ms: Math.round(ms[Math.floor(0.95 * (ms.length - 1))]),
  };
});
const llmMs = Object.values(cassette.entries).map(e => e.ms).sort((a, b) => a - b);
const columns = ['condition', 'violations', 'leaked', 'attribution', 'ask', 'hit3', 'suggestions', 'falseSuggestions', 'opinionsChecked', 'sourced', 'llmPerTurn', 'maxLlm', 'p95ms'];
const table = [`| ${columns.join(' | ')} |`, `|${columns.map(() => ' --- ').join('|')}|`, ...summary.map(s => `| ${columns.map(k => s[k]).join(' | ')} |`)].join('\n');
// C is judged only on what it does (attribution and safety); D on everything.
const failures = results.filter(r => (r.condition === 'C' && (r.violation || r.leaked || !r.askRight || r.holdersRight < r.holdersTotal)) ||
  (r.condition === 'D' && (r.violation || r.leaked || !r.askRight || r.holdersRight < r.holdersTotal || r.hit === false || r.suggestRight === false || r.falseSuggest || r.opinionRight === false)));
const md = `# 평가 결과

시나리오 \`${version}\` ${scenarios.length}개 · 카탈로그 스냅샷 ${rows.length}개 (\`supabase/seed/products-amazon.json\`) · Gemini \`${cassette.model}\` / 프롬프트 \`${cassette.prompt}\`${cassette.recorded ? ` (기록 ${cassette.recorded})` : ''}

${table}

- violations: 추천 상위 3개에 금지 성분·카테고리가 들어간 시나리오 수 · leaked: 주는 사람·다른 사람 조건이 필터에 들어간 수
- attribution: 조건별 주인 정답률 · ask: 질문해야 할 때만 질문한 비율 · hit3: 숨은 취향 카테고리가 상위 3개에 든 비율
- suggestions: 기대한 제안(마감일·예산 값 포함)이 나온 비율 · falseSuggestions: 나오면 안 되는 제안 수 · sourced: 출처가 붙은 의견 비율
- p95ms: 그래프 실행 시간(LLM 응답 시간 제외, 카세트 재생). 기록 시 Gemini 응답 시간: 중앙값 ${llmMs.length ? llmMs[Math.floor((llmMs.length - 1) / 2)] : '—'}ms, 최대 ${llmMs.at(-1) ?? '—'}ms (${llmMs.length}건)

## C·D에서 기대와 다른 시나리오

${failures.length ? failures.map(r => `- ${r.condition} ${r.id} (${r.type}): ${Object.entries({ violation: r.violation, leaked: r.leaked, ask: !r.askRight, attribution: r.holdersRight < r.holdersTotal, hit: r.hit === false, suggestion: r.suggestRight === false, falseSuggest: r.falseSuggest > 0, opinion: r.opinionRight === false }).filter(([, v]) => v).map(([k]) => k).join(', ')}`).join('\n') : '없음'}
`;
writeFileSync(here(deepseek ? './results-deepseek.md' : './results.md'), md);
writeFileSync(here(deepseek ? './results-deepseek.json' : './results.json'), JSON.stringify(results, null, 1) + '\n');
console.log(table);
console.log(`\n${failures.length} unexpected C/D results; details in eval/results.md`);
