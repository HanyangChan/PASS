import { initial, apply } from './vendor/engine.mjs';
export class BaselineError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = () => { throw new BaselineError('invalid_input'); };
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const strings = x => Array.isArray(x) && x.length <= 50 && x.every(s => typeof s === 'string' && s.length > 0 && s.length <= 200);
export function validateState(s) {
  if (!object(s) || Object.keys(s).length !== Object.keys(initial()).length || Object.keys(s).some(k => !Object.hasOwn(initial(), k))) fail();
  for (const k of ['recipients','preferences','excluded_categories','excluded_ingredients']) if (!strings(s[k])) fail();
  for (const k of ['occasion','brand','delivery_by','packaging']) if (s[k] !== null && (typeof s[k] !== 'string' || s[k].length > 200)) fail();
  if (s.delivery_by !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(s.delivery_by) || !Number.isFinite(Date.parse(s.delivery_by)) || new Date(s.delivery_by).toISOString().slice(0,10) !== s.delivery_by)) fail();
  if (s.quantity !== null && (!Number.isSafeInteger(s.quantity) || s.quantity < 1 || s.quantity > 1000)) fail();
  if (![null,true,false].includes(s.same_product)) fail();
  const b = s.budget;
  if (!object(b) || Object.keys(b).sort().join() !== 'amount_krw,scope,shipping_included') fail();
  if (b.amount_krw !== null && (!Number.isSafeInteger(b.amount_krw) || b.amount_krw <= 0 || b.amount_krw > 1e9)) fail();
  if (![null,'total','per_set'].includes(b.scope) || ![null,true,false].includes(b.shipping_included)) fail();
  return s;
}
export function checkedPatch(state, patch) {
  if (!object(patch) || Object.keys(patch).some(k => !Object.hasOwn(initial(), k))) fail();
  if (Object.hasOwn(patch,'budget') && (!object(patch.budget) || Object.keys(patch.budget).some(k => !Object.hasOwn(initial().budget,k)))) fail();
  return validateState(apply(state, patch));
}
export function createSession(id) {
  if (typeof id !== 'string' || !id.trim() || id.length > 200) fail();
  return { id, version:0, state:initial() };
}
export function validateSession(s) {
  if (!object(s) || typeof s.id !== 'string' || !s.id.trim() || s.id.length > 200 || !Number.isSafeInteger(s.version) || s.version < 0) fail();
  validateState(s.state);
}
export function validateCatalog(products) {
  if (!Array.isArray(products)) fail();
  const ids = new Set();
  for (const p of products) {
    if (!object(p) || typeof p.id !== 'string' || !p.id || ids.has(p.id) || typeof p.name !== 'string' || typeof p.category !== 'string') fail();
    ids.add(p.id);
    for (const k of ['price_krw','shipping_fee_per_set_krw','stock_sets','rating_count']) if (!Number.isSafeInteger(p[k]) || p[k] < 0 || p[k] > 1e9) fail();
    if (!strings(p.allergens_declared) || typeof p.arrival_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.arrival_date) || !Number.isFinite(Date.parse(p.arrival_date)) || new Date(p.arrival_date).toISOString().slice(0,10) !== p.arrival_date) fail();
  }
}
