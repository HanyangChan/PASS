import { singleInitial, singleQuestion, singleTurn, engineState, finishSingle } from '../../../lib/single-gift.mjs';
import { recommend, apply, APP_RANKING } from '../../../lib/engine.mjs';
import { budgetAlternatives } from '../../../lib/counterfactual.mjs';
import type { ChatSession, Conditions, ConditionPatch, Gift, EngineProduct } from '../domain';
import { giftFromProduct } from '../catalog.ts';
import type { FeedbackSignal } from '../chatHistory.ts';

type Product = EngineProduct;
type RankedProduct = Product & { total: number };

// The local implementation is the guest/offline recommendation path.
// Only this service knows the engine's internal single-gift state conversion.
export function createLocalChatService(products: Product[], feedback: FeedbackSignal[] = []) {
  // Past card feedback re-weights ranking only; it never changes the conditions or the filters.
  const ranking = feedback.length ? { ...APP_RANKING, feedback: { liked: feedback.filter(f => f.helpful).map(f => f.giftId), disliked: feedback.filter(f => !f.helpful).map(f => f.giftId) } } : APP_RANKING;
  return {
    createSession(): ChatSession { return { state: singleInitial(), issues: [] }; },
    send(session: ChatSession, text: string) {
      const input = text.trim();
      if (!input) throw new Error('추천할 내용을 입력해주세요.');
      return singleTurn(session, input, products);
    },
    updateConditions(session: ChatSession, patch: ConditionPatch, clearIssues = true) {
      return finishSingle(session.state, apply(session.state, patch), clearIssues ? [] : session.issues, products);
    },
    view(session: ChatSession) {
      const state = engineState(session.state);
      return {
        question: singleQuestion(session),
        result: recommend(products, state, ranking),
        comparison: budgetAlternatives(products, state, ranking),
      };
    },
    toGift(product: RankedProduct, conditions: Conditions): Gift {
      return { ...giftFromProduct(product), price: product.total, shippingIncluded: conditions.budget.shipping_included === true };
    },
  };
}
