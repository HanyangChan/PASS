import { singleInitial, singleQuestion, engineState, finishSingle } from '../../../lib/single-gift.mjs';
import { prototypeRouterTurn } from '../../../api/router-agent.mjs';
import { recommend, apply, APP_RANKING } from '../../../lib/engine.mjs';
import { budgetAlternatives } from '../../../lib/counterfactual.mjs';
import type { ChatSession, ChatMessage, Conditions, ConditionPatch, Gift, EngineProduct } from '../domain';
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
    // Same rules-first router as the server's mode A, without a model: guests get the same understanding.
    async send(session: ChatSession, text: string, history: ChatMessage[] = []) {
      const input = text.trim();
      if (!input) throw new Error('추천할 내용을 입력해주세요.');
      const turn = await (prototypeRouterTurn as (...args: unknown[]) => Promise<{ session: ChatSession; message: string }>)({ operation: 'turn', state: session.state, issues: session.issues, text: input, history: history.slice(-6), source: 'typed' }, products, { ranking });
      return { session: turn.session, message: turn.message, question: singleQuestion(turn.session) };
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
