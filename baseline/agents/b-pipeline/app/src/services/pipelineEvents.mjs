// Pure helpers of the b-pipeline app mode (no React, no network): SSE parsing, folding events into one turn view,
// the view the existing screens expect, and quick replies for the baseline questions. Tested in tests/app-service.test.mjs.

/** Incremental SSE parser. feed(chunk) returns the complete frames received so far as [{type, data}]. */
export function createSseParser() {
  let buf = '';
  return {
    feed(chunk) {
      buf += chunk.replace(/\r\n/g, '\n');
      const frames = [];
      let i;
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const raw = buf.slice(0, i); buf = buf.slice(i + 2);
        let type = 'message'; const data = [];
        for (const line of raw.split('\n')) {
          if (line.startsWith('event:')) type = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        }
        if (!data.length) continue;
        try { frames.push({ type, data: JSON.parse(data.join('\n')) }); } catch { /* a broken frame is dropped, never shown */ }
      }
      return frames;
    },
  };
}

export const emptyTurn = () => ({
  version: null, question: null, cards: [], products: [], annotations: {}, banner: null, notice: null, hiddenProductIds: [],
  recipientChoices: null, budgetChips: null, conditions: null, explanations: null, emphasize: null, prompts: [], compare: [], error: null, saved: null, ended: false,
});

/** Folds one pipeline/server event into the turn. Cards always arrive before explanations (AC3); a new question/cards resets the view. */
export function reduceEvent(turn, e) {
  const t = { ...turn };
  switch (e.type) {
    case 'question':
      return { ...emptyTurn(), compare: turn.compare, version: e.version ?? null, question: e.question, banner: e.banner ?? null, recipientChoices: e.recipientChoices ?? null, budgetChips: e.budgetChips ?? null };
    case 'cards': case 'comparison':
      return { ...emptyTurn(), compare: turn.compare, version: e.version ?? null, cards: e.result?.cards ?? [], message: e.result?.message ?? '', banner: e.banner ?? null, notice: e.notice ?? null,
        hiddenProductIds: e.hiddenProductIds ?? [], recipientChoices: e.recipientChoices ?? null, preview: e.type === 'comparison',
        annotations: Object.fromEntries((e.annotations ?? []).map(a => [a.id, a])) };
    case 'conditions': t.conditions = e.conditions; t.products = e.products ?? t.products; return t;
    case 'memory_prompt': t.prompts = [...t.prompts, e]; return t;
    case 'explanations': t.explanations = e.items ?? []; t.emphasize = e.emphasize ?? null; return t;
    case 'compare_add': if (e.product && !t.compare.some(c => c.id === e.product.id)) t.compare = [...t.compare, { id: e.product.id, name: e.product.name, price: e.costDelta, rating: e.rating, product: e.product, againstId: e.againstId }]; return t;
    case 'memory_saved': t.saved = e; return t;
    case 'session_end': t.ended = true; return t;
    case 'error': t.error = e.code ?? 'internal'; return t;
    default: return t;
  }
}

const ERROR_TEXT = {
  version_conflict: '다른 화면에서 내용이 바뀌었어요. 다시 불러올게요.', invalid_request: '요청을 처리하지 못했어요. 다시 시도해주세요.', internal: '추천 서버에 문제가 생겼어요. 잠시 후 다시 시도해주세요.',
  not_found: '찾을 수 없는 항목이에요.',
};
export const errorText = code => ERROR_TEXT[code] ?? '추천 요청에 실패했어요. 다시 시도해주세요.';

/** Quick replies for the baseline questions. Every reply is a sentence parseRules understands (checked in the test). */
export function quickRepliesFor(question, budgetChips = null) {
  if (typeof question !== 'string') return [];
  if (budgetChips?.length) return budgetChips.map(c => c.label);
  if (/예산 상한/.test(question)) return ['3만원', '5만원', '10만원'];
  if (/배송비/.test(question)) return ['배송비 포함', '상품값만'];
  if (/수량/.test(question)) return ['한 세트'];
  if (/총예산인지 세트당/.test(question)) return ['세트당'];
  return [];
}

/** The `view` the existing screens read: question / result / comparison. Items are engine products + total. */
export function viewOf(turn) {
  const byId = new Map(turn.products.map(p => [p.id, p]));
  const hidden = new Set(turn.hiddenProductIds);
  const items = turn.cards.filter(c => byId.has(c.id) && !hidden.has(c.id)).map(c => ({ ...byId.get(c.id), total: c.total_krw }));
  const text = turn.question ?? '';
  return {
    question: { key: turn.question ? 'pipeline' : null, text, choices: [...(turn.recipientChoices?.map(c => c.label ?? c) ?? []), ...quickRepliesFor(turn.question, turn.budgetChips)] },
    result: { status: items.length ? 'ok' : 'empty', items, message: turn.message ?? '' },
    comparison: { message: '', alternatives: [] }, // budget raising is not offered here: "올리기" is a compare-tray chip (K50)
  };
}

/** Patch the screens produce (Conditions shape) -> the fields the pipeline's `patch` request accepts. */
const PATCH_KEYS = ['recipients', 'occasion', 'budget', 'preferences', 'excluded_categories', 'excluded_ingredients', 'brand', 'delivery_by', 'packaging'];
export function toBaselinePatch(patch) {
  const out = {};
  for (const k of PATCH_KEYS) if (patch && patch[k] !== undefined) out[k] = patch[k];
  if (out.budget) {
    const b = {};
    for (const k of ['amount_krw', 'shipping_included']) if (out.budget[k] !== undefined && out.budget[k] !== null) b[k] = out.budget[k];
    if (Object.keys(b).length) out.budget = b; else delete out.budget;
  }
  return out;
}

/** Same money format as the server's chips and tags (K52). */
export const wonShort = n => (n >= 10000 && n % 1000 === 0 ? `${n / 10000}만원` : `${n.toLocaleString('ko-KR')}원`);

/** Participant IDs replace accounts (K7). Same rule as the server. */
export const validParticipantId = id => typeof id === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(id);

/** EXPO_PUBLIC_PIPELINE_URL: a base address only; plain http only for this machine or a private network (local experiment, K7). */
export function resolvePipelineUrl(value) {
  if (!value) return null;
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new Error('추천 서버에는 기본 주소만 설정해주세요.');
  const local = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('추천 서버는 HTTPS 주소이거나 같은 네트워크의 주소여야 해요.');
  return url.origin;
}
