// Builds a small committed test fixture from a saved Naver search page.
// Raw pages are never committed: only whitelisted product-card fields are kept, re-wrapped
// in the same `self.__next_f.push` format the parser reads. Seller addresses and account ids are dropped.
// Usage: node scripts/catalog/web/make-fixture.mjs <saved.html> <out.html>
import { readFileSync, writeFileSync } from 'node:fs';
import { flightText, objectsWithKey } from './sites/naver.mjs';

const KEEP = ['channelProductId', 'productName', 'salePrice', 'discountedSalePrice', 'mallName', 'categoryName',
  'lCatId', 'mCatId', 'sCatId', 'ssCatId', 'averageReviewScore', 'totalReviewCount', 'stockQuantity',
  'fastDeliveryType', 'isFreshProduct', 'adId', 'productUrl', 'images'];
const [input, output] = process.argv.slice(2);
const cards = objectsWithKey(flightText(readFileSync(input, 'utf8')), 'channelProductId')
  .filter(card => typeof card.productName === 'string')
  .map(card => ({
    ...Object.fromEntries(KEEP.filter(key => card[key] !== undefined).map(key => [key, card[key]])),
    productDeliveryInfo: { baseFee: card.productDeliveryInfo?.baseFee ?? null },
    ...(card.adId ? { adId: 'fixture-ad' } : {}),
    productUrl: { pcUrl: card.productUrl?.pcUrl ?? null },
  }));
const flight = `5:["$","$L1",null,{"products":${JSON.stringify(cards)}}]\n`;
const half = flight.length >> 1; // two chunks, so tests cover chunk joining
const push = text => `<script>self.__next_f.push([1,${JSON.stringify(text)}])</script>`;
writeFileSync(output, `<!DOCTYPE html><html><head><title>fixture</title><script id="ncaptcha-init"></script></head><body>
${push(flight.slice(0, half))}
${push(flight.slice(half))}
</body></html>\n`);
console.log(`${cards.length} cards → ${output}`);
