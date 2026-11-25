const food = new Set(['snack', 'food', 'coffee_tea', 'health']);
const singleGiftLimit = /(?:선물|상품|제품)(?:은|을|이)?\s*(?:한\s*(?:개|세트)|하나)|(?:한\s*(?:개|세트)|하나)\s*(?:기준|씩|만|당)|단일\s*선물/;

export function scoreTurn(spec, data, status, ids, byId, ingredientEvidence, candidateIds = []) {
  const answered = status === 200 && Boolean(data.session?.state) && data.question?.key === null
    && data.routing?.route !== 'fallback';
  if (status !== 200) {
    ids = [];
    candidateIds = [];
    data = {};
  }
  const result = {};
  if (spec.expectedIds) {
    result.returnedTarget = spec.expectedIds.some(id => ids.includes(id));
    result.hit1 = answered && spec.expectedIds.includes(ids[0]);
    result.hit3 = answered && result.returnedTarget;
    result.candidatePreview = Boolean(data.question?.key && candidateIds.length);
    result.candidateHit3 = result.candidatePreview && spec.expectedIds.some(id => candidateIds.includes(id));
    result.visibleHit3 = result.hit3 || result.candidateHit3;
  }
  if (spec.quantity > 1) {
    result.unsupportedQuantity = true;
    result.quantityLimitExplained = status === 200 && singleGiftLimit.test(data.message ?? '');
  } else if (spec.categories) {
    const state = data.session?.state;
    result.conditionsApplied = state?.budget?.amount_krw === spec.budget
      && state.budget.shipping_included === true && (!spec.deliveryBy || state.delivery_by === spec.deliveryBy);
    result.eligibleItems = ids.filter(id => {
      const p = byId.get(id);
      return p && spec.categories.includes(p.category) && p.stock_sets >= 1
        && p.price_krw + p.shipping_fee_per_set_krw <= spec.budget
        && (!spec.deliveryBy || p.arrival_date <= spec.deliveryBy);
    }).length;
    result.recommendedItems = ids.length;
    result.hasEligibleRecommendation = result.eligibleItems > 0;
    result.answeredWithEligibleRecommendation = answered && result.conditionsApplied && result.hasEligibleRecommendation;
  }
  if (Object.hasOwn(spec, 'ingredient')) {
    result.ingredientStored = spec.ingredient ? Boolean(data.session?.state?.excluded_ingredients?.includes(spec.ingredient)) : null;
    result.clarificationRequired = spec.ingredient === null;
    result.clarified = result.clarificationRequired ? Boolean(data.question?.key && /성분|알레르기/.test(data.question.text)) : null;
    const visibleIds = [...new Set([...ids, ...candidateIds])];
    result.knownViolations = spec.ingredient ? visibleIds.filter(id => ingredientEvidence[id]?.contains.includes(spec.ingredient)) : [];
    const violating = new Set(result.knownViolations);
    result.unverifiedFoodIds = visibleIds.filter(id => food.has(byId.get(id)?.category) && !violating.has(id));
    result.questionsWithCards = result.clarified === true && visibleIds.length > 0;
    result.needsReview = true;
  }
  return result;
}
