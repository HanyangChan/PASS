import assert from 'node:assert/strict';

const exactProducts = [
  ['B077CSKYV3', 'bag', 'Buffway BW-WL-VC-BR 갈색 가죽 지갑'],
  ['B07CJCGM1M', 'bag', 'American Tourister AMT Fizz 32L 검은색 백팩'],
  ['B07MX26G8P', 'bag', 'Urban Forest Oliver 파란색 RFID 차단 가죽 지갑'],
  ['B08J8M2B42', 'bag', 'Lavie Betula Medium 여성용 토트백'],
  ['B083JGH84Y', 'jewelry', 'Sukkhi SKR48716 Kundan 목걸이 3종 세트'],
  ['B087BW5KGJ', 'jewelry', 'Yofair 18K 도금 이름 각인 목걸이'],
  ['B01691KLOS', 'jewelry', 'ITOS365 8인치 꽃무늬 원목 장신구 상자'],
  ['B01BKEZYBY', 'watch', 'SWISSTYLE SS-703W-703B 흰색 다이얼 시계'],
  ['B01GDWNV68', 'watch', 'Fastrack 6150SM04 분홍색 시계'],
  ['B08VN2H8CV', 'watch', 'Louis Devin LD-L144-BLU-CH 메쉬 체인 시계'],
  ['B07QXKK81H', 'watch', 'ADAMO 839KKM21 로즈골드 시계'],
  ['B01GFTEV5Y', 'kitchen', 'Pigeon Cruise 1800W 검은색 인덕션'],
  ['B00HVXS7WC', 'kitchen', 'Bajaj Rex 500W 흰색 믹서 그라인더 3단지 구성'],
  ['B07S851WX5', 'kitchen', 'Prestige PGMFD 01 검은색 샌드위치 메이커'],
  ['B000P22TIY', 'beauty', 'Nautica Voyage 남성용 오드뚜왈렛 100mL'],
  ['B00ZFWQG4W', 'beauty', "Palmer's Coconut Oil Body Lotion"],
  ['B075MGGBL1', 'beauty', 'Park Avenue Original 남성용 데오도란트 150mL 3개 세트'],
  ['B07C62CJZF', 'coffee_tea', 'Country Bean 헤이즐넛 인스턴트 커피 50g'],
  ['B07KJRWMF3', 'coffee_tea', 'Vedaka 레몬 허니 녹차 티백 100개입'],
  ['B07K6J8VV4', 'coffee_tea', 'Nescafe Gold Rich and Smooth 커피 95g 유리병'],
  ['B07N1RTXP1', 'coffee_tea', 'Vedaka Premium Tea 1kg'],
  ['B08X2FN7SV', 'decor', 'RAG28 SPW1 다색 나무 벽장식 11개 세트'],
  ['B07NGVTKT4', 'decor', 'Oreva AQ-1687 32cm 흰색 다이얼 벽시계'],
  ['B07QWSR4FH', 'fitness', 'Yonex ZR 100 Light 배드민턴 라켓과 커버'],
  ['B07CY1P73C', 'toy', "HUG 'n' FEEL 5피트 빨간 테디베어"],
  ['B07X3LPQDG', 'toy', 'WireScorts 충전식 리모컨 플라스틱 경주차'],
  ['B07ZXB2VTQ', 'toy', 'GeoKraft 12인치 파란색 STEM 지구본과 돋보기'],
  ['B0BRXVWN8Q', 'audio', 'boAt Bassheads 220 Indi Blue 유선 이어폰'],
  ['B078MW1FT8', 'audio', 'boAt Bass Heads 225 Forest Green 유선 이어폰'],
  ['B073XH6361', 'audio', 'boAt Bass Heads 225 Frosty White 유선 이어폰'],
];
const exactPrompts = [
  name => `선물용으로 ${name}를 보고 있어요. 같은 모델을 찾아주세요.`,
  name => `${name} 제품이 있으면 보여줘. 이 제품을 고르고 싶어.`,
  name => `찾고 있는 건 ${name}이야. 그 상품으로 골라줘.`,
  name => `카탈로그에서 ${name} 상품을 찾아줄래?`,
  name => `이 제품을 주문 후보로 보고 싶어요. ${name}.`,
  name => `${name} 실물을 찾는 중이야. 모델명이나 규격이 같은 걸 보여줘.`,
];

const categories = [
  ['coffee_tea', '차 또는 커피'], ['audio', '음향기기'], ['bag', '가방'], ['kitchen', '주방용품'],
  ['watch', '손목시계'], ['decor', '인테리어 소품'], ['jewelry', '주얼리'], ['toy', '장난감'],
  ['fitness', '운동용품'], ['beauty', '뷰티 제품'], ['snack', '간식'], ['makeup', '메이크업 제품'],
  ['digital', '디지털기기'], ['accessory', '패션소품'], ['food', '식품 선물'],
];
const recipients = ['친구', '동료', '어머니', '부모님', '연인', '누나'];
const budgets = [30000, 40000, 50000, 60000, 70000, 80000];
const won = value => `${value / 10000}만 원`;
const recommendationPrompts = [
  (who, item, cap) => `${who}에게 ${item}을 선물할 거예요. 배송비를 더해도 ${won(cap)}을 넘지 않는 후보를 골라주세요.`,
  (who, item, cap) => `받는 사람은 ${who}이고 원하는 건 ${item}입니다. 배송 포함 예산은 ${won(cap)}까지예요.`,
  (who, item, cap) => `결제 총액을 ${won(cap)} 안으로 맞추고 싶어. 배송비까지 포함해서 ${who} 줄 ${item} 추천해줘.`,
  (who, item, cap) => `${who} 선물로 ${item}을 찾는 중이야. 상품값과 배송비 합쳐 ${won(cap)} 이하로 부탁해.`,
  (who, item, cap) => `택배비까지 내고 ${won(cap)} 안에 사려고 합니다. ${who}에게 줄 만한 ${item}이 있을까요?`,
];
const conditions = (text, category, budget, extra = {}) => ({
  text, categories: [category], budget, ...extra,
});
const recommend = Array.from({ length: 30 }, (_, index) => {
  const [category, label] = categories[index % categories.length];
  const budget = budgets[(index + 2) % budgets.length];
  const text = recommendationPrompts[index % recommendationPrompts.length](recipients[index % recipients.length], label, budget);
  return { id: `rec-${index + 1}`, group: 'recommendation', steps: [conditions(text, category, budget)] };
});

const knownAllergies = [
  ['땅콩', '부모님 선물용 간식에서 땅콩이 든 제품은 제외해 주세요. 어머니가 땅콩 알레르기래요.'],
  ['우유', '동료에게 간식을 주려고 해. 상대가 우유 알레르기가 있어서 우유 성분이 있는 건 빼줘.'],
  ['밀', '밀 알레르기가 있는 친구에게 줄 먹거리 선물을 고르는데 밀 함유 상품은 안 돼.'],
  ['대두', '아버지가 대두 알레르기라 선물할 식품에서 대두가 들어 있으면 빼야 해요.'],
  ['견과류', '선물을 받는 분이 견과류 알레르기가 있대. 견과류가 들어간 간식은 제외해 줘.'],
  ['알류', '달걀 알레르기가 있는 아이를 위한 과자예요. 달걀 들어간 제품은 빼주세요.'],
  ['새우', '새우 알레르기가 있는 친구에게 선물할 식품을 찾아요. 새우 함유 제품은 제외해 주세요.'],
  ['우유', '선물 받을 아이는 유제품에 알레르기가 있어. 간식 후보 중 우유가 들어간 상품을 빼줄래?'],
  ['땅콩', '간식은 좋지만 누나가 땅콩 알레르기가 있어서, 땅콩 함유 여부를 확인하고 들어 있는 건 빼줘.'],
  ['밀', '아버지가 밀 알레르기래요. 밀만큼은 꼭 제외해서 드릴 먹을 거를 추천해 주세요.'],
  ['대두', '선물 받는 친구가 콩 알레르기인데 특히 대두는 피해야 해. 대두 든 식품 말고 골라줘.'],
  ['호두', '간식 선물을 추천해 주세요. 호두 알레르기가 있어서 호두가 든 제품은 제외하고요.'],
  ['메밀', '어머니에게 식품 선물을 드리는데 메밀 알레르기가 있어서 메밀이 들어가면 안 돼요.'],
  ['복숭아', '동료가 복숭아 알레르기라고 했어. 복숭아 들어간 음식은 제외해줘.'],
  ['게', '게 알레르기가 있는 지인에게 먹거리 선물을 할 건데 게 성분 있는 상품은 피하고 싶어.'],
  ['땅콩', 'Pintola Organic Peanut Butter Crunchy 1kg을 고민 중인데 받는 분이 땅콩 알레르기예요. 땅콩 든 제품은 제외해 주세요.'],
  ['땅콩', 'Pintola 유기농 크런치 땅콩버터 1kg이 후보였는데 친구가 땅콩 알레르기래. 이 경우 땅콩이 들어간 건 빼줘.'],
  ['밀', 'Barilla Durum Wheat Linguine 500g을 사려던 중에 밀 알레르기라고 들었어요. 밀 함유 상품은 빼 주세요.'],
  ['밀', '밀 알레르기가 있어요. 바릴라 링귀네 500g 같은 식품을 선물하려는데 밀은 꼭 제외해 주세요.'],
  ['우유', '우유 알레르기가 있는 사람이 받을 선물이에요. Nutella 350g 같은 스프레드를 보고 있지만 우유가 들면 빼 주세요.'],
  ['대두', 'Nutella 750g을 생각하고 있었는데 대두 알레르기가 있대요. 대두를 함유한 상품은 건너뛰어 주세요.'],
];
const unknownAllergies = [
  '받는 아이가 음식 알레르기가 있다는데 아직 어떤 재료인지 듣지 못했어요. 간식 선물을 고를 수 있을까요?',
  '동료가 식품 알레르기가 있다고만 했어. 특정 성분은 아직 모르는데 먹을 걸 선물하고 싶어.',
  '아버지 간식 선물을 알아보고 있어요. 피해야 할 알레르기 성분은 아직 확인하지 못했습니다.',
  '조카가 알레르기가 있어서 식품을 조심해야 한대. 원인 재료는 아직 안 알려줬어.',
  '어떤 성분인지는 모르지만 친구에게 식품 알레르기가 있어. 과자 선물은 어떻게 고를까?',
  '간식 선물을 사려는데 지인이 음식 알레르기라고 해요. 어느 성분에 반응하는지는 몰라요.',
  '부모님 드릴 먹을 거 추천해줘. 아버지는 알레르기가 있지만 뭘 피하는지는 아직 몰라.',
  '친구한테 알레르기가 있는 것까지만 알아. 성분 확인 전인데 간식 후보를 보고 싶어.',
  '누나에게 먹거리 선물을 주려고 합니다. 가족에게 알레르기가 있다고 들었는데 성분은 아직 미확인입니다.',
];
const allergy = [...knownAllergies, ...unknownAllergies.map(text => [null, text])]
  .map(([ingredient, text], index) => ({ id: `allergy-${index + 1}`, group: 'allergy', steps: [{ text, ingredient }] }));

const multiturn = Array.from({ length: 30 }, (_, index) => {
  const [category, label] = categories[index % categories.length];
  const [nextCategory, nextLabel] = categories[(index + 4) % categories.length];
  const who = recipients[(index + 3) % recipients.length];
  const budget = [50000, 60000, 70000, 80000][index % 4];
  const first = conditions(`${who}에게 줄 ${label} 선물을 찾습니다. 배송비 포함 ${won(budget)} 한도로 골라주세요.`, category, budget);
  const lower = budget - 10000;
  let followUp;
  switch (index % 5) {
    case 0:
      followUp = conditions(`같은 종류로 다시 골라줘. 배송비 포함 상한만 ${won(lower)}으로 줄일게.`, category, lower);
      break;
    case 1:
      followUp = conditions(`처음 찾던 ${label} 대신 ${nextLabel}으로 바꿔 줘. 배송 포함 예산은 그대로야.`, nextCategory, budget);
      break;
    case 2:
      followUp = conditions('나머지 조건은 그대로 두고 2026년 12월 3일까지 도착할 상품으로 변경해 주세요.', category, budget, { deliveryBy: '2026-12-03' });
      break;
    case 3:
      followUp = conditions(`같은 제품 두 개가 필요해요. 두 개 합쳐 배송비까지 ${won(budget)}이 상한이에요.`, category, budget, { quantity: 2 });
      break;
    case 4:
      followUp = conditions(`생각이 바뀌어서 ${nextLabel}으로 보고 싶어. 택배비를 넣어 ${won(lower)}까지만 쓸게.`, nextCategory, lower);
      break;
  }
  return { id: `multi-${index + 1}`, group: 'multiturn', steps: [first, followUp] };
});

export const tasks = [
  ...exactProducts.map(([asin, category, product], index) => ({
    id: `exact-${index + 1}`, group: 'exact',
    steps: [conditions(exactPrompts[index % exactPrompts.length](product), category, 80000, { expectedIds: [`amz-${asin}`] })],
  })),
  ...recommend, ...allergy, ...multiturn,
];
export const ingredientEvidence = {
  'amz-B079KSTLK9': { contains: ['견과류', '우유', '대두'], source: 'https://www.nutella.com/in/en/products/nutella' },
  'amz-B07F256D87': { contains: ['견과류', '우유', '대두'], source: 'https://www.nutella.com/in/en/products/nutella' },
  'amz-B071J53T7M': { contains: ['땅콩'], source: 'https://pintola.in/products/natural-organic-peanut-butter' },
  'amz-B01B49P49M': { contains: ['밀'], source: 'https://www.barilla.com/en-au/products/pasta/classic-blue-box/linguine' },
};

assert.equal(tasks.length, 120);
assert.equal(new Set(tasks.map(task => task.id)).size, 120);
for (const group of ['exact', 'recommendation', 'allergy', 'multiturn']) {
  assert.equal(tasks.filter(task => task.group === group).length, 30);
}
assert.equal(new Set(tasks.map(task => task.steps.map(step => step.text).join('\n'))).size, 120);
