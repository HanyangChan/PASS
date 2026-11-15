// Recommendation accuracy over realistic conversations, on the real Amazon catalog, for both app paths:
// the guest on-device engine and the server's rules-first mode A (no model key, so rules only).
// Run: node --experimental-strip-types tests/scenarios/recommend-eval.mjs [--verbose]
import { readFileSync } from 'node:fs';
import { toEngineProduct, recipientCategories, recipientGender, todayKst } from '../../lib/catalog.mjs';
import { genderMismatch, giftFit } from '../../lib/ranking.mjs';
import { tagAllergens } from '../../lib/allergens.mjs';
import { isFragranceProduct } from '../../lib/fragrance.mjs';
import { singleInitial } from '../../lib/single-gift.mjs';
import { createLocalChatService } from '../../mobile/src/services/chatService.ts';
import { createApi } from '../../api/worker.mjs';
import { SCENARIOS } from './scenarios.mjs';

const today = todayKst();
export const products = JSON.parse(readFileSync(new URL('../../supabase/seed/products-amazon.json', import.meta.url))).map(row => toEngineProduct(row, today));

// Guest: the app's own local chat service (rules router + on-device ranking).
const guest = createLocalChatService(products);
export async function guestRun(turns) {
  let session = guest.createSession(), history = [];
  for (const text of turns) {
    const turn = await guest.send(session, text, history);
    session = turn.session; history = [...history, { role: 'user', text }, { role: 'assistant', text: turn.message }];
  }
  const view = guest.view(session);
  return { state: session.state, question: view.question, items: view.result.items };
}

const env = { CHAT_AGENT: 'a-router', SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', IP_LIMITER: { limit: async () => ({ success: true }) }, USER_LIMITER: { limit: async () => ({ success: true }) } };
const api = createApi({ catalog: async () => products, fetcher: async url => {
  if (String(url).includes('/auth/v1/user')) return Response.json({ id: 'owner', role: 'authenticated' });
  throw Error('model call');
} });
export async function serverRun(turns) {
  let session = { state: singleInitial(), issues: [] }, history = [], data;
  for (const text of turns) {
    const response = await api.fetch(new Request('https://test/api/chat', { method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'turn', session, text, history: history.slice(-6), source: 'typed', agentMode: 'a-router' }) }), env);
    data = await response.json();
    if (response.status !== 200) return { error: `${response.status} ${data.code}` };
    session = data.session; history = [...history, { role: 'user', text }, { role: 'assistant', text: data.message }];
  }
  return { state: session.state, question: data.view.question, items: data.view.result.items };
}

const same = (a, b) => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort());
const label = p => `${p.category}:${p.name.slice(0, 28)} ${p.total}`;
// Every scenario gets the generic safety checks; `expect` adds what the conversation must have produced.
export function check(run, expect) {
  const errors = [];
  if (run.error) return [run.error];
  const s = run.state, e = expect;
  if (e.recipients && !same(s.recipients, e.recipients)) errors.push(`recipients ${JSON.stringify(s.recipients)} ≠ ${JSON.stringify(e.recipients)}`);
  if ('occasion' in e && s.occasion !== e.occasion) errors.push(`occasion ${s.occasion} ≠ ${e.occasion}`);
  if ('budget' in e && s.budget.amount_krw !== e.budget) errors.push(`budget ${s.budget.amount_krw} ≠ ${e.budget}`);
  if ('shipping' in e && s.budget.shipping_included !== e.shipping) errors.push(`shipping ${s.budget.shipping_included} ≠ ${e.shipping}`);
  if (e.prefs && !same(s.preferences, e.prefs)) errors.push(`prefs ${JSON.stringify(s.preferences)} ≠ ${JSON.stringify(e.prefs)}`);
  if (e.exCat && !same(s.excluded_categories, e.exCat)) errors.push(`exCat ${JSON.stringify(s.excluded_categories)} ≠ ${JSON.stringify(e.exCat)}`);
  if (e.exIng && !same(s.excluded_ingredients, e.exIng)) errors.push(`exIng ${JSON.stringify(s.excluded_ingredients)} ≠ ${JSON.stringify(e.exIng)}`);
  if (e.asks !== undefined && (run.question?.key ?? null) !== e.asks) errors.push(`question ${run.question?.key ?? null} ≠ ${e.asks}`);
  if (run.question?.key) return errors; // still asking: no recommendation yet
  const items = run.items;
  if (!items.length && !e.empty) errors.push('no recommendation');
  for (const p of items) {
    if (s.budget.amount_krw !== null && p.total > s.budget.amount_krw) errors.push(`over budget ${label(p)}`);
    if (s.excluded_categories.includes(p.category)) errors.push(`excluded category ${label(p)}`);
    const tagged = tagAllergens(`${p.name} ${p.name_en ?? ''}`).concat(p.allergens_declared ?? []);
    if (tagged.some(a => s.excluded_ingredients.includes(a))) errors.push(`allergen ${label(p)}`);
    if (s.preferences.includes('avoid_fragrance') && isFragranceProduct(p)) errors.push(`fragrance ${label(p)}`);
    if (genderMismatch(p, recipientGender(s.recipients))) errors.push(`wrong gender ${label(p)}`);
    if (giftFit(p) < 0) errors.push(`not gift-like ${label(p)}`);
  }
  // A preference only binds the top pick when the catalog has an affordable product of that kind.
  const affordable = c => products.some(p => p.category === c && (s.budget.amount_krw === null || p.price_krw <= s.budget.amount_krw));
  const wanted = s.preferences.filter(x => x.startsWith('category:')).map(x => x.slice(9)).filter(affordable);
  const top = items[0];
  if (top && e.top) {
    if (e.top.category && ![e.top.category].flat().includes(top.category)) errors.push(`top category ${label(top)} ≠ ${e.top.category}`);
    if (e.top.name && !e.top.name.test(`${top.name} ${top.name_en ?? ''}`)) errors.push(`top name ${label(top)} !~ ${e.top.name}`);
    if (e.top.all && items.some(p => !e.top.all.test(`${p.name} ${p.name_en ?? ''}`))) errors.push(`top3 ${items.map(label).join(' | ')} !~ ${e.top.all}`);
  } else if (top && wanted.length && !wanted.includes(top.category)) errors.push(`top ${label(top)} ignores preference ${wanted}`);
  else if (top && !wanted.length && s.recipients.length && recipientCategories(s.recipients, { profiles: true }).size && !recipientCategories(s.recipients, { profiles: true }).has(top.category)) errors.push(`top ${label(top)} not suited to ${s.recipients}`);
  return errors;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('recommend-eval.mjs')) {
  const verbose = process.argv.includes('--verbose');
  let pass = { guest: 0, server: 0 };
  for (const sc of SCENARIOS) {
    for (const [path, run] of [['guest', guestRun], ['server', serverRun]]) {
      if (sc.only && sc.only !== path) { pass[path]++; continue; }
      const result = await run(sc.say);
      const errors = check(result, sc.expect);
      if (errors.length) console.log(`✖ [${path}] ${sc.say.join(' / ')}\n   ${errors.join('\n   ')}`);
      else { pass[path]++; if (verbose) console.log(`✔ [${path}] ${sc.say.join(' / ')} → ${result.items?.map(label).join(' | ')}`); }
    }
  }
  console.log(`guest ${pass.guest}/${SCENARIOS.length} · server ${pass.server}/${SCENARIOS.length}`);
}
