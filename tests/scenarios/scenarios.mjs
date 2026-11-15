// Conversations a real user might type, with what the app must end up with.
// expect: recipients, occasion, budget, shipping, prefs, exCat, exIng, asks (question key or null), top {category,name,all}.
const coffee = ['category:coffee_tea', 'type:coffee'], tea = ['category:coffee_tea', 'type:tea'];
const edible = ['food', 'snack', 'coffee_tea', 'health'];
export const SCENARIOS = [
  // Basics: one complete sentence
  { say: ['엄마 선물 5만원 배송비 포함'], expect: { recipients: ['어머니'], budget: 50000, shipping: true, asks: null } },
  { say: ['아빠 선물 3만원 이하 배송비 포함'], expect: { recipients: ['아버지'], budget: 30000, shipping: true, asks: null } },
  { say: ['친구 생일 선물 2만원 배송비 포함'], expect: { recipients: ['친구'], occasion: '생일', budget: 20000, shipping: true, asks: null } },
  { say: ['직장 동료 선물 3만원 배송비 포함'], expect: { recipients: ['직장동료'], budget: 30000, shipping: true, asks: null } },
  { say: ['부모님 추석 선물 10만원 배송비 포함'], expect: { recipients: ['부모님'], budget: 100000, shipping: true, asks: null } },
  { say: ['엄마 생신 선물 5만원 안쪽으로 배송비 포함'], expect: { recipients: ['어머니'], occasion: '생일', budget: 50000, shipping: true, asks: null } },
  { say: ['교수님 선물 5만원 배송비 포함'], expect: { recipients: ['교수님'], budget: 50000, shipping: true, asks: null } },
  { say: ['할머니 선물 4만원 배송비 포함'], expect: { recipients: ['할머니'], budget: 40000, shipping: true, asks: null } },
  { say: ['여자친구 선물 7만원 배송비 포함'], expect: { recipients: ['여자친구'], budget: 70000, shipping: true, asks: null } },
  { say: ['상사 선물 5만원 배송비 포함'], expect: { recipients: ['상사'], budget: 50000, shipping: true, asks: null } },
  // Budget phrasing
  { say: ['엄마 선물 오만원 배송비 포함'], expect: { budget: 50000 } },
  { say: ['엄마 선물 5만 원 이내 배송비 포함'], expect: { budget: 50000 } },
  { say: ['엄마 선물 50000원 배송비 포함'], expect: { budget: 50000 } },
  { say: ['엄마 선물 3만5천원 배송비 포함'], expect: { budget: 35000 } },
  { say: ['엄마 선물 배송비까지 해서 5만원'], expect: { budget: 50000, shipping: true } },
  { say: ['엄마 선물 상품값만 5만원'], expect: { budget: 50000, shipping: false } },
  { say: ['엄마 선물 5만원. 아니, 7만원으로 배송비 포함'], expect: { budget: 70000 } },
  { say: ['엄마 선물 10만원 미만 배송비 포함'], expect: { budget: 100000 } },
  // Multi-turn: the app asks, the user answers
  { say: ['엄마 선물', '5만원', '네'], expect: { recipients: ['어머니'], budget: 50000, shipping: true, asks: null } },
  { say: ['엄마 선물', '5만원', '아니요'], expect: { budget: 50000, shipping: false, asks: null } },
  { say: ['선물 추천해줘', '엄마', '5만원', '배송비 포함'], expect: { recipients: ['어머니'], budget: 50000, shipping: true, asks: null } },
  { say: ['엄마 선물 5만원 배송비 포함', '7만원으로 바꿔줘'], expect: { budget: 70000 } },
  { say: ['엄마 선물 5만원 배송비 포함', '예산 3만원으로 줄여줘'], expect: { budget: 30000 } },
  // Tastes
  { say: ['엄마 선물 5만원 배송비 포함', '엄마는 커피를 좋아하세요'], expect: { prefs: coffee, top: { category: 'coffee_tea', name: /커피|coffee/i } } },
  { say: ['엄마 선물 5만원 배송비 포함', '차를 좋아하셔'], expect: { prefs: tea, top: { category: 'coffee_tea', name: /차|tea/i } } },
  { say: ['엄마 선물 5만원 배송비 포함', '저는 커피 좋아하는데 엄마는 차 좋아해요'], expect: { prefs: tea, top: { category: 'coffee_tea', name: /차|tea/i } } },
  { say: ['친구 선물 5만원 배송비 포함', '화장품 좋아해'], expect: { prefs: ['category:beauty'], top: { category: 'beauty' } } },
  { say: ['친구 선물 5만원 배송비 포함', '이어폰 같은 거'], expect: { prefs: ['category:audio'], top: { category: 'audio' } } },
  { say: ['아빠 선물 10만원 배송비 포함', '시계 좋아하셔'], expect: { prefs: ['category:watch'], top: { category: 'watch' } } },
  { say: ['친구 선물 5만원 배송비 포함', '운동 좋아해'], expect: { prefs: ['category:fitness'], top: { category: 'fitness' } } },
  { say: ['엄마 선물 5만원 배송비 포함', '건강식품 좋아하셔'], expect: { prefs: ['category:health'], top: { category: 'health' } } },
  { say: ['엄마 선물 5만원 배송비 포함', '단 건 싫어하셔'], expect: { prefs: ['less_sweet'] } },
  { say: ['친구 선물 3만원 배송비 포함', '가방 좋아해'], expect: { prefs: ['category:bag'], top: { category: 'bag' } } },
  { say: ['친구 선물 5만원 배송비 포함', '목걸이 같은 액세서리'], expect: { prefs: ['category:jewelry'], top: { category: 'jewelry' } } },
  { say: ['친구 선물 3만원 배송비 포함', '메이크업 좋아해'], expect: { prefs: ['category:makeup'], top: { category: 'makeup' } } },
  { say: ['아빠 선물 5만원 배송비 포함', '요리하는 거 좋아하셔'], expect: { prefs: ['category:kitchen'], top: { category: 'kitchen' } } },
  { say: ['조카 선물 3만원 배송비 포함', '장난감'], expect: { prefs: ['category:toy'], top: { category: 'toy' } } },
  // Exclusions
  { say: ['엄마 선물 5만원 배송비 포함', '먹는 건 빼주세요'], expect: { exCat: edible } },
  { say: ['엄마 선물 5만원 배송비 포함', '향이 센 건 싫어하세요'], expect: { prefs: ['avoid_fragrance'] } },
  { say: ['엄마 선물 5만원 배송비 포함', '견과류는 빼주세요'], expect: { exIng: ['견과류'] } },
  { say: ['엄마 선물 5만원 배송비 포함', '땅콩이랑 우유 알레르기 있어요'], expect: { exIng: ['땅콩', '우유'] } },
  { say: ['엄마 선물 5만원 배송비 포함', '우유는 빼고 땅콩도 제외해 주세요'], expect: { exIng: ['우유', '땅콩'] } },
  { say: ['엄마 선물 5만원 배송비 포함', '땅콩이랑 우유 알레르기 있어요', '땅콩 알레르기 없어요'], expect: { exIng: ['우유'] } },
  { say: ['친구 선물 5만원 배송비 포함', '화장품은 빼줘'], expect: { exCat: ['beauty'] } },
  { say: ['엄마 선물 5만원 배송비 포함', '과자는 빼줘'], expect: { exCat: ['snack'] } },
  { say: ['엄마 선물 5만원 배송비 포함', '커피 좋아하시고 견과류 알레르기 있어요'], expect: { prefs: coffee, exIng: ['견과류'], top: { category: 'coffee_tea' } } },
  { say: ['엄마 선물 5만원 배송비 포함', '향수 말고 커피로 추천해줘'], expect: { prefs: coffee, top: { category: 'coffee_tea' } } },
  // Occasions
  { say: ['친구 합격 축하 선물 3만원 배송비 포함'], expect: { occasion: '합격', budget: 30000 } },
  { say: ['부모님 결혼기념일 선물 10만원 배송비 포함'], expect: { occasion: '기념일', recipients: ['부모님'] } },
  { say: ['설날 부모님 선물 5만원 배송비 포함'], expect: { recipients: ['부모님'], budget: 50000 } },
  // Recipient switch
  { say: ['친구 선물 3만원 배송비 포함', '화장품 좋아해', '친구 말고 엄마한테 줄 거야'], expect: { recipients: ['어머니'], prefs: [] } },
  // Explain / what-if never change conditions
  { say: ['엄마 선물 5만원 배송비 포함', '왜 이게 1위야?'], expect: { budget: 50000, recipients: ['어머니'] } },
  { say: ['엄마 선물 5만원 배송비 포함', '7만원으로 올리면?'], expect: { budget: 50000 } },
];
