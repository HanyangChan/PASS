// ⑤ verifier (TRD §7, AC11). Deterministic, no LLM. Checks an explainer answer against the Factsheet only:
// structure and length, every number backed by a factsheet value or a difference of them, product names, mentioned
// memories, no condition-A leak (AC12), banned words (R7), allergy notice kept. Returns reasons per item so the
// orchestrator can ask once more and then replace only the failing items with the template.
import { MAX_TAG } from '../explainer/template.mjs';
import { findBanned, claimsAllergySafety, withoutNames } from './banned-words.mjs';

export const B_FIELDS = ['contrastChip', 'memoryCfLine', 'ladderChips', 'ladderNotice'];
const FIELDS = new Set(['id', 'tags', ...B_FIELDS]);
const MAX_LINE = 40;
const B_WORDING = /2위(?:보다|와)|없었다면|아끼기|올리기/;

/**
 * Numbers with their unit, normalized: "1.5만원" {15000,'won'}, "1만 5천원" 15000, "8천 원" 8000, "9,000원" 9000,
 * "1,200개" {1200,'count'}, "2위" {2,'rank'}, anything else 'plain'. Pure.
 */
export function numbersWithUnits(text) {
  let t = String(text ?? '').replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  const out = [];
  const take = (re, unit, f) => { t = t.replace(re, (...m) => { out.push({ value: f(m), unit }); return ' '; }); };
  take(/(\d+(?:\.\d+)?)\s*만\s*(?:(\d+)\s*천)?\s*원?/g, 'won', m => Math.round(Number(m[1]) * 10000 + (m[2] ? Number(m[2]) * 1000 : 0)));
  take(/(\d+(?:\.\d+)?)\s*천\s*원?/g, 'won', m => Math.round(Number(m[1]) * 1000));
  take(/(\d+(?:\.\d+)?)\s*원/g, 'won', m => Number(m[1]));
  take(/(\d+(?:\.\d+)?)\s*개/g, 'count', m => Number(m[1]));
  take(/(\d+)\s*위/g, 'rank', m => Number(m[1]));
  take(/(\d+(?:\.\d+)?)/g, 'plain', m => Number(m[1]));
  return { numbers: out, rest: t };
}
export const numbersIn = text => numbersWithUnits(text).numbers.map(n => n.value);
// "오천원", "만 오천 원": money written in Hangul numerals cannot be checked, so it is refused.
const HANGUL_MONEY = /[일이삼사오육칠팔구십백천만]\s*원/;
// Internal tokens must never reach the screen (category:fitness, less_sweet, pref:…). A lone capital (단 음식 X) is fine.
const INTERNAL_TOKEN = /[A-Za-z_]{2,}|[A-Za-z]+\s*:|_/;
// Comparisons between cards belong to the contrast chip (B only). Tags are condition-neutral (F5), so no tag compares,
// except the template's own "리뷰 가장 많음" (same in A and B, review decision 4: default).
const COMPARISON = /보다|[1-9]\s*위|다른 상품|타 상품|더 많|더 적|더 싸|더 저렴|더 비싸/;

const textsOf = item => [...(Array.isArray(item.tags) ? item.tags : []), item.contrastChip, item.memoryCfLine, item.ladderNotice,
  ...(Array.isArray(item.ladderChips) ? item.ladderChips.map(c => c?.label) : [])].filter(x => typeof x === 'string');

/**
 * Numbers a TAG may use, per unit: money = this card's cost / budget / headroom, count = its review count. No differences
 * to other cards (that is a comparison, B contrast chip only), so condition A cannot show contrast facts (AC12).
 */
function tagNumbers(fact) {
  const set = (...xs) => new Set(xs.filter(Number.isFinite).map(Math.abs));
  return { won: set(fact.budgetCost, fact.budget, fact.headroom), count: set(fact.ratingCount), rank: new Set(), plain: new Set() };
}

/** The contrast chip: only the numbers and the direction of its own kind (K41 facts). */
function contrastOk(chip, c) {
  const { numbers } = numbersWithUnits(chip);
  const only = (unit, allowed) => numbers.every(n => (n.unit === unit && allowed.includes(n.value)) || (n.unit === 'rank' && n.value === 2));
  switch (c.kind) {
    case 'rating_count': return /많/.test(chip) && !/적/.test(chip) && only('count', [c.diff]);
    case 'budget_cost': return /저렴|싸/.test(chip) && !/비싸/.test(chip) && only('won', [c.diff]);
    case 'sweetness': return /덜/.test(chip) && only('none', []);
    default: return only('none', []);
  }
}

/**
 * @param {{output:any, factsheet:object, products:object[]}} p
 * @returns {{ok:boolean, reasons:{id:string|null, code:string}[], valid:Map<string, object>}}  valid = items that passed
 */
export function verifyExplanations({ output, factsheet, products }) {
  const reasons = [], valid = new Map();
  const items = output?.items;
  const ids = factsheet.items.map(i => i.id);
  if (!Array.isArray(items)) return { ok: false, reasons: [{ id: null, code: 'structure' }], valid };
  const seen = new Set();
  const allNames = products.map(p => p.name);
  const recipientsOf = fact => new Set(fact.usedMemories.map(m => m.recipientName).filter(Boolean));
  const memoryLabels = new Set([...factsheet.items.flatMap(i => i.usedMemories.map(m => m.label)), factsheet.memoryCf?.label].filter(l => l && l.length >= 2));
  const isB = factsheet.experiment === 'B';

  for (const item of items) {
    const fail = code => reasons.push({ id: typeof item?.id === 'string' ? item.id : null, code });
    const before = reasons.length;
    const fact = factsheet.items.find(f => f.id === item?.id);
    if (!item || typeof item !== 'object' || !fact || seen.has(item.id)) { fail('structure'); continue; }
    seen.add(item.id);
    if (Object.keys(item).some(k => !FIELDS.has(k))) fail('structure');
    const tags = item.tags;
    if (!Array.isArray(tags) || tags.length < 2 || tags.length > 3 || !tags.every(t => typeof t === 'string' && t.trim() && t.length <= MAX_TAG)) fail('tag_shape');
    if (new Set(tags ?? []).size !== (tags ?? []).length) fail('tag_shape');
    for (const k of ['contrastChip', 'memoryCfLine', 'ladderNotice']) if (item[k] !== undefined && (typeof item[k] !== 'string' || !item[k].trim() || item[k].length > MAX_LINE)) fail('line_shape');
    const texts = textsOf(item);

    // AC12: condition A has none of the B fields, not even their wording
    const hasB = B_FIELDS.some(k => item[k] !== undefined);
    if (!isB && (hasB || texts.some(t => B_WORDING.test(withoutNames(t, allNames))))) fail('condition_a_leak');
    if (isB && hasB && fact.rank !== 1) fail('b_field_not_top');
    if (isB && fact.rank === 1) {
      if (item.contrastChip !== undefined) {
        const c = factsheet.contrast;
        if (!c || !contrastOk(item.contrastChip, c)) fail('contrast_unbacked');
        else if (allNames.some(n => item.contrastChip.includes(n) && n !== c.topName && n !== c.secondName)) fail('product_name');
      }
      if (item.memoryCfLine !== undefined) {
        const cf = factsheet.memoryCf; // AC10: only when rank 1 really changes, naming exactly the recomputed rank 1
        if (!cf || !item.memoryCfLine.includes(cf.newTopName) || !item.memoryCfLine.includes(cf.label)) fail('memory_cf_unbacked');
        else if (allNames.some(n => n !== cf.newTopName && !cf.newTopName.includes(n) && item.memoryCfLine.includes(n))) fail('product_name');
        else if (numbersWithUnits(withoutNames(item.memoryCfLine, allNames)).numbers.some(n => !(n.unit === 'rank' && n.value === 1))) fail('number_unbacked');
      }
      if (item.ladderChips !== undefined) {
        const options = [...(factsheet.valueLadder?.down ?? []), ...(factsheet.valueLadder?.up ?? [])];
        const ok = Array.isArray(item.ladderChips) && item.ladderChips.every(ch => {
          const o = options.find(x => x.direction === ch?.direction && x.amount_krw === ch?.amount_krw);
          if (!o || typeof ch.label !== 'string' || ch.label.length > MAX_LINE) return false;
          if (!ch.label.startsWith(o.direction === 'down' ? '아끼기' : '올리기')) return false;
          const nums = numbersIn(ch.label);
          return nums.length === 1 && nums[0] === Math.abs(o.costDelta);
        }) && new Set(item.ladderChips.map(c => c.direction)).size === item.ladderChips.length;
        if (!ok) fail('ladder_unbacked'); // AC13/AC14: no 올리기 that the planner did not produce
      }
      if (item.ladderNotice !== undefined && item.ladderNotice !== factsheet.valueLadder?.upNotice) fail('ladder_unbacked');
    }

    // numbers in tags: each one a fact of this card with the matching unit (AC11); chips are checked above
    const allowed = tagNumbers(fact);
    if ((tags ?? []).some(t => numbersWithUnits(withoutNames(t, allNames)).numbers.some(n => !allowed[n.unit].has(n.value)))) fail('number_unbacked');
    if (texts.some(t => HANGUL_MONEY.test(numbersWithUnits(withoutNames(t, allNames)).rest))) fail('number_unbacked');
    if ((tags ?? []).some(t => COMPARISON.test(withoutNames(t, allNames)))) fail(isB ? 'tag_compares' : 'condition_a_leak');
    if (texts.some(t => INTERNAL_TOKEN.test(withoutNames(t, allNames)))) fail('internal_token');
    // product names: only this card's, or the ones the B facts name (checked above)
    if ([...(tags ?? [])].some(t => allNames.some(n => n !== fact.name && t.includes(n)))) fail('product_name');
    // memories: a named person or a memory label must belong to a memory this card actually used
    const people = recipientsOf(fact), used = new Set(fact.usedMemories.map(m => m.label));
    for (const t of tags ?? []) {
      const plain = withoutNames(t, allNames);
      for (const m of plain.matchAll(/\(([^)]+)\)/g)) if (!people.has(m[1])) fail('memory_unbacked');
      for (const l of memoryLabels) if (plain.includes(l) && !used.has(l)) fail('memory_unbacked');
      for (const v of fact.matchedPreferences) {
        const mt = factsheet.memoryTags?.[v];
        if (mt && fact.categoryKo && plain.trim() === `${fact.categoryKo} 선호`) fail('memory_tag_form'); // use the memory's words
      }
    }
    if (texts.some(t => findBanned(t, allNames).length)) fail('banned_word');
    if (texts.some(t => claimsAllergySafety(t, allNames))) fail('allergy_notice');
    if (reasons.length === before) valid.set(item.id, item);
  }
  for (const id of ids) if (!seen.has(id)) reasons.push({ id, code: 'missing_item' });
  const unique = [];
  for (const r of reasons) if (!unique.some(u => u.id === r.id && u.code === r.code)) unique.push(r);
  return { ok: unique.length === 0, reasons: unique, valid };
}
