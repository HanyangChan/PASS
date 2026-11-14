// Demo-field rules shared by the Amazon transform (transform.mjs) and the web catalog (web/enrich.mjs),
// so the same product name gets the same packaging and sweetness in both catalogs.
export const hash = text => [...String(text)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
/** Synthetic arrival in 2–4 days, stable per key. */
export const arrivalDays = key => 2 + hash(key) % 3;
// Korean: a bare 선물 ("출산선물 아기 양말", "생일 선물") only names the occasion, not the wrapping.
const FORMAL = /\b(gift|hamper|combo|set|box)\b|선물세트|선물박스|선물포장|선물바구니|기프트|박스|세트|바구니/i;
/** 'formal' when the name reads as a gift set or box, otherwise 'basic'. */
export const packagingFor = name => FORMAL.test(String(name ?? '')) ? 'formal' : 'basic';
const UNSWEETENED = /sugar[- ]?free|no added sugar|unsweetened|zero sugar|무가당|무설탕|제로\s?슈거|슈가\s?프리|설탕\s?무첨가/i;
/** 'unsweetened' when any of the given names says so, otherwise 'unknown'. */
export const sweetnessFor = (...names) => names.some(name => UNSWEETENED.test(String(name ?? ''))) ? 'unsweetened' : 'unknown';
