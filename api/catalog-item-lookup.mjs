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

const indexedCatalogs = new WeakMap();
const identifier = /(?<![A-Za-z0-9])[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)*(?![A-Za-z0-9])/g;
function modelCodes(text, fromCatalog = false) {
  return [...text.matchAll(identifier)].flatMap(([value]) => {
    const token = value.toLowerCase();
    return fromCatalog ? [token, ...[...token.matchAll(/[-/]/g)].map(match => token.slice(match.index + 1))] : [token];
  }).filter(value => value.replace(/[-/]/g, '').length >= 5 && /[a-z]/.test(value) && /\d/.test(value) &&
    !/^\d+(?:ml|cm|mm|kg|gb|tb|mah|hz|w|l|g|k)$/i.test(value));
}

function addIndex(index, key, row) {
  const entries = index.get(key);
  if (entries) entries.push(row);
  else index.set(key, [row]);
}

function catalogIndex(products) {
  if (indexedCatalogs.has(products)) return indexedCatalogs.get(products);
  const asins = new Map();
  const models = new Map();
  const rows = products.map(product => {
    const rawNames = [product.name, product.name_en].filter(Boolean);
    const names = [...new Set(rawNames.map(normalize))];
    const row = { product, names };
    const ids = [product.id.replace(/^amz-/i, ''), product.link?.match(/\/dp\/([A-Z0-9]{10})(?:[/?#]|$)/i)?.[1]];
    for (const id of new Set(ids.filter(value => /^[A-Z0-9]{10}$/i.test(value ?? '')).map(value => value.toUpperCase()))) {
      addIndex(asins, id, row);
    }
    for (const code of new Set(rawNames.flatMap(name => modelCodes(name, true)))) addIndex(models, code, row);
    return row;
  });
  const index = { asins, models, rows };
  indexedCatalogs.set(products, index);
  return index;
}

const exactIntent = /(?:같은|동일한?)\s*(?:모델|제품|상품)|(?:그|이)\s*(?:제품|상품)으로|실물을\s*찾|카탈로그에서.+(?:찾아|보여)|주문 후보|\b(?:exact product|same model)\b/i;
const detailAliases = [
  [/\b(?:white)\b|흰색|화이트/i, 'white'], [/\bblack\b|검은색|블랙/i, 'black'],
  [/\b(?:blue)\b|파란색|블루/i, 'blue'], [/\bbrown\b|갈색|브라운/i, 'brown'],
  [/\b(?:red)\b|빨간색|레드/i, 'red'], [/\b(?:pink)\b|분홍색|핑크/i, 'pink'],
];
function narrowDetails(rows, text, phrase) {
  if (rows.length < 2) return rows;
  const details = detailAliases.filter(([pattern]) => pattern.test(text)).map(([, token]) => token);
  const size = normalize(text.match(/\b\d+\s*(?:ml|cm|mm|inch|kg|gb|tb)\b/i)?.[0]);
  if (size) details.push(size.replace(/ /g, ''));
  if (phrase) details.push(phrase.split(' ')[0]);
  const matchesDetail = (row, detail) => row.names.some(name =>
    (' ' + name + ' ').includes(' ' + detail + ' ') || (size && detail === size.replace(/ /g, '') && name.replace(/ /g, '').includes(detail)));
  const availableDetails = [...new Set(details)].filter(detail => rows.some(row => matchesDetail(row, detail)));
  const narrowed = rows.filter(row => availableDetails.every(detail => matchesDetail(row, detail)));
  return narrowed.length ? narrowed : rows;
}

export function lookupIndexedCatalogItem(text, products) {
  if (!text) return null;
  const { asins, models, rows } = catalogIndex(products);
  if (alternatives.test(text)) return null;
  const asin = (text.match(/(?:\bASIN\s*[:#]?\s*|\/dp\/)([A-Z0-9]{10})(?![A-Z0-9])/i) ??
    (lookupIntent.test(text) && text.match(/\b(B[A-Z0-9]{9})\b/i)))?.[1]?.toUpperCase();
  if (asin) return (asins.get(asin) ?? []).map(({ product }) => product);
  const quoted = text.match(/["“]([^"”\n]+)["”]/)?.[1];
  const codes = modelCodes(quoted ?? text);
  if (!exactIntent.test(text) && !(lookupIntent.test(text) && (quoted || codes.length))) return null;

  const phrases = quoted ? [normalize(quoted)] : (text.match(/[A-Za-z][A-Za-z0-9'/-]*(?:[ \t]+[A-Za-z0-9'/-]+)*/g) ?? [])
    .map(normalize).filter(phrase => phrase.length >= 6 && phrase.includes(' '))
    .sort((a, b) => b.length - a.length);
  if (quoted) {
    const exact = rows.filter(({ names }) => names.includes(phrases[0]));
    if (exact.length) return narrowDetails(exact, text, phrases[0]).map(({ product }) => product);
  }
  const hits = codes.map(code => models.get(code)).filter(Boolean);
  if (hits.length) {
    const remaining = hits.slice(1).map(entries => new Set(entries));
    const candidates = hits[0].filter(row => remaining.every(entries => entries.has(row)));
    return narrowDetails(candidates, text, phrases[0]).map(({ product }) => product);
  }
  for (const phrase of quoted ? [] : phrases) {
    const exact = rows.filter(({ names }) => names.includes(phrase));
    if (exact.length) return narrowDetails(exact, text, phrase).map(({ product }) => product);
  }
  for (const phrase of phrases) {
    const partial = rows.filter(({ names }) => names.some(name => (' ' + name + ' ').includes(' ' + phrase + ' ')));
    if (partial.length) return narrowDetails(partial, text, phrase).map(({ product }) => product);
  }
  return [];
}
