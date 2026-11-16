// Frozen before inspecting results. Same author as the implementation: newly worded internal
// evaluation, not an independently authored/human-validated benchmark. Do not rewrite labels after fixes.
export const unseenDialogues = [
  { id: 'N01', group: 'diagnostic', say: ['어머니 생신인데 택배비까지 오만원 안에서 골라줘'], expect: { recipients: ['어머니'], occasion: '생일', budget: 50000, shipping: true, asks: false } },
  { id: 'N02', group: 'diagnostic', say: ['우리 아버지 드릴 거야. 배송료 합쳐 칠만오천원을 넘기면 안 돼'], expect: { recipients: ['아버지'], budget: 75000, shipping: true, asks: false } },
  { id: 'N03', group: 'diagnostic', say: ['엄마 선물 6만원 배송 포함. 견과류는 빼줘', '그건 엄마 거였고 이번에는 커피 안 마시는 친구 줄 거야. 배송 포함 사만원'], expect: { recipients: ['친구'], budget: 40000, shipping: true, exCat: ['coffee_tea'], exIng: [], asks: false } },
  { id: 'N04', group: 'diagnostic', say: ['아빠께 드릴 선물, 택배비 포함 7만원', '차보다는 시계 쪽으로 골라봐'], expect: { recipients: ['아버지'], budget: 70000, prefs: ['category:watch'], asks: false } },
  { id: 'N05', group: 'diagnostic', say: ['이모 환갑 선물 8만원 배송비 별도'], expect: { recipients: ['이모'], budget: 80000, shipping: false, asks: false } },
  { id: 'N06', group: 'diagnostic', say: ['초등학생 조카 입학 선물로 이만원, 배송비까지야'], expect: { recipientContains: '조카', occasion: '입학', budget: 20000, shipping: true, asks: false } },
  { id: 'N07', group: 'diagnostic', say: ['할머니께 선물할 건데 배송 포함 5만원. 단 거 말고 차 종류로'], expect: { recipients: ['할머니'], budget: 50000, shipping: true, prefsInclude: ['category:coffee_tea', 'type:tea', 'less_sweet'], asks: false } },
  { id: 'N08', group: 'diagnostic', say: ['아버지 선물 5만원 배송 포함', '예산은 5만이었는데 삼만오천원으로 낮춰. 배송료까지 포함해서'], expect: { recipients: ['아버지'], budget: 35000, shipping: true, asks: false } },
  { id: 'N09', group: 'diagnostic', say: ['택배비 빼고 삼만원. 받는 사람은 직장 동료야'], expect: { recipients: ['직장동료'], budget: 30000, shipping: false, asks: false } },
  { id: 'N10', group: 'diagnostic', say: ['어머니 6만원 배송 포함. 향이 강한 건 빼줘', '삼촌으로 바꿔. 아까 말한 무향 조건은 가져가지 마'], expect: { recipients: ['삼촌'], prefs: [], exCat: [], exIng: [] } },
  { id: 'N11', group: 'diagnostic', say: ['친구 결혼 축하 선물, 배송비 합쳐 십만원. 와인은 말고'], expect: { recipients: ['친구'], occasion: '결혼', budget: 100000, shipping: true, forbidsName: '와인|wine', allowQuestion: true } },
  { id: 'N12', group: 'diagnostic', say: ['엄마 선물 5만원 배송 포함. 2026년 11월 31일까지 도착해야 해'], expect: { budget: 50000, delivery: null, asks: true } },
  { id: 'H01', group: 'reserved', say: ['할아버지 생신 선물 찾아줘. 배송료까지 팔만원으로 부탁해'], expect: { recipients: ['할아버지'], occasion: '생일', budget: 80000, shipping: true, asks: false } },
  { id: 'H02', group: 'reserved', say: ['직장 상사에게 드릴 선물이에요. 택배비 제외하고 6만 원까지요'], expect: { recipients: ['상사'], budget: 60000, shipping: false, asks: false } },
  { id: 'H03', group: 'reserved', say: ['친구 생일 4만원 배송 포함', '음료 말고 필기구로 보고 싶어'], expect: { recipients: ['친구'], budget: 40000, prefsInclude: ['category:stationery'], allowQuestion: true } },
  { id: 'H04', group: 'reserved', say: ['엄마 생신 선물 5만원 배송 포함', '오만원은 그대로 두고 꽃다발로 바꿔줘'], expect: { recipients: ['어머니'], budget: 50000, prefs: ['category:flower'], asks: false } },
  { id: 'H05', group: 'reserved', say: ['아버지 선물로 배송 포함 6만원. 우유 들어간 것은 피해줘'], expect: { recipients: ['아버지'], budget: 60000, shipping: true, exIng: ['우유'], asks: false } },
  { id: 'H06', group: 'reserved', say: ['친구 생일 3만원 배송 포함', '예산은 삼만원 그대로, 배송비는 따로 계산해'], expect: { recipients: ['친구'], budget: 30000, shipping: false, asks: false } },
  { id: 'H07', group: 'reserved', say: ['어머니 5만원 배송 포함 커피 선물', '그거 말고 친구 선물이야. 차를 좋아하는 사람이야'], expect: { recipients: ['친구'], prefs: ['category:coffee_tea', 'type:tea'], asks: false } },
  { id: 'H08', group: 'reserved', say: ['아빠 선물로 배송 포함 8만원', '예산 10만원이라면 뭐가 달라져?'], expect: { recipients: ['아버지'], budget: 80000, shipping: true, asks: false } },
];
