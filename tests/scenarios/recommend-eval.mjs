// Recommendation accuracy over realistic conversations, for both app paths: the guest on-device engine
// and the server's rules-first mode A (no model key, so rules only), on any catalog source.
// Run: node tests/scenarios/recommend-eval.mjs [amazon|web|both] [--verbose]
import { readFileSync } from 'node:fs';
import { toEngineProduct, recipientCategories, recipientGender } from '../../lib/catalog.mjs';
import { fromWebItem, mergeCatalogs } from '../../lib/catalog-source.mjs';
import { genderMismatch, ageMismatch, giftFit } from '../../lib/ranking.mjs';
import { recipientAge } from '../../lib/catalog.mjs';
import { tagAllergens } from '../../lib/allergens.mjs';
import { isFragranceProduct } from '../../lib/fragrance.mjs';
import { singleInitial } from '../../lib/single-gift.mjs';
import { createLocalChatService } from '../../mobile/src/services/chatService.ts';
import { createApi } from '../../api/worker.mjs';
import { SCENARIOS } from './scenarios.mjs';

const read = file => JSON.parse(readFileSync(new URL(`../../supabase/seed/${file}`, import.meta.url)));
// Built the way the app (productRepository) and the API (dev-server) build it.
export function catalog(source = 'amazon', today = '2026-11-16') {
  const amazon = source === 'web' ? [] : read('products-amazon.json').map(row => toEngineProduct(row, today));
  const web = source === 'amazon' ? [] : read('products-kr.json').map(item => fromWebItem(item, today));
  return mergeCatalogs(amazon, web);
}

export function runners(products, { feedback = [], scope = null } = {}) {
  const guest = createLocalChatService(products, feedback, scope);
  async function guestRun(turns) {
    let session = guest.createSession(), history = [];
    for (const text of turns) {
      const turn = await guest.send(session, text, history);
      session = turn.session; history = [...history, { role: 'user', text }, { role: 'assistant', text: turn.message }];
    }
    const view = guest.view(session);
    return { state: session.state, question: view.question, items: view.result.items };
  }
  const env = { CHAT_AGENT: 'a-router', SUPABASE_URL: 'https://pass-mock.test', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', IP_LIMITER: { limit: async () => ({ success: true }) }, USER_LIMITER: { limit: async () => ({ success: true }) } };
  const api = createApi({ catalog: async () => products, fetcher: async url => {
    if (String(url).includes('/auth/v1/user')) return Response.json({ id: 'owner', role: 'authenticated' });
    throw Error('model call');
  } });
  async function serverRun(turns) {
    let session = { state: singleInitial(), issues: [] }, history = [], data;
    for (const text of turns) {
      const response = await api.fetch(new Request('https://pass-mock.test/api/chat', { method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'turn', session, text, history: history.slice(-6), source: 'typed', agentMode: 'a-router', feedback, ...(scope ? { feedbackScope: scope } : {}) }) }), env);
      data = await response.json();
      if (response.status !== 200) return { error: `${response.status} ${data.code}` };
      session = data.session; history = [...history, { role: 'user', text }, { role: 'assistant', text: data.message }];
    }
    return { state: session.state, question: data.view.question, items: data.view.result.items };
  }
  return { guestRun, serverRun, check: (run, expect) => check(products, run, expect) };
}

const same = (a, b) => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort());
export const label = p => `${p.category}:${p.name.slice(0, 28)} ${p.total}`;
// Every scenario gets the generic safety checks; `expect` adds what the conversation must have produced.
function check(products, run, expect) {
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
  const requestedPool=products.filter(p=>eligibleProduct(p,s)&&requestedProduct(p,s));
  if (!items.length && !e.empty && requestedPool.length) errors.push('no recommendation');
  for (const p of items) {
    if (s.budget.amount_krw !== null && p.total > s.budget.amount_krw) errors.push(`over budget ${label(p)}`);
    if (s.excluded_categories.includes(p.category)) errors.push(`excluded category ${label(p)}`);
    const tagged = tagAllergens(`${p.name} ${p.name_en ?? ''}`).concat(p.allergens_declared ?? []);
    if (tagged.some(a => s.excluded_ingredients.includes(a))) errors.push(`allergen ${label(p)}`);
    if (s.preferences.includes('avoid_fragrance') && isFragranceProduct(p)) errors.push(`fragrance ${label(p)}`);
    if (genderMismatch(p, recipientGender(s.recipients))) errors.push(`wrong gender ${label(p)}`);
    if (giftFit(p) < 0) errors.push(`not gift-like ${label(p)}`);
  }
  // A taste binds the top pick only when the catalog has an affordable product of that kind; a tea or
  // coffee taste binds only when such a product exists.
  const fits = p => eligibleProduct(p, s);
  const affordable = c => products.some(p => p.category === c && fits(p));
  const wanted = s.preferences.filter(x => x.startsWith('category:')).map(x => x.slice(9)).filter(affordable);
  const top = items[0];
  const nameOk = re => products.some(p => fits(p) && re.test(`${p.name} ${p.name_en ?? ''}`));
  if (top && e.top) {
    if (e.top.category && affordable([e.top.category].flat()[0]) && ![e.top.category].flat().includes(top.category)) errors.push(`top category ${label(top)} ≠ ${e.top.category}`);
    if (e.top.name && nameOk(e.top.name) && !e.top.name.test(`${top.name} ${top.name_en ?? ''}`)) errors.push(`top name ${label(top)} !~ ${e.top.name}`);
  } else if (top && wanted.length && !wanted.includes(top.category)) errors.push(`top ${label(top)} ignores preference ${wanted}`);
  else if (top && !wanted.length && s.recipients.length && recipientCategories(s.recipients, { profiles: true }).size && !recipientCategories(s.recipients, { profiles: true }).has(top.category)) errors.push(`top ${label(top)} not suited to ${s.recipients}`);
  return errors;
}

// Independent acceptance gate: do not use the ranker's own output as the truth.
export function eligibleProduct(p, s) {
  const cost = p.price_krw + (s.budget.shipping_included ? p.shipping_fee_per_set_krw : 0);
  const allergens = tagAllergens(`${p.name} ${p.name_en ?? ''}`).concat(p.allergens_declared ?? []);
  return (s.budget.amount_krw === null || cost <= s.budget.amount_krw) && p.stock_sets >= 1 &&
    !s.excluded_categories.includes(p.category) && !allergens.some(a => s.excluded_ingredients.includes(a)) &&
    (!s.brand || s.brand === p.brand) && (!s.packaging || s.packaging === p.packaging) &&
    (!s.delivery_by || p.arrival_date <= s.delivery_by) &&
    !(s.preferences.includes('avoid_fragrance') && isFragranceProduct(p)) &&
    !(s.preferences.includes('avoid_wine') && p.category==='liquor' && /와인|포도주|\bwine\b/i.test(`${p.name} ${p.name_en??''}`)) &&
    !genderMismatch(p, recipientGender(s.recipients)) && !ageMismatch(p, recipientAge(s.recipients)) && giftFit(p) >= 0;
}

// An independent acceptance predicate, separate from the engine's ranking/typing functions.
export function requestedProduct(p,s) {
  const categories=s.preferences.filter(v=>v.startsWith('category:')).map(v=>v.slice(9));
  if(categories.length&&!categories.includes(p.category))return false;
  const name=`${p.name} ${p.name_en??''}`;
  if(p.category==='coffee_tea') {
    const wantsTea=s.preferences.includes('type:tea'), wantsCoffee=s.preferences.includes('type:coffee');
    if(wantsTea&&!wantsCoffee&&/커피|원두|coffee|espresso/i.test(name))return false;
    if(wantsCoffee&&!wantsTea&&!/커피|원두|coffee|espresso/i.test(name))return false;
  }
  if(p.category==='stationery'&&s.preferences.includes('type:writing')&&!/필기구|볼펜|만년필|샤프|형광펜|펜|\b(?:pen|pencil)s?\b/i.test(name))return false;
  if(p.category==='flower'&&s.preferences.includes('type:bouquet')&&!/꽃다발|bouquet/i.test(name))return false;
  return true;
}

if (process.argv[1]?.endsWith('recommend-eval.mjs')) {
  const source = process.argv.find(a => ['amazon', 'web', 'both'].includes(a)) ?? 'amazon';
  const verbose = process.argv.includes('--verbose');
  const products = catalog(source), { guestRun, serverRun, check } = runners(products);
  const pass = { guest: 0, server: 0 };
  for (const sc of SCENARIOS) {
    for (const [path, run] of [['guest', guestRun], ['server', serverRun]]) {
      const result = await run(sc.say);
      const errors = check(result, sc.expect);
      if (errors.length) console.log(`✖ [${path}] ${sc.say.join(' / ')}\n   ${errors.join('\n   ')}`);
      else { pass[path]++; if (verbose) console.log(`✔ [${path}] ${sc.say.join(' / ')} → ${result.items?.map(label).join(' | ')}`); }
    }
  }
  console.log(`${source} (${products.length}): guest ${pass.guest}/${SCENARIOS.length} · server ${pass.server}/${SCENARIOS.length}`);
}
