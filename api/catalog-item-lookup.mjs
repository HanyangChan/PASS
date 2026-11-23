const lookupIntent = /찾아|찾고|보여|같은 모델|동일 모델|실물을|주문 후보|\b(?:find|look up)\b/i;
const alternatives = /말고|제외|비교|\b(?:except|compare)\b/i;
const normalize = text => String(text ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();

// Return null for ordinary recommendations. An explicit lookup only succeeds when it identifies one catalog row.
export function lookupCatalogItem(text, products) {
  if (!text || alternatives.test(text)) return null;
  const asin=(text.match(/(?:\bASIN\s*[:#]?\s*|\/dp\/)([A-Z0-9]{10})(?![A-Z0-9])/i) ??
    (lookupIntent.test(text) && text.match(/\b(B[A-Z0-9]{9})\b/i)))?.[1]?.toUpperCase();
  if (asin) {
    return products.filter(product=>product.id.toUpperCase()===asin || product.id.toUpperCase()==='AMZ-'+asin ||
      String(product.link??'').toUpperCase().match(/\/DP\/([A-Z0-9]{10})(?:[/?#]|$)/)?.[1]===asin);
  }
  if (!lookupIntent.test(text)) return null;
  const quoted=text.match(/["“]([^"”\n]+)["”]/)?.[1];
  const modelPhrase=text.match(/[A-Za-z][A-Za-z0-9]*(?:[ \t-]+[A-Za-z0-9]+){2,}/g)
    ?.find(phrase=>/\d/.test(phrase));
  const query=normalize(quoted??modelPhrase);
  if (!query || query.length<6) return null;
  const exact=[];
  const partial=[];
  for (const product of products) {
    const names=[product.name,product.name_en].filter(Boolean).map(normalize);
    if (names.includes(query)) exact.push(product);
    else if(partial.length<2 && names.some(name=>(' '+name+' ').includes(' '+query+' '))) partial.push(product);
    if(exact.length>1) break;
  }
  return exact.length?exact:partial;
}
