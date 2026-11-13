// Item filter (ITEM_FILTER=on, default off): when the user names an item ("카네이션"), keep only the
// products of that item, if there are at least MIN_MATCHES of them. Scores and LLM calls are untouched;
// this only narrows the product list every chat mode receives.
import { ITEM_STOPWORDS, SINGLE_CHAR_ITEMS, TERM_ALIASES, coreTerms } from './item-terms.mjs';

export const MIN_MATCHES = 3;
export const itemFilterEnabled = env => (env.ITEM_FILTER || 'off') === 'on';

const KOREAN = /[가-힣]/;
// After a one-letter item only a space, punctuation, a particle or 선물/세트 may follow.
const SINGLE_AFTER = /^(?:$|[\s,.!?]|선물|세트|을|를|이|가|은|는|도|로|으로|랑|이랑|하고|과|와)/;
const NEGATION = /^\s*(?:은|는|이|가|을|를|도)?\s*(?:말고|빼고|빼줘|빼 줘|제외|싫어|말구|대신에|대신|아니고)/;

/** Item terms and their spellings, from the seed keywords carried by catalog products. */
export function itemVocabulary(products) {
  const terms = new Set();
  for (const product of products) {
    for (const keyword of product.seed_keywords ?? []) {
      for (const term of coreTerms(keyword)) {
        if (ITEM_STOPWORDS.includes(term)) continue;
        if (term.length === 1 && !SINGLE_CHAR_ITEMS.includes(term)) continue;
        terms.add(term);
      }
    }
  }
  return [...terms].map(term => ({ term, forms: [term, ...(TERM_ALIASES[term] ?? [])] }));
}

// Mentions in one text, longest form first at each position, with negation flags.
function mentions(text, vocabulary) {
  const found = [];
  for (const { term, forms } of vocabulary) {
    for (const form of forms) {
      for (let at = text.indexOf(form); at !== -1; at = text.indexOf(form, at + 1)) {
        const after = text.slice(at + form.length);
        if (form.length === 1 && ((at > 0 && KOREAN.test(text[at - 1])) || !SINGLE_AFTER.test(after))) continue;
        found.push({ term, at, end: at + form.length, negated: NEGATION.test(after) });
      }
    }
  }
  found.sort((a, b) => a.at - b.at || (b.end - b.at) - (a.end - a.at));
  const kept = [];
  for (const mention of found) if (!kept.some(k => mention.at < k.end && k.at < mention.end)) kept.push(mention);
  return kept;
}

/**
 * The item the user means now: the most recent non-negated mention across the user's messages
 * (oldest first). A later negation of that item clears it; otherwise `previous` carries over.
 */
export function currentItem(texts, vocabulary, previous = null) {
  let item = previous;
  for (const text of texts) {
    for (const mention of mentions(text, vocabulary)) {
      if (!mention.negated) item = mention.term;
      else if (item === mention.term) item = null;
    }
  }
  return item;
}

export function productsForItem(products, term) {
  const forms = [term, ...(TERM_ALIASES[term] ?? [])];
  return products.filter(product =>
    (product.seed_keywords ?? []).some(keyword => coreTerms(keyword).includes(term))
    || forms.some(form => (form.length > 1 ? String(product.name).includes(form) : false)));
}

/** Returns the narrowed list, or the original one when the item has fewer than MIN_MATCHES products. */
export function narrowByItem(products, term) {
  if (!term) return { products, applied: null };
  const matched = productsForItem(products, term);
  return matched.length >= MIN_MATCHES ? { products: matched, applied: { term, matched: matched.length } } : { products, applied: null };
}
