// b-pipeline rules for short multi-turn answers, applied BEFORE parseRules (0 LLM calls).
//   "2세트" "2개"        -> quantity
//   "개당" "2개당"        -> budget.scope = per_set
//   "배송비 포함해서"      -> shipping_included (also a bare "포함해서" / "별도로")
//   "네" (alone)         -> same_product = true, but only while the engine is asking "모두 같은 상품으로 보낼까요?"
// Only recognized pieces are cut out; whatever is left goes on to parseRules, which still refuses anything it does not know.
const QTY_RE = /(?<![\d.])(\d{1,3})\s*(?:세트|개)(당)?(?![가-힣])/;
const PER_UNIT_RE = /(?<![가-힣\d])개당(?![가-힣])/;
const SHIP_PHRASE_RE = /배송비\s*포함\s*(?:해서|해|하고|하면|으로|이면|인)?(?![가-힣])/;
const SHIP_OUT_PHRASE_RE = /배송비\s*(?:별도|제외)\s*(?:로|해서|하고|이면|인)?(?![가-힣])/;
const SHIP_BARE_IN_RE = /(?<![가-힣])포함\s*(?:해서|해|하고|으로)(?![가-힣])/;
const SHIP_BARE_OUT_RE = /(?<![가-힣])별도\s*(?:로|해서)(?![가-힣])/;
const YES_RE = /^(?:네|넵|예|응|어|그래|좋아요?|그렇게\s*(?:해|해줘|해주세요)|같은\s*걸로(?:\s*(?:해|해줘|해주세요))?)[\s,.!~]*$/;

/** -> {found, patch, rest}. `rest` is the text left for parseRules; `found` is false when nothing was recognized. */
export function splitShortAnswers(text, state) {
  let rest = String(text ?? '').normalize('NFC').trim();
  const patch = {};
  const budget = {};
  const cut = (re, fn) => { const m = rest.match(re); if (!m) return false; rest = rest.replace(re, ' '); fn?.(m); return true; };

  if (YES_RE.test(rest)) {
    // "네" means something only as the answer to the engine's same-product question
    if ((state?.quantity ?? 0) > 1 && state?.same_product !== true) return { found: true, patch: { same_product: true }, rest: '' };
    return { found: false, patch, rest };
  }

  let found = false;
  found = cut(QTY_RE, m => { patch.quantity = Number(m[1]); if (m[2]) budget.scope = 'per_set'; }) || found;
  found = cut(PER_UNIT_RE, () => { budget.scope = 'per_set'; }) || found;
  // "배송비 포함해서" is rewritten to the phrase parseRules knows, so a sentence with an amount still resolves
  if (cut(SHIP_PHRASE_RE)) { budget.shipping_included = true; found = true; }
  else if (cut(SHIP_OUT_PHRASE_RE)) { budget.shipping_included = false; found = true; }
  else if (cut(SHIP_BARE_IN_RE)) { budget.shipping_included = true; found = true; }
  else if (cut(SHIP_BARE_OUT_RE)) { budget.shipping_included = false; found = true; }
  if (!found) return { found: false, patch, rest: String(text ?? '') };

  if (Object.keys(budget).length) patch.budget = budget;
  return { found: true, patch, rest };
}
