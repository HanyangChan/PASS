// Naver Shopping search (search.shopping.naver.com/ns/search) adapter.
// The page is a Next.js app: products live in the React flight data pushed by
// `self.__next_f.push([1,"…"])` scripts, one object per product card with
// channelProductId, productName, prices, review stats, category ids and adId (ads only).
// Structure confirmed on three saved pages (2026-11-13: 한우·한돈·LA갈비 선물세트).

const BLOCK_TEXT = /보안\s*확인|자동입력\s*방지|비정상적인\s*(?:접근|트래픽)|access\s*denied|unusual\s*traffic/i;
// Result pages always load the ncaptcha script, so "captcha" alone is not a block signal.
export function isBlocked({ status, html }) {
  if ([403, 405, 418, 429].includes(status)) return true;
  return !html.includes('channelProductId') && (BLOCK_TEXT.test(html) || /captcha/i.test(html));
}

export function flightText(html) {
  return Array.from(html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g), match => JSON.parse(match[1])).join('');
}

// JSON objects whose own (top-level) keys include `key`, in document order.
export function objectsWithKey(text, key) {
  const needle = `"${key}":`, starts = [], wanted = new Set(), found = [];
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') {
        inString = false;
        if (starts.length && text.startsWith(needle, i - key.length - 1) && text[i - key.length - 2] !== '\\') wanted.add(starts.at(-1));
      }
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') starts.push(i);
    else if (c === '}' && starts.length) {
      const start = starts.pop();
      if (wanted.delete(start)) {
        try { found.push([start, JSON.parse(text.slice(start, i + 1))]); } catch { /* not plain JSON */ }
      }
    }
  }
  return found.sort((a, b) => a[0] - b[0]).map(([, value]) => value);
}

const DELIVERY_BADGES = { TODAY_DELIVERY: '오늘출발', SELLER_ARRIVAL_GUARANTEE: '도착보장' };
const integer = value => Number.isSafeInteger(value) && value > 0 ? value : null;

export function parse(html) {
  const cards = objectsWithKey(flightText(html), 'channelProductId').filter(card => typeof card.productName === 'string');
  // A product can appear both as an ad slot and as an organic result; keep the organic one.
  const organic = new Set(cards.filter(card => !card.adId).map(card => String(card.channelProductId)));
  const seen = new Set(), items = [];
  for (const card of cards) {
    const id = String(card.channelProductId);
    const key = `${card.adId ? 'ad' : 'organic'}:${id}`;
    if (seen.has(key) || (card.adId && organic.has(id))) continue;
    seen.add(key);
    const price = integer(card.discountedSalePrice) ?? integer(card.salePrice);
    items.push({
      rank: items.length + 1,
      id: `naver_${id}`,
      title: card.productName.trim(),
      price,
      list_price: integer(card.salePrice),
      mall: card.mallName?.trim() || null,
      brand: null, // not present in Naver search cards
      category_path: card.categoryName ? [card.categoryName] : null,
      category_ids: [card.lCatId, card.mCatId, card.sCatId, card.ssCatId].filter(Boolean),
      rating: typeof card.averageReviewScore === 'number' && card.totalReviewCount > 0 ? card.averageReviewScore : null,
      review_count: Number.isSafeInteger(card.totalReviewCount) ? card.totalReviewCount : null,
      is_ad: Boolean(card.adId),
      sold_out: card.stockQuantity === 0,
      delivery_badge: DELIVERY_BADGES[card.fastDeliveryType] ?? null,
      // baseFee is the listed per-order fee. Search cards carry no conditional-free threshold
      // (checked on the saved pages), so shipping_free_over_krw stays null unless a future layout adds one.
      shipping_fee: Number.isSafeInteger(card.productDeliveryInfo?.baseFee) ? card.productDeliveryInfo.baseFee : null,
      shipping_free_over_krw: null,
      shipping_source: Number.isSafeInteger(card.productDeliveryInfo?.baseFee) ? 'naver_listing' : 'unknown',
      is_fresh: card.isFreshProduct === true,
      product_url: card.productUrl?.pcUrl ?? null,
      image_url: card.images?.[0]?.imageUrl ?? null,
    });
  }
  return items;
}
