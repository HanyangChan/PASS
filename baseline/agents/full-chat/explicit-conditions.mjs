import { extract } from '../../src/vendor/engine.mjs';
import { CATEGORY_NAMES } from '../../src/vendor/catalog.mjs';

const shopping = /선물|추천|골라|찾아|고르|있을까요|배송비|택배비|예산|한도|도착/;
const ambiguous = /비교|가정|이라면|원이라면|원일\s*때|원이면|혹은|또는|인지|아니라|말고|알레르|알러지|피해|제외|빼|않|싫|주는\s*사람|제\s*취향|(?:저는|제가|나는|내가).*(?:좋아|선호)|총액|합산|합쳐|최소|이상|여러\s*개|(?:두|세|네|다섯|[2-9]|[1-9]\d+)\s*(?:개|세트)(?!입)/;
const recipientPattern = /(?<![가-힣])(부모님|어머니|아버지|엄마|아빠|직장\s*동료|동료|친구|연인|교수님)(?=\s*(?:에게|께|한테|용|선물))/g;
const recipientLabels = { 엄마: '어머니', 아빠: '아버지', 직장동료: '직장동료' };
const shippingIncluded = /(?:배송|배송비|택배비)(?:도|를|까지)?\s*(?:포함|넣어|더해)|(?:배송비|택배비)\s*까지/;
const amountSource = '(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)\\s*(만\\s*원|천\\s*원|원)';
const amountPattern = new RegExp(`(?<![\\d,.])${amountSource}(?!어치)`,'g');
const unchangedConditions = /^(?:(?:배송비?\s*포함\s*)?예산|(?:나머지\s*)?조건)(?:은|는)?\s*그대로(?:야|요|예요|에요|입니다|\s*(?:유지해|유지해줘|유지해\s*주세요|둬|둬줘|두세요))?$/;
const budgetChange = new RegExp(`^(?:(?:배송비|택배비)(?:를|도)?\\s*(?:까지(?:\\s*포함)?|포함(?:해서)?|넣어|더해|별도(?:로)?)\\s*)?(?:예산(?:은|을)?\\s*)?${amountSource}\\s*(?:까지만|까지|이하|이내|안으로|으로|로|한도로)(?:\\s*(?:쓸게(?:요)?|바꿔\\s*(?:줘|주세요)?|맞춰\\s*(?:줘|주세요)?|해줘|해주세요))?$`);
const transition = /^\s*([^.!?\n,;]{1,80}?)(?:으로|로)\s*(?:바꿔(?:\s*(?:줘|주세요))?|변경(?:해\s*(?:줘|주세요))?|보고\s*싶(?:어요|습니다|어)|볼래(?:요)?)(?=$|[\s,.!?;])/;
const categoryByLabel = new Map(Object.entries(CATEGORY_NAMES).flatMap(([category,name])=>
  [...new Set([name,...name.split('·')])].map(label=>[label.replace(/\s+/g,''),category])));
const categoryAliases = { 손목시계:'watch', 이어폰:'audio', 헤드폰:'audio', 스피커:'audio',
  녹차:'coffee_tea', 홍차:'coffee_tea', 인테리어소품:'decor' };

function categoryReplacement(text, state) {
  const match = transition.exec(text);
  if (!match) return null;
  const clauses = match[1].split(/\s+대신\s+/);
  const phrase = clauses.at(-1).replace(/^(?:생각이\s*바뀌어서|이번에는|이번엔|이제)\s*/,'').trim();
  const label = phrase.replace(/\s+/g,'').replace(/(?:선물|제품|상품)$/,'');
  const category = categoryByLabel.get(label)??(Object.hasOwn(categoryAliases,label)?categoryAliases[label]:null);
  const tags = extract(phrase+'로',{...state,preferences:[]}).patch.preferences??[];
  if (!category) return clauses.length>1 || tags.some(tag=>tag.startsWith('category:'))?{}:null;
  if (clauses.length>2 || [...text.matchAll(recipientPattern)].length) return {};
  const tail = text.slice(match[0].length).replace(/^[\s,.!?;]+|[\s,.!?;]+$/g,'');
  const keepsBudget = unchangedConditions.test(tail);
  if (tail && !keepsBudget && !budgetChange.test(tail)) return {};
  return {categories:[`category:${category}`],types:tags.filter(tag=>tag.startsWith('type:')),budgetText:keepsBudget?'':tail};
}

export function explicitShoppingConditions(text, state) {
  if (ambiguous.test(text) || /지\s*마|하지\s*말/.test(text)) return {};
  const replacement = categoryReplacement(text,state);
  if (replacement && !replacement.categories) return {};
  if (!replacement && !shopping.test(text)) return {};
  const { patch } = extract(text, { ...state, preferences: [] });
  const categories = replacement?.categories??patch.preferences?.filter(tag => tag.startsWith('category:'))??[];
  const budgetText = replacement?.budgetText??text;
  const matches = [...text.matchAll(recipientPattern)].map(([, label]) => label.replace(/\s+/g, ''));
  const recipients = [...new Set(matches.map(label => recipientLabels[label] ?? label))];
  const amounts = [...budgetText.matchAll(amountPattern)];
  const budget = {};
  if (amounts.length === 1 && (replacement || /예산|한도|이하|이내|안에|안에서|까지|넘지|상한/.test(budgetText))) {
    const [, amount, unit] = amounts[0];
    const value = Number(amount.replaceAll(',', '')) * (unit.includes('만') ? 10000 : unit.includes('천') ? 1000 : 1);
    if (Number.isSafeInteger(value) && value > 0 && value <= 1e9) budget.amount_krw = value;
  }
  if (replacement?.budgetText && budget.amount_krw===undefined) return {};
  const included = shippingIncluded.test(budgetText);
  const separate = /(?:배송비|택배비)(?:를|도)?\s*별도|상품\s*값만/.test(budgetText);
  if (included !== separate) budget.shipping_included = included;
  const dates = text.match(/\d{4}\s*(?:년|-)\s*\d{1,2}\s*(?:월|-)\s*\d{1,2}/g);
  const deadline = dates?.length === 1 && /까지.*(?:도착|배송|수령|받)/.test(text) ? patch.delivery_by : null;
  const validDeadline = deadline && Number.isFinite(Date.parse(deadline)) &&
    new Date(deadline).toISOString().slice(0, 10) === deadline;
  return {
    ...(recipients.length === 1 ? { recipients } : {}),
    ...(Object.keys(budget).length ? { budget } : {}),
    ...(validDeadline ? { delivery_by: deadline } : {}),
    ...(categories.length ? { categories, types: replacement?.types??patch.preferences.filter(tag => tag.startsWith('type:')) } : {}),
    ...(replacement ? { replaceCategory: true } : {}),
  };
}

export function applyExplicitConditions(decision, explicit, state) {
  const optionalRecipient = /받는\s*(?:사람|분)|받으실\s*분|(?:남성|여성|성별|남자친구|여자친구)/;
  const recipient = explicit.recipients?.[0];
  const optionalQuestion = decision.action === 'clarify' && recipient &&
    (optionalRecipient.test(decision.question) || decision.question.includes(recipient)) &&
    !/성분|알레르|알러지|배송비|예산|금액|날짜|납기|수량|누구의|누가/.test(decision.question);
  if (!optionalQuestion && !['search_products','update_conditions'].includes(decision.action)) return decision;

  const { categories = [], types = [], replaceCategory, ...fields } = explicit;
  if (!Object.keys(fields).length && !categories.length) return decision;
  const original = replaceCategory?{}:decision.patch??{};
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
