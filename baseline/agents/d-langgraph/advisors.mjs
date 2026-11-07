import { CATEGORIES, CATEGORY_NAMES } from '../../src/vendor/catalog.mjs';
import { OCCASIONS, LOOKAHEAD_DAYS, RELATIONSHIPS } from './tables.mjs';

// Each advisor reads the current conditions and the host-supplied context and returns
// { opinions, suggestions, auto }. Opinions explain, suggestions wait for the user, and
// `auto` holds soft preferences only. No advisor ranks products.
const day = 864e5;
const parse = d => Date.parse(`${d}T00:00:00Z`);
const addDays = (d, n) => new Date(parse(d) + n * day).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / day);
const md = d => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const won = n => `${n.toLocaleString('ko-KR')}원`;
const names = cats => cats.map(c => CATEGORY_NAMES[c] ?? c).join('·');
const ALIASES = { 어머니: /어머니|엄마/, 아버지: /아버지|아빠/, '직장 상사': /상사/ };
const aboutRecipient = (title, recipient) => (ALIASES[recipient] ?? new RegExp(recipient)).test(title);
function nextDate(occasion, today) {
  if (occasion.dates) return occasion.dates.find(d => d >= today) ?? null;
  const date = `${today.slice(0, 4)}-${occasion.md}`;
  return date >= today ? date : `${Number(today.slice(0, 4)) + 1}-${occasion.md}`;
}

export function occasion({ state, text = '', context }) {
  const { today, calendar = [] } = context;
  const recipient = state.recipients[0];
  const found = [];
  for (const o of OCCASIONS) {
    const date = nextDate(o, today);
    if (!date) continue;
    const mentioned = o.words.test(text) || state.occasion === o.name.replace('날', '');
    const soon = o.season && daysBetween(today, date) <= LOOKAHEAD_DAYS.season;
    if (mentioned || soon) found.push({ ...o, date, source: mentioned ? 'message' : 'holiday_table', mentioned });
  }
  for (const e of calendar) {
    if (!recipient || !aboutRecipient(e.title, recipient)) continue;
    const date = nextDate({ md: e.date }, today);
    const mentioned = e.kind === 'birthday' && /생일|생신/.test(text);
    if (mentioned || daysBetween(today, date) <= LOOKAHEAD_DAYS.calendar) found.push({ name: e.title, date, marginDays: 1, formal: false, source: 'calendar', mentioned });
  }
  if (!found.length) return { opinions: [], suggestions: [], auto: {} };
  const o = found.sort((a, b) => b.mentioned - a.mentioned || a.date.localeCompare(b.date))[0];
  const deadline = addDays(o.date, -o.marginDays);
  const late = deadline < today;
  const opinions = [{ id: 'occasion:date', text: `${o.name} D-${daysBetween(today, o.date)} (${md(o.date)})${late ? ' · 배송 마감이 지났을 수 있어요' : ''}`, source: o.source, effect: late ? 'info' : 'suggest' }];
  const suggestions = [];
  if (!late && !state.delivery_by) suggestions.push({ id: 'occasion:deadline', label: `${md(deadline)}까지 도착하는 상품만 보기`, patch: { delivery_by: deadline }, reason: `${o.name} ${o.marginDays}일 전 도착` });
  if (o.formal && !state.packaging) suggestions.push({ id: 'occasion:formal', label: '격식 있는 포장만 보기', patch: { packaging: 'formal' }, reason: `${o.name} 선물` });
  return { opinions, suggestions, auto: {} };
}

export function spending({ state, context }) {
  const amounts = (context.purchases ?? []).map(p => p.price_krw).filter(n => Number.isSafeInteger(n) && n > 0).sort((a, b) => a - b);
  if (!amounts.length) return { opinions: [], suggestions: [], auto: {} };
  const [low, high] = [amounts[0], amounts.at(-1)];
  const median = amounts[Math.floor((amounts.length - 1) / 2)];
  const budget = state.budget.amount_krw;
  const range = low === high ? won(low) : `${won(low)}~${won(high)}`;
  const note = budget === null ? '' : budget > high * 1.5 ? ' · 이번 예산이 평소보다 높아요' : budget < low * 0.5 ? ' · 이번 예산이 평소보다 낮아요' : '';
  const opinions = [{ id: 'spending:range', text: `예전 선물 ${amounts.length}건: ${range}${note}`, source: 'purchase_history', effect: budget === null ? 'suggest' : 'info' }];
  const target = Math.max(1000, Math.round(median / 1000) * 1000);
  const suggestions = budget === null ? [{ id: 'spending:budget', label: `예전처럼 ${won(target)} 이하로`, patch: { budget: { amount_krw: target } }, reason: `예전 선물 중간값 ${won(median)}` }] : [];
  return { opinions, suggestions, auto: {} };
}

export function taste({ state, context, statedThisTurn = false }) {
  const purchases = context.purchases ?? [];
  const cats = feedback => [...new Set(purchases.filter(p => p.feedback === feedback && CATEGORIES.includes(p.category)).map(p => p.category))];
  const liked = cats('liked').filter(c => !state.excluded_categories.includes(c));
  const disliked = cats('disliked').filter(c => !state.excluded_categories.includes(c) && !liked.includes(c));
  const remembered = context.memory?.preferences ?? [];
  const opinions = [], suggestions = [];
  const auto = {};
  if (remembered.length) opinions.push({ id: 'taste:memory', text: `기억된 선호: ${remembered.map(p => p.startsWith('category:') ? CATEGORY_NAMES[p.slice(9)] : p === 'less_sweet' ? '덜 단 것' : p === 'unsweetened' ? '단맛 없는 것' : p).join('·')}`, source: 'memory', effect: 'info' });
  const fresh = liked.filter(c => !state.preferences.includes(`category:${c}`));
  if (fresh.length && (statedThisTurn || state.preferences.some(p => p.startsWith('category:'))))
    opinions.push({ id: 'taste:liked', text: `지난번 만족한 ${names(fresh)}보다 이번 말씀을 우선했어요`, source: 'purchase_history', effect: 'info' });
  else if (fresh.length) {
    auto.preferences = fresh.map(c => `category:${c}`);
    opinions.push({ id: 'taste:liked', text: `지난번 만족한 ${names(fresh)} 선호 반영`, source: 'purchase_history', effect: 'auto' });
  }
  if (disliked.length) {
    opinions.push({ id: 'taste:disliked', text: `지난번 아쉬웠던 ${names(disliked)}`, source: 'purchase_history', effect: 'suggest' });
    suggestions.push({ id: 'taste:exclude', label: `${names(disliked)} 빼기`, patch: { excluded_categories: [...state.excluded_categories, ...disliked] }, reason: '구매 후 불만족' });
  }
  return { opinions, suggestions, auto };
}

export function relationship({ state }) {
  const rule = RELATIONSHIPS.find(r => state.recipients.some(name => r.match.test(name)));
  if (!rule) return { opinions: [], suggestions: [], auto: {} };
  const opinions = [{ id: 'relationship:suits', text: `${rule.group} 선물로 무난한 ${names(rule.suits)}에 가산점이 있어요`, source: 'engine_rule', effect: 'info' }];
  const avoid = (rule.avoid ?? []).filter(c => !state.excluded_categories.includes(c) && !state.preferences.includes(`category:${c}`));
  const suggestions = avoid.length ? [{ id: 'relationship:avoid', label: `사적인 품목(${names(avoid)}) 빼기`, patch: { excluded_categories: [...state.excluded_categories, ...avoid] }, reason: `${rule.group}에게는 부담될 수 있어요 (팀 검토 표)` }] : [];
  return { opinions, suggestions, auto: {} };
}

export const ADVISORS = { occasion, spending, taste, relationship };
