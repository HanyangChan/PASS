// Real model through the /api/chat handler: recipient gender/age follow-ups, answers to a pending question and
// real recipient changes. Uses the committed Amazon + Korean web catalog and stub auth; never logs keys.
// Usage: node api/smoke-profile.mjs [agent]   (agent: full-chat-feedback-2 (default) | full-chat)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadLocalEnv } from './local-env.mjs';
import { createApi } from './worker.mjs';
import { singleInitial } from '../lib/single-gift.mjs';
import { toEngineProduct, todayKst } from '../lib/catalog.mjs';
import { fromWebItem, mergeCatalogs } from '../lib/catalog-source.mjs';

const agent = process.argv[2] ?? 'full-chat-feedback-2';
const seed = name => JSON.parse(readFileSync(new URL(`../supabase/seed/${name}`, import.meta.url)));
const today = todayKst();
const amazon = seed('products-amazon.json');
const products = mergeCatalogs((amazon.rows ?? amazon).map(row => toEngineProduct(row, today)), seed('products-kr.json').map(item => fromWebItem(item, today)));

const ready = (recipients, extra = {}) => ({ ...singleInitial(), recipients, budget: { amount_krw: 100000, shipping_included: false }, ...extra });
const tags = d => d.session.state.preferences;
const has = (d, ...wanted) => wanted.forEach(tag => assert.ok(tags(d).includes(tag), `missing ${tag} in ${tags(d)}`));
const lacks = (d, ...unwanted) => unwanted.forEach(tag => assert.ok(!tags(d).includes(tag), `unexpected ${tag} in ${tags(d)}`));
const recipients = (d, expected) => assert.deepEqual(d.session.state.recipients, expected);
const noQuestion = d => assert.notEqual(d.question.key, 'issue', `asked: ${d.question.text}`);
const top = d => d.view.result.items[0];

const asked = '30대 남성은 손주를 뜻하나요, 아니면 다른 수령인인가요?';
const pending = (state, said) => ({ session: { state, issues: [asked] }, history: [{ role: 'user', text: said }, { role: 'assistant', text: asked }] });
const scenarios = [
  { id: 'adult grandchild', state: ready(['손주'], { occasion: '결혼' }), text: '30대 남자에게 어울리는 선물로', check: d => { recipients(d, ['손주']); has(d, 'gender:male', 'age:adult'); noQuestion(d); assert.notEqual(top(d).category, 'toy'); } },
  { id: 'boy grandchild', state: ready(['손주'], { occasion: '생일' }), text: '남자아이야', check: d => { recipients(d, ['손주']); has(d, 'gender:male'); noQuestion(d); assert.equal(top(d).category, 'toy'); } },
  { id: 'girl grandchild, request phrasing', state: ready(['손주']), text: '여자아이가 좋아할 만한 걸로 추천해줘', check: d => { recipients(d, ['손주']); has(d, 'gender:female'); noQuestion(d); } },
  { id: 'teen niece', state: ready(['조카']), text: '중학생 여자애야', check: d => { recipients(d, ['조카']); has(d, 'gender:female', 'age:teen'); noQuestion(d); assert.notEqual(top(d).category, 'liquor'); } },
  { id: 'female friend', state: ready(['친구']), text: '친구는 여자야', check: d => { recipients(d, ['친구']); has(d, 'gender:female'); noQuestion(d); } },
  { id: 'adult son', state: ready(['아들']), text: '아들은 대학생이야', check: d => { recipients(d, ['아들']); has(d, 'age:adult'); noQuestion(d); } },
  { id: 'colleague in her 50s', state: ready(['동료']), text: '50대 여성분이셔', check: d => { recipients(d, ['동료']); has(d, 'gender:female', 'age:adult'); noQuestion(d); } },
  { id: 'mother in her 60s', state: ready(['어머니']), text: '어머니는 60대셔', check: d => { recipients(d, ['어머니']); has(d, 'age:elder'); noQuestion(d); } },
  { id: 'answer: names recipient', ...pending(ready(['손주'], { occasion: '결혼' }), '30대 남자에게 어울리는 선물로'), text: '손주야', check: d => { recipients(d, ['손주']); has(d, 'gender:male', 'age:adult'); noQuestion(d); } },
  { id: 'answer: short yes', ...pending(ready(['손주'], { occasion: '결혼' }), '30대 남자에게 어울리는 선물로'), text: '응 맞아', check: d => { recipients(d, ['손주']); has(d, 'gender:male', 'age:adult'); noQuestion(d); } },
  { id: 'real replacement', state: ready(['손주']), text: '손주 말고 친구 선물로 바꿀게', check: d => recipients(d, ['친구']) },
  { id: 'new person', state: ready(['손주']), text: '이번엔 아버지 선물 골라줘', check: d => recipients(d, ['아버지']) },
  { id: 'age correction', state: ready(['손주'], { preferences: ['gender:male', 'age:child'] }), text: '아니 고등학생이야', check: d => { recipients(d, ['손주']); has(d, 'gender:male', 'age:teen'); lacks(d, 'age:child'); noQuestion(d); } },
  { id: 'taste overrides profile', state: ready(['친구'], { preferences: ['gender:male', 'age:adult'] }), text: '화장품을 좋아해', check: d => { has(d, 'gender:male', 'category:beauty'); assert.equal(top(d).category, 'beauty'); } },
  { id: 'allergy keeps profile', state: ready(['손주'], { preferences: ['gender:male', 'age:child'] }), text: '땅콩 알레르기가 있어', check: d => { has(d, 'gender:male', 'age:child'); assert.ok(d.session.state.excluded_ingredients.includes('땅콩')); } },
  { id: 'two recipients stay', state: ready(['손주', '친구']), text: '30대 남자야', check: d => recipients(d, ['손주', '친구']) },
];

const results = [];
try {
  const local = await loadLocalEnv();
  const config = { ...local, CATALOG_SOURCE: 'both', SUPABASE_URL: 'https://synthetic.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic', IP_LIMITER: { limit: async () => ({ success: true }) }, USER_LIMITER: { limit: async () => ({ success: true }) } };
  if (config.LLM_PROVIDER !== 'openai-compatible' || !config.LLM_API_KEY) throw Object.assign(Error(), { code: 'configuration' });
  const api = createApi({ catalog: async () => products, fetcher: async (url, options) => String(url).includes('/auth/v1/user') ? Response.json({ id: 'synthetic-owner', role: 'authenticated' }) : fetch(url, options) });
  for (const scenario of scenarios) {
    const started = Date.now();
    const session = scenario.session ?? { state: scenario.state, issues: [] };
    const response = await api.fetch(new Request('https://api.example/api/chat', { method: 'POST', headers: { Authorization: 'Bearer synthetic.jwt', 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'turn', session, text: scenario.text, source: 'typed', history: scenario.history ?? [], agentMode: agent }) }), config);
    const data = await response.json();
    let ok = false, reason;
    try { assert.equal(response.status, 200, data.code); scenario.check(data); ok = true; } catch (error) { reason = error.message.split('\n')[0]; }
    const result = { id: scenario.id, ok, ms: Date.now() - started, ...(ok ? {} : { reason, recipients: data.session?.state?.recipients, preferences: data.session?.state?.preferences, question: data.question?.text, steps: data.routing?.steps?.map(s => s.action) }), top: data.view?.result?.items?.[0]?.name?.slice(0, 24) };
    results.push(result); console.log(JSON.stringify(result));
  }
  if (results.some(r => !r.ok)) process.exitCode = 1;
  console.log(JSON.stringify({ ok: results.every(r => r.ok), agent, model: config.LLM_MODEL, passed: results.filter(r => r.ok).length, scenarios: results.length }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error?.code ?? 'request_failed', message: error?.message })); process.exitCode = 1;
}
