import { initial, APP_RANKING } from '../../lib/engine.mjs';
import { feedbackContext, productFeedbackKey } from '../../lib/feedback.mjs';
export const scope = 'conversation-1';
export const state = (patch = {}) => ({ ...initial(), recipients: ['어머니'], occasion: '생일', quantity: 1, same_product: true,
  budget: { amount_krw: 50000, scope: 'per_set', shipping_included: true }, ...patch });
export const product = (id, category = 'coffee_tea', extra = {}) => ({ id, name: id, category, price_krw: 40000,
  shipping_fee_per_set_krw: 0, stock_sets: 10, arrival_date: '2026-12-01', packaging: 'basic', sweetness: 'unknown',
  brand: null, allergens_declared: [], rating_count: 10, ...extra });
export const products = [product('tea-a'), product('tea-b'), product('tea-c'), product('watch-now', 'watch'),
  product('watch-old1', 'watch'), product('watch-old2', 'watch'), product('flower', 'flower', { occasions: ['birthday'] }),
  product('exam', 'stationery', { occasions: ['exam'] })];
export const record = (p, s, helpful = true, extra = {}) => ({ conversationId: scope, version: 2, kind: 'gift_preference',
  giftId: p.id, productKey: productFeedbackKey(p), helpful, context: feedbackContext(s, scope), at: '2026-11-16T01:00:00.000Z',
  rank: 1, agentMode: 'a-router', engineMode: 'rules', reason: 'fixture', ...extra });
export const options = (records, currentScope = scope) => ({ ...APP_RANKING, feedback: { records, scope: currentScope } });
