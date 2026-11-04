// Memory key vocabulary (TRD §5.2). Keys outside this table are refused everywhere.
// Polarity: allergy/dislike are avoidance (-1); pref/hobby/constraint are +1.
// The flipped sign is a "negation": it is never stored, it only triggers a conflict check.
import { CATEGORIES } from '../../../src/vendor/catalog.mjs';
import { ALLERGEN_NAMES } from '../../../src/vendor/allergens.mjs';

const SOFT = ['less_sweet', 'unsweetened'];
const PACKAGING = ['formal', 'basic'];
const CATEGORY_KO = {
  food: '식품', snack: '과자·간식', coffee_tea: '커피·차', health: '건강식품', beauty: '뷰티', makeup: '메이크업',
  personal_care: '생활가전', kitchen: '주방용품', decor: '홈데코', jewelry: '주얼리', watch: '시계', bag: '가방',
  accessory: '패션소품', audio: '음향기기', toy: '장난감', fitness: '운동용품',
};

export class MemoryError extends Error {
  constructor(code) { super(code); this.code = code; }
}

/** @returns {{kind:string, value:string}|null} */
export function parseKey(key) {
  if (typeof key !== 'string' || key.length > 100) return null;
  let m;
  if ((m = key.match(/^pref:category:(.+)$/)) && CATEGORIES.includes(m[1])) return { kind: 'pref_category', value: m[1] };
  if ((m = key.match(/^pref:(.+)$/)) && SOFT.includes(m[1])) return { kind: 'pref_soft', value: m[1] };
  if ((m = key.match(/^dislike:category:(.+)$/)) && CATEGORIES.includes(m[1])) return { kind: 'dislike_category', value: m[1] };
  if ((m = key.match(/^allergy:(.+)$/)) && ALLERGEN_NAMES.includes(m[1])) return { kind: 'allergy', value: m[1] };
  if ((m = key.match(/^constraint:packaging:(.+)$/)) && PACKAGING.includes(m[1])) return { kind: 'packaging', value: m[1] };
  if ((m = key.match(/^hobby:(.+)$/)) && m[1].trim() === m[1] && m[1].length <= 30 && !m[1].includes(':')) return { kind: 'hobby', value: m[1] };
  return null;
}

const canonicalPolarity = kind => (kind === 'allergy' || kind === 'dislike_category' ? -1 : 1);

/** @returns {{ok:true, negation:boolean}|{ok:false}} */
export function checkKey(key, polarity) {
  const k = parseKey(key);
  if (!k || (polarity !== 1 && polarity !== -1)) return { ok: false };
  return { ok: true, negation: polarity !== canonicalPolarity(k.kind) };
}

export const isAllergyKey = key => parseKey(key)?.kind === 'allergy';

/** Engine state field for a stored (non-negated) key; null when the key is not a direct condition (hobby). */
export function keyToField(key) {
  const k = parseKey(key);
  if (!k) return null;
  switch (k.kind) {
    case 'pref_category': return { field: 'preferences', value: `category:${k.value}` };
    case 'pref_soft': return { field: 'preferences', value: k.value };
    case 'dislike_category': return { field: 'excluded_categories', value: k.value };
    case 'allergy': return { field: 'excluded_ingredients', value: k.value };
    case 'packaging': return { field: 'packaging', value: k.value };
    default: return null;
  }
}

export function keyLabel(key) {
  const k = parseKey(key);
  if (!k) return '';
  switch (k.kind) {
    case 'pref_category': return `${CATEGORY_KO[k.value]} 선호`;
    case 'pref_soft': return k.value === 'less_sweet' ? '단 음식 X' : '무가당';
    case 'dislike_category': return `${CATEGORY_KO[k.value]} 제외`;
    case 'allergy': return `${k.value} 제외`;
    case 'packaging': return k.value === 'formal' ? '격식 포장' : '기본 포장';
    default: return k.value;
  }
}

const CATEGORY_OPPOSED = [['like', 'not_like'], ['like', 'avoid'], ['avoid', 'fine']];

/** Concept + stance of (key, polarity); two entries conflict when concept matches and stance differs. */
function stance(key, polarity) {
  const k = parseKey(key);
  if (!k) return null;
  switch (k.kind) {
    // like/not_like (pref ±1), avoid/fine (dislike -1/+1). Opposed pairs are listed in CATEGORY_OPPOSED.
    case 'pref_category': return { concept: `category:${k.value}`, stance: polarity === 1 ? 'like' : 'not_like' };
    case 'dislike_category': return { concept: `category:${k.value}`, stance: polarity === -1 ? 'avoid' : 'fine' };
    case 'pref_soft': return { concept: key, stance: polarity === 1 ? 'yes' : 'no' };
    case 'allergy': return { concept: key, stance: polarity === -1 ? 'avoid' : 'ok' };
    case 'hobby': return { concept: key, stance: polarity === 1 ? 'yes' : 'no' };
    case 'packaging': return polarity === 1 ? { concept: 'packaging', stance: k.value } : { concept: 'packaging', stance: `not:${k.value}` };
    default: return null;
  }
}

export function conflicts(a, b) {
  const x = stance(a.key, a.polarity), y = stance(b.key, b.polarity);
  if (!x || !y || x.concept !== y.concept) return false;
  if (x.concept === 'packaging') {
    const pk = s => (s.startsWith('not:') ? [s.slice(4), false] : [s, true]);
    const [xv, xp] = pk(x.stance), [yv, yp] = pk(y.stance);
    return xp && yp ? xv !== yv : xv === yv && xp !== yp;
  }
  if (x.concept.startsWith('category:')) return CATEGORY_OPPOSED.some(([p, q]) => (x.stance === p && y.stance === q) || (x.stance === q && y.stance === p));
  return x.stance !== y.stance;
}
