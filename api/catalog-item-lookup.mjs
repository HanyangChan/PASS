const lookupIntent = /찾아|찾고|보여|같은 모델|동일 모델|실물을|주문 후보|\b(?:find|look up)\b/i;
const alternatives = /말고|제외|비교|\b(?:except|compare)\b/i;
const normalize = text => String(text ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const explicitAsin = /\bASIN\s*[:#]?\s*[A-Z0-9]{10}\b|\/dp\/[A-Z0-9]{10}\b|\bB[A-Z0-9]{9}\b/i;
export const catalogLookupNeedsInterpretation = /알레르|알러지|성분|피해야|배송|예산|오늘까지|내일까지|이하|이내|미만|\d\s*(?:만\s*원|천\s*원|원)|(?:개|세트)\s*(?:합쳐|합산)|빼|변경|바꿔|설명|추천\s*이유|\b(?:allerg\w*|ingredient\w*|shipping|delivery|budget|explain)\b/i;

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

export function lookupIndexedCatalogItem(text, products, {matchNameWords=false}={}) {
  if (!text) return null;
  if (alternatives.test(text)) return null;
  const asin = (text.match(/(?:\bASIN\s*[:#]?\s*|\/dp\/)([A-Z0-9]{10})(?![A-Z0-9])/i) ??
    (lookupIntent.test(text) && text.match(/\b(B[A-Z0-9]{9})\b/i)))?.[1]?.toUpperCase();
  if (asin) return (catalogIndex(products).asins.get(asin) ?? []).map(({ product }) => product);
  const quoted = text.match(/["“]([^"”\n]+)["”]/)?.[1];
  const codes = modelCodes(quoted ?? text);
  const explicitProduct=exactIntent.test(text) || (matchNameWords&&/이\s*(?:제품|상품)을?\s*고르고|(?:제품|상품)이?\s*있으면\s*보여|실물을\s*찾/.test(text));
  if (!explicitProduct && !(lookupIntent.test(text) && (quoted || codes.length))) return null;

  const phrases = quoted ? [normalize(quoted)] : (text.match(/[A-Za-z][A-Za-z0-9'/-]*(?:[ \t]+[A-Za-z0-9'/-]+)*/g) ?? [])
    .map(normalize).filter(phrase => phrase.length >= 6 && phrase.includes(' '))
    .sort((a, b) => b.length - a.length);
  if(matchNameWords && !quoted && !phrases.length && !codes.length) return null;
  const { models, rows } = catalogIndex(products);
  if (quoted) {
    const exact = rows.filter(({ names }) => names.includes(phrases[0]));
    if (exact.length) return narrowDetails(exact, text, phrases[0]).map(({ product }) => product);
  }
  const hits = codes.map(code => models.get(code)).filter(Boolean);
  if (hits.length) {
    const remaining = hits.slice(1).map(entries => new Set(entries));
    const candidates = hits[0].filter(row => remaining.every(entries => entries.has(row)));
    if(candidates.length || !matchNameWords) return narrowDetails(candidates, text, phrases[0]).map(({ product }) => product);
  }
  for (const phrase of quoted ? [] : phrases) {
    const exact = rows.filter(({ names }) => names.includes(phrase));
    if (exact.length) return narrowDetails(exact, text, phrase).map(({ product }) => product);
  }
  for (const phrase of phrases) {
    const partial = rows.filter(({ names }) => names.some(name => (' ' + name + ' ').includes(' ' + phrase + ' ')));
    if (partial.length) return narrowDetails(partial, text, phrase).map(({ product }) => product);
  }
  if(matchNameWords && explicitProduct) {
    for (const phrase of phrases) {
      const words=[...new Set(phrase.split(' '))].filter(word=>word.length>=2);
      if(words.length<2 || !words.some(word=>/[a-z]{3}/.test(word))) continue;
      const matches=rows.filter(({names})=>names.some(name=>{
        const padded=' '+name+' ';
        return words.every(word=>padded.includes(' '+word+' '));
      }));
      if(matches.length) return narrowDetails(matches,text,phrase).map(({product})=>product);
    }
  }
  return [];
}

export function lookupRankedCatalogItem(text, products) {
  if (!text || alternatives.test(text)) return null;
  const quoted = text.match(/["“]([^"”\n]+)["”]/)?.[1];
  const asksForProduct = lookupIntent.test(text) || exactIntent.test(text) || /검색해|조회해/.test(text);
  const lookupText = asksForProduct && !lookupIntent.test(text) ? `${text} 찾아줘` : text;
  const matches = lookupIndexedCatalogItem(lookupText, products, {matchNameWords:true});
  if (!asksForProduct) return matches;
  if (explicitAsin.test(text)) return matches;

  // Keep punctuation inside English titles and compare complete normalized phrases.
  const query = normalize(quoted ?? (text.match(/[A-Za-z][^가-힣]*/g) ?? [])
    .map(value=>value.trim()).sort((a,b)=>b.length-a.length)[0]);
  if (query.split(' ').length < 3) return matches;
  const phrase = ` ${query} `;
  const catalog = catalogIndex(products);
  const exact = [];
  const partial = [];
  for (const row of catalog.rows) {
    const length = Math.max(0, ...row.names.filter(name=>name.length>=12 &&
      (quoted ? name===query : phrase.includes(` ${name} `))).map(name=>name.length));
    if (length) exact.push({row,length});
    else if (row.names.some(name=>` ${name} `.includes(phrase))) partial.push(row);
  }
  if (exact.length) {
    // The most specific complete title wins over a shorter title embedded inside it.
    const longest = exact.reduce((length, entry)=>Math.max(length,entry.length),0);
    return narrowDetails(exact.filter(entry=>entry.length===longest).map(entry=>entry.row), text, query)
      .map(({product})=>product).sort((a,b)=>a.id.localeCompare(b.id));
  }
  if (partial.length) {
    return narrowDetails(partial, text, query).sort((a,b)=>
      Math.min(...a.names.map(name=>name.length))-Math.min(...b.names.map(name=>name.length)) ||
      a.product.id.localeCompare(b.product.id)).map(({product})=>product);
  }
  return matches?.sort((a,b)=>a.id.localeCompare(b.id)) ?? null;
}

const retryColors = [...detailAliases,
  [/\bgreen\b|초록색|녹색|그린/i, 'green'],
  [/\b(?:gray|grey)\b|회색|그레이/i, 'grey'],
  [/\bpurple\b|보라색|퍼플/i, 'purple'],
];
const variantSizes = /(?<![\d.])\d+(?:\.\d+)?\s*(?:ml|cm|mm|inch|kg|gb|tb)\b/gi;
const rawTitle = value => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
const sizes = value => [...new Set([...value.matchAll(variantSizes)].map(([size])=>size.toLowerCase().replace(/\s/g,'')))];

// Search again using title tokens and explicitly stated variant details.
// A repeated identifier lookup cannot establish a different product's identity.
export function retryExactCatalogItem(text, products, rejectedIds = []) {
  if (explicitAsin.test(text)) return null;
  const quoted = text.match(/["“]([^"”\n]+)["”]/)?.[1];
  const clue = quoted ?? (text.match(/[A-Za-z][^가-힣]*/g) ?? []).sort((a,b)=>b.length-a.length)[0] ?? '';
  const words = [...new Set(normalize(clue).split(' '))].filter(word=>/[a-z]/.test(word) && word.length>1);
  const codes = modelCodes(clue);
  if (words.length<3 && !codes.length) return null;
  const wantedColors = retryColors.filter(([pattern])=>pattern.test(text));
  const wantedSizes = sizes(text);
  if (wantedColors.length>1 || wantedSizes.length>1) return null;
  const {rows,models} = catalogIndex(products);
  const modelRows = codes.map(code=>new Set(models.get(code)??[]));
  const rejected = new Set(rejectedIds);
  const candidates = (modelRows.length ? [...modelRows[0]] : rows).filter(row=>
    !rejected.has(row.product.id) && modelRows.every(matches=>matches.has(row)) &&
    row.names.some(name=>words.every(word=>` ${name} `.includes(` ${word} `))) &&
    [row.product.name,row.product.name_en].filter(Boolean).some(name=>
      wantedColors.every(([pattern])=>pattern.test(name)) &&
      (wantedSizes.length===0 || wantedSizes.every(size=>sizes(name).includes(size)))));
  if (quoted && !/앞부분|일부|시작|prefix|starts? with/i.test(text)) {
    const rawExact=candidates.filter(({product})=>[product.name,product.name_en].some(name=>name&&rawTitle(name)===rawTitle(quoted)));
    if (rawExact.length) return rawExact.map(({product})=>product);
  }
  return candidates.map(({product})=>product);
}
