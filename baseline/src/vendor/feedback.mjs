// Feedback is an observation about one product in one explicitly scoped situation.
// Explanation helpfulness and unscoped legacy records never imply a product preference.
const arrays = ['recipients', 'preferences', 'excluded_categories', 'excluded_ingredients'];
const nullable = ['occasion', 'brand', 'delivery_by', 'packaging'];
const strings = value => Array.isArray(value) && value.length <= 30 && value.every(v => typeof v === 'string' && v.length <= 100);
export function feedbackContext(state, scope) {
  if (typeof scope !== 'string' || !scope || scope.length > 100 || !state || !arrays.every(k => strings(state[k])) ||
      !nullable.every(k => state[k] === null || typeof state[k] === 'string' && state[k].length <= 100) ||
      !state.budget || !(state.budget.amount_krw === null || Number.isSafeInteger(state.budget.amount_krw) && state.budget.amount_krw > 0) ||
      ![null, true, false].includes(state.budget.shipping_included)) return null;
  const normalized = key => [...new Set(state[key])].sort();
  const snapshot = {
    recipients: normalized('recipients'), preferences: normalized('preferences'),
    excluded_categories: normalized('excluded_categories'), excluded_ingredients: normalized('excluded_ingredients'),
    occasion: state.occasion, brand: state.brand, delivery_by: state.delivery_by, packaging: state.packaging,
    budget: { amount_krw: state.budget.amount_krw, shipping_included: state.budget.shipping_included },
  };
  return { scope, state: snapshot };
}
export const productFeedbackKey = product => `${product.source || 'catalog'}:${product.id}`;
export function validProductFeedback(record) {
  if (!record || record.version !== 2 || record.kind !== 'gift_preference' || typeof record.giftId !== 'string' || !record.giftId || record.giftId.length > 200 ||
      typeof record.productKey !== 'string' || !record.productKey || record.productKey.length > 300 || typeof record.helpful !== 'boolean' ||
      typeof record.at !== 'string' || record.at.length > 40 || !Number.isFinite(Date.parse(record.at))) return false;
  return !!feedbackContext(record.context?.state, record.context?.scope);
}
export function feedbackIdentity(record) {
  return JSON.stringify([record.kind || 'reason_helpfulness', record.productKey || record.giftId,
    record.context ? feedbackContext(record.context.state, record.context.scope) : record.conversationId]);
}
export function contextualFeedbackWeights(products, state, feedback) {
  const context = feedbackContext(state, feedback?.scope);
  const weights = new Map();
  if (!context || !Array.isArray(feedback?.records)) return weights;
  const key = JSON.stringify(context), latest = new Map();
  for (const record of feedback.records.slice(-200)) {
    if (!validProductFeedback(record) || JSON.stringify(feedbackContext(record.context.state, record.context.scope)) !== key) continue;
    const previous = latest.get(record.productKey);
    if (!previous || Date.parse(record.at) >= Date.parse(previous.at)) latest.set(record.productKey, record);
  }
  for (const product of products) {
    const record = latest.get(productFeedbackKey(product));
    if (record?.giftId === product.id) weights.set(product.id, record.helpful ? 1 : -1);
  }
  return weights;
}
