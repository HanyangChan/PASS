import { extract } from '../../src/vendor/engine.mjs';

const shopping = /선물|추천|골라|찾아|고르|있을까요|배송비|예산|한도|도착/;
const ambiguous = /비교|가정|이라면|원이라면|원일\s*때|원이면|혹은|또는|인지|아니라|말고|알레르|알러지|피해|제외|빼|않|싫|주는\s*사람|제\s*취향|(?:저는|제가|나는|내가).*(?:좋아|선호)|총액|합산|합쳐|최소|이상|여러\s*개|(?:두|세|네|다섯|[2-9]|[1-9]\d+)\s*(?:개|세트)(?!입)/;
const recipientPattern = /(?<![가-힣])(부모님|어머니|아버지|엄마|아빠|직장\s*동료|동료|친구|연인|교수님)(?=\s*(?:에게|께|한테|용|선물))/g;
const recipientLabels = { 엄마: '어머니', 아빠: '아버지', 직장동료: '직장동료' };

export function explicitShoppingConditions(text, state) {
  if (!shopping.test(text) || ambiguous.test(text)) return {};
  const { patch } = extract(text, { ...state, preferences: [] });
  const categories = patch.preferences?.filter(tag => tag.startsWith('category:')) ?? [];
  const matches = [...text.matchAll(recipientPattern)].map(([, label]) => label.replace(/\s+/g, ''));
  const recipients = [...new Set(matches.map(label => recipientLabels[label] ?? label))];
  const amounts = [...text.matchAll(/(?<![\d,.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(만\s*원|천\s*원|원)(?!어치)/g)];
  const budget = {};
  if (amounts.length === 1 && /예산|한도|이하|이내|안에|안에서|까지|넘지|상한/.test(text)) {
    const [, amount, unit] = amounts[0];
    const value = Number(amount.replaceAll(',', '')) * (unit.includes('만') ? 10000 : unit.includes('천') ? 1000 : 1);
    if (Number.isSafeInteger(value) && value > 0 && value <= 1e9) budget.amount_krw = value;
  }
  const included = /배송비\s*(?:까지|포함)|택배비\s*(?:까지|포함)/.test(text);
  const separate = /(?:배송비|택배비)\s*별도|상품\s*값만/.test(text);
  if (included !== separate) budget.shipping_included = included;
  const dates = text.match(/\d{4}\s*(?:년|-)\s*\d{1,2}\s*(?:월|-)\s*\d{1,2}/g);
  const deadline = dates?.length === 1 && /까지.*(?:도착|배송|수령|받)/.test(text) ? patch.delivery_by : null;
  const validDeadline = deadline && Number.isFinite(Date.parse(deadline)) &&
    new Date(deadline).toISOString().slice(0, 10) === deadline;
  return {
    ...(recipients.length === 1 ? { recipients } : {}),
    ...(Object.keys(budget).length ? { budget } : {}),
    ...(validDeadline ? { delivery_by: deadline } : {}),
    ...(categories.length ? { categories, types: patch.preferences.filter(tag => tag.startsWith('type:')) } : {}),
  };
}

export function applyExplicitConditions(decision, explicit, state) {
  const optionalRecipient = /받는\s*(?:사람|분)|받으실\s*분|(?:남성|여성|성별|남자친구|여자친구)/;
  const recipient = explicit.recipients?.[0];
  const optionalQuestion = decision.action === 'clarify' && recipient &&
    (optionalRecipient.test(decision.question) || decision.question.includes(recipient)) &&
    !/성분|알레르|알러지|배송비|예산|금액|날짜|납기|수량|누구의|누가/.test(decision.question);
  if (!optionalQuestion && !['search_products','update_conditions'].includes(decision.action)) return decision;

  const { categories = [], types = [], ...fields } = explicit;
  if (!Object.keys(fields).length && !categories.length) return decision;
  const original = decision.patch ?? {};
  const changedRecipient = (fields.recipients ?? original.recipients)?.join('\n') !== state.recipients.join('\n') &&
    Boolean(fields.recipients ?? original.recipients);
  const preferences = original.preferences ?? (changedRecipient && state.recipients.length ? [] : state.preferences);
  return {
    action: 'update_conditions',
    patch: {
      ...original,
      ...fields,
      ...(fields.budget ? { budget: { ...original.budget, ...fields.budget } } : {}),
      ...(categories.length ? { preferences: [...new Set([
        ...preferences.filter(tag => !tag.startsWith('category:') && !tag.startsWith('type:')),
        ...categories, ...types,
      ])] } : {}),
    },
  };
}
