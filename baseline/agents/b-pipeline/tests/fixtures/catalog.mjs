// Synthetic engine products for b-pipeline AC tests (not real prices or availability).
// Shaped for PRD scenarios S1–S5; demo/server/eval use data/ snapshot instead.
const base = { stock_sets: 20, arrival_date: '2026-12-01', brand: '데모', packaging: 'basic', allergens_declared: [] };
const p = fields => ({ ...base, ...fields });

export const products = [
  // S1/S2 부모님 (engine group categories: health, food, coffee_tea, kitchen, decor), 5만 원
  p({ id: 'peanut-gangjeong', name: '땅콩 강정 세트', category: 'food', price_krw: 28000, shipping_fee_per_set_krw: 3000, sweetness: 'sweet', allergens_declared: ['땅콩'], rating_count: 1500 }),
  p({ id: 'yakgwa-set', name: '전통 약과 세트', category: 'food', price_krw: 32000, shipping_fee_per_set_krw: 3000, sweetness: 'sweet', allergens_declared: ['밀'], rating_count: 1200 }),
  p({ id: 'green-tea', name: '무가당 녹차 세트', category: 'coffee_tea', price_krw: 29000, shipping_fee_per_set_krw: 3000, sweetness: 'unsweetened', rating_count: 400 }),
  p({ id: 'jujube-tea', name: '대추차 세트', category: 'coffee_tea', price_krw: 24000, shipping_fee_per_set_krw: 3000, sweetness: 'naturally_sweet', rating_count: 300 }),
  p({ id: 'hiking-poles', name: '등산 스틱 2개 세트', category: 'fitness', price_krw: 45000, shipping_fee_per_set_krw: 0, sweetness: 'unknown', rating_count: 250 }),
  p({ id: 'hiking-socks', name: '등산 양말 세트', category: 'fitness', price_krw: 19000, shipping_fee_per_set_krw: 3000, sweetness: 'unknown', rating_count: 600 }),
  p({ id: 'red-ginseng', name: '홍삼 스틱', category: 'health', price_krw: 47000, shipping_fee_per_set_krw: 0, sweetness: 'unknown', rating_count: 900 }),
  p({ id: 'formal-tea-large', name: '격식 포장 녹차 큰 세트', category: 'coffee_tea', price_krw: 58000, shipping_fee_per_set_krw: 0, sweetness: 'unsweetened', packaging: 'formal', rating_count: 700 }),
  // S3 친구 (beauty, makeup, jewelry, audio, snack), 3만 원, 커피
  p({ id: 'drip-coffee', name: '드립백 커피 세트', category: 'coffee_tea', price_krw: 18000, shipping_fee_per_set_krw: 3000, sweetness: 'unsweetened', rating_count: 2000 }),
  p({ id: 'coffee-beans', name: '원두 선물세트', category: 'coffee_tea', price_krw: 26000, shipping_fee_per_set_krw: 3000, sweetness: 'unsweetened', rating_count: 800 }),
  p({ id: 'hand-cream', name: '핸드크림 세트', category: 'beauty', price_krw: 15000, shipping_fee_per_set_krw: 3000, sweetness: 'unknown', rating_count: 1100 }),
  p({ id: 'cookie-box', name: '버터 쿠키 박스', category: 'snack', price_krw: 12000, shipping_fee_per_set_krw: 3000, sweetness: 'sweet', allergens_declared: ['우유', '밀'], rating_count: 900 }),
  // S4 교수님 (engine group 직장동료: coffee_tea, snack, decor, accessory, kitchen), 3만 원 상한, 격식 포장
  p({ id: 'formal-black-tea', name: '격식 포장 홍차 세트', category: 'coffee_tea', price_krw: 26000, shipping_fee_per_set_krw: 3000, sweetness: 'unsweetened', packaging: 'formal', rating_count: 500 }),
  p({ id: 'formal-candle', name: '격식 포장 향초', category: 'decor', price_krw: 22000, shipping_fee_per_set_krw: 3000, sweetness: 'unknown', packaging: 'formal', rating_count: 350 }),
  p({ id: 'formal-pen', name: '격식 포장 만년필', category: 'accessory', price_krw: 38000, shipping_fee_per_set_krw: 0, sweetness: 'unknown', packaging: 'formal', rating_count: 450 }),
];

export const byId = Object.fromEntries(products.map(x => [x.id, x]));
