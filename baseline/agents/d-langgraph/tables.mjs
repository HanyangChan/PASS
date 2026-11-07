// Reference tables for the rule advisors. Draft values for team review, not market data.

// 설날·추석 solar dates: korean-lunar-calendar 0.3.6 (KASI-based), computed 2026-11-05.
// 2027 설날 is 02-07 in Korea (China: 02-06). marginDays = arrive this many days early;
// the 3-day holiday margin is a courier-congestion assumption, not a carrier deadline.
export const OCCASIONS = [
  { name: '설날', dates: ['2026-02-17', '2027-02-07', '2028-01-27'], words: /설날|설\s*선물|명절/, formal: true, marginDays: 3, season: true },
  { name: '추석', dates: ['2026-09-25', '2027-09-15', '2028-10-03'], words: /추석|한가위|명절/, formal: true, marginDays: 3, season: true },
  { name: '어버이날', md: '05-08', words: /어버이날/, formal: true, marginDays: 1 },
  { name: '스승의날', md: '05-15', words: /스승의\s*날/, formal: true, marginDays: 1 },
  { name: '어린이날', md: '05-05', words: /어린이날/, marginDays: 1 },
  { name: '발렌타인데이', md: '02-14', words: /발렌타인/, marginDays: 1 },
  { name: '화이트데이', md: '03-14', words: /화이트데이/, marginDays: 1 },
  { name: '빼빼로데이', md: '11-11', words: /빼빼로/, marginDays: 1 },
  { name: '크리스마스', md: '12-25', words: /크리스마스|성탄/, marginDays: 2 },
];
// How far ahead an occasion is worth mentioning without being asked.
export const LOOKAHEAD_DAYS = { calendar: 45, season: 21 };

// Same groups as the engine's recipientCategories, which already gives these categories +1.
export const RELATIONSHIPS = [
  { group: '부모님', match: /부모|어머니|아버지|처가|시댁|장인|장모|할머니|할아버지/, suits: ['health', 'food', 'coffee_tea', 'kitchen', 'decor'] },
  { group: '친구', match: /친구|동창|연인|애인/, suits: ['beauty', 'makeup', 'jewelry', 'audio', 'snack'] },
  { group: '직장동료', match: /동료|상사|팀장|직장|교수|선생/, suits: ['coffee_tea', 'snack', 'decor', 'accessory', 'kitchen'], avoid: ['jewelry', 'makeup'] },
];
