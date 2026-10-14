import { singleInitial, singleQuestion, singleTurn, engineState, finishSingle } from '../../../lib/single-gift.mjs';
import { recommend, apply } from '../../../lib/engine.mjs';
import { budgetAlternatives } from '../../../lib/counterfactual.mjs';
import type { ChatSession, Conditions, ConditionPatch, Gift } from '../domain';

type Product = (typeof import('../../../lib/products.json'))[number];
type RankedProduct = Product & { total: number };

// The local implementation is the guest/offline recommendation path.
// Only this service knows the engine's internal single-gift state conversion.
export function createLocalChatService(products: Product[], categoryNames: Record<string, string>) {
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
        result: recommend(products, state),
        comparison: budgetAlternatives(products, state),
      };
    },
    toGift(product: RankedProduct, conditions: Conditions): Gift {
      return {
        id: product.id, name: product.name.replace('가상 ', ''),
        category: categoryNames[product.category] ?? product.category,
        price: product.total, description: product.description,
        icon: (['fruit', 'hangwa', 'nuts', 'tea', 'coffee', 'oil'] as const).includes(product.category as never)
          ? (product.category as Gift['icon'])
          : 'gift',
        source: 'engine',
        shippingIncluded: conditions.budget.shipping_included === true,
        packaging: product.packaging === 'formal' ? '격식 있는 포장' : '기본 포장',
        arrival: product.arrival_date,
        ingredients: product.ingredients,
        sweetness: product.sweetness,
        brand: product.brand,
        allergensDeclared: product.allergens_declared,
        allergenInfoComplete: product.allergen_information_complete,
      };
    },
  };
}
