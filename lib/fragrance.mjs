// Product-name heuristic, not a measurement of scent intensity or ingredient safety.
export const FRAGRANCE_TAG='avoid_fragrance';
export const FRAGRANCE_NOTICE='상품명 기준으로 향수·방향제·디퓨저·향초 등 향 제품을 제외했어요. 실제 향의 강도는 상품 상세 정보에서 확인해 주세요.';
export function isFragranceProduct(product) {
  const name=`${product.name??''} ${product.name_en??''}`;
  if(/무향|향료\s*무첨가|\bunscented\b|\bfragrance[- ]free\b|\bscent[- ]free\b/i.test(name))return false;
  return /향수|방향제|디퓨저|향초|아로마\s*오일|에센셜\s*오일|인센스|\bperfumes?\b|\bcolognes?\b|\beau de (?:parfum|toilette)\b|\bair fresheners?\b|\b(?:reed|aroma|oil) diffusers?\b|\bscented candles?\b|\b(?:essential|fragrance) oils?\b|\bincense\b/i.test(name);
}
