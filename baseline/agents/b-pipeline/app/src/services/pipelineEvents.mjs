// Pure part of the b-pipeline app mode (P10, PROTO-REBASE §2·§4 A2~A4): no React, no network of its own.
// The server speaks main's /api/chat contract plus ONE extra `pipeline` block. This file turns that block into the view the
// extra UI draws, maps the UI's requests onto the server's operations, and holds the one conversation's client state
// (session id, version, compare tray, the LLM-wording follow-up). Tested in tests/app-service.test.mjs against the real handlers.

/** Participant IDs replace accounts (K7). Same rule as the server. */
export const validParticipantId = id => typeof id === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(id);

const PRIVATE_HOST = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;
/** Plain http is allowed for this machine or a private network only (local experiment, K7). */
export const isPrivateHost = hostname => PRIVATE_HOST.test(hostname);

/** EXPO_PUBLIC_PIPELINE_URL: a base address only. */
export function resolvePipelineUrl(value) {
  if (!value) return null;
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new Error('추천 서버에는 기본 주소만 설정해주세요.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isPrivateHost(url.hostname))) throw new Error('추천 서버는 HTTPS 주소이거나 같은 네트워크의 주소여야 해요.');
  return url.origin;
}

/** Stand-in for the account session (A2): the participant id is the owner, there is no token. */
export const participantAuth = id => ({ getSession: async () => ({ data: { session: { access_token: 'participant', user: { id } } }, error: null }) });

const ERROR_TEXT = {
  version_conflict: '다른 화면에서 내용이 바뀌었어요. 다시 불러올게요.', invalid_request: '요청을 처리하지 못했어요. 다시 시도해주세요.', internal: '추천 서버에 문제가 생겼어요. 잠시 후 다시 시도해주세요.',
  not_found: '찾을 수 없는 항목이에요.',
};
export const errorText = code => ERROR_TEXT[code] ?? '추천 요청에 실패했어요. 다시 시도해주세요.';

/** Same money format as the server's chips and tags (K52). */
export const wonShort = n => (n >= 10000 && n % 1000 === 0 ? `${n / 10000}만원` : `${n.toLocaleString('ko-KR')}원`);

const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);

/** The optional `pipeline` block of an answer. A wrong shape is a server/app mismatch, never drawn. */
export function validPipelineBlock(block) {
  if (!isObject(block)) return false;
  if (block.tags !== undefined && !(isObject(block.tags) && Object.values(block.tags).every(v => Array.isArray(v) && v.every(t => typeof t === 'string')))) return false;
  if (block.memory_prompts !== undefined && !(Array.isArray(block.memory_prompts) && block.memory_prompts.every(p => isObject(p) && typeof p.kind === 'string'))) return false;
  if (block.hidden_product_ids !== undefined && !(Array.isArray(block.hidden_product_ids) && block.hidden_product_ids.every(v => typeof v === 'string'))) return false;
  if (block.ladder !== undefined && !(Array.isArray(block.ladder) && block.ladder.every(c => isObject(c) && typeof c.label === 'string'))) return false;
  for (const key of ['contrast', 'memory_cf', 'ladder_notice', 'notice']) if (block[key] !== undefined && typeof block[key] !== 'string') return false;
  return true;
}

/** What the extra UI draws. `compare` (the compare tray) lives across turns; everything else is replaced by each full answer. */
export const emptyPipeline = () => ({
  version: null, experiment: null, banner: null, notice: null, recipientChoices: null, budgetChips: null, hiddenProductIds: [],
  tags: {}, giftHistory: {}, contrast: null, memoryCf: null, ladder: null, ladderNotice: null, emphasize: null, explanationSource: 'template',
  prompts: [], compare: [], saved: null, ended: false,
});

const addCompare = (tray, add) => (add?.product && !tray.some(c => c.id === add.product.id)
  ? [...tray, { id: add.product.id, name: add.product.name, price: add.costDelta, rating: add.rating, product: add.product, againstId: add.againstId }] : tray);

/** A full answer (turn / conditions / view / the answers that carry cards): the block replaces the view, the tray is kept and may grow. */
export function foldFull(prev, block = {}) {
  return {
    version: block.version ?? null, experiment: block.experiment ?? prev.experiment, banner: block.banner ?? null, notice: block.notice ?? null,
    recipientChoices: block.recipient_choices ?? null, budgetChips: block.budget_chips ?? null, hiddenProductIds: block.hidden_product_ids ?? [],
    tags: block.tags ?? {}, giftHistory: block.gift_history ?? {}, contrast: block.contrast ?? null, memoryCf: block.memory_cf ?? null,
    ladder: block.ladder ?? null, ladderNotice: block.ladder_notice ?? null, emphasize: block.emphasize ?? null,
    explanationSource: block.explanation_source ?? 'template', prompts: block.memory_prompts ?? [],
    compare: addCompare(prev.compare, block.compare_add), saved: block.memory_saved ?? null, ended: block.session_end === true,
  };
}

/** An answer about something that is not on screen (찜·구매·만족도): only prompts, notices and the tray change; cards and tags stay. */
export function foldSide(prev, block = {}) {
  return {
    ...prev, prompts: block.memory_prompts ?? [], notice: block.notice ?? prev.notice, compare: addCompare(prev.compare, block.compare_add),
    saved: block.memory_saved ?? prev.saved, ended: block.session_end === true || prev.ended,
  };
}

/** The LLM-worded follow-up (operation=explain): only the words change, and only for the cards the tags were made for (AC3). */
export function foldExplain(prev, block = {}) {
  if (block.version !== prev.version) return prev;
  return {
    ...prev, tags: { ...prev.tags, ...(block.tags ?? {}) }, contrast: block.contrast ?? prev.contrast, memoryCf: block.memory_cf ?? prev.memoryCf,
    ladder: block.ladder ?? prev.ladder, ladderNotice: block.ladder_notice ?? prev.ladderNotice, explanationSource: block.explanation_source ?? prev.explanationSource,
  };
}

/** "이 상품만 빼기"는 순위를 바꾸지 않고 화면에서만 숨긴다 (K45). */
export function withoutHidden(turn, hidden) {
  const ids = new Set(hidden ?? []);
  if (!turn?.view?.result?.items || !ids.size) return turn;
  return { ...turn, view: { ...turn.view, result: { ...turn.view.result, items: turn.view.result.items.filter(p => !ids.has(p.id)) } } };
}

/** The UI's requests -> server bodies. `null` means "this request is a conditions change" (handled by the caller). */
export function bodyFor(request) {
  switch (request.kind) {
    case 'end_session': return { operation: 'end_session' };
    case 'memory_confirm': return { operation: 'end_session', accept: request.accept, ...(request.indexes ? { indexes: request.indexes } : {}) };
    case 'ladder_pick': return { operation: 'feedback', kind: 'ladder_save' };
    case 'ladder_compare': return { operation: 'feedback', kind: 'ladder_compare', product_id: request.productId };
    case 'feedback': {
      const kind = request.action === 'dismissed' ? (request.scope === 'category' ? 'dismiss_kind' : request.scope === 'product' ? 'dismiss_one' : 'dismissed') : request.action;
      return { operation: 'feedback', kind, ...(request.productId ? { product_id: request.productId } : {}), ...(request.giftId ? { gift_id: request.giftId } : {}),
        ...(request.satisfaction !== undefined ? { satisfaction: request.satisfaction } : {}) };
    }
    case 'memory_edit': {
      const action = request.op === 'update' ? 'edit' : request.op;
      return { operation: 'memory', action, in_session: true, ...(request.memoryId ? { memory_id: request.memoryId } : {}), ...(request.memoryIds ? { memory_ids: request.memoryIds } : {}),
        ...(request.accept !== undefined ? { accept: request.accept } : {}), ...(request.patch ? { patch: request.patch } : {}) };
    }
    default: return null;
  }
}

/** Patch the screens produce (Conditions shape) -> the fields the server's `conditions` accepts. */
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

/**
 * The client of one participant. `base` is main's serverChatService (send / updateConditions / view) plus `post(body)` for the
 * operations main does not have; the body fields that identify the participant, the conversation and the condition come from
 * `base`'s `extra()` hook, which this client feeds through `fields()`.
 * Returns `chat` (a drop-in for main's serverChat in App.tsx) and the pipeline-only calls. Every full answer is shown through
 * `onTurn` (App sets session + recommendation) and every change of the extra view through `onView`.
 */
export function createPipelineClient({ makeBase, experiment, newId, onTurn = () => {}, onView = () => {} }) {
  let sessionId = newId();
  let version = null;
  let last = null; // the latest session the app sent or the server answered (a valid public state; the server never trusts it)
  let view = emptyPipeline();
  let shownIds = [];
  let pending = {}; // one-shot body fields of the next request (recipient choice, sensitivity, confirmed releases)
  const tasks = new Set();
  // one-shot options belong to the conditions request only (another request in flight must not take them)
  const fields = body => { const mine = body?.operation === 'conditions'; const extra = { session_id: sessionId, ...(experiment ? { experiment } : {}), ...(mine ? pending : {}) }; if (mine) pending = {}; return extra; };
  const base = makeBase(fields);
  const show = next => { view = next; onView(next); };
  const track = promise => { tasks.add(promise); promise.finally(() => tasks.delete(promise)).catch(() => {}); return promise; };
  const sessionFor = session => ({ ...session, ...(version !== null ? { version } : {}) });

  /** A main-shaped answer: fold the block, hide dismissed cards, remember version/session, and ask for the wording. */
  function accept(turn) {
    version = Number.isSafeInteger(turn.session?.version) ? turn.session.version : version;
    last = turn.session ?? last;
    const before = view;
    show(foldFull(view, turn.pipeline));
    const out = withoutHidden(turn, view.hiddenProductIds);
    const ids = out.view?.question?.key ? [] : (out.view?.result?.items?.map(p => p.id) ?? []); // cards are on screen only when no question is pending
    // the same cards of the same version (찜, 구매, 새 대화 질문 ...): keep the words on screen, ask for nothing (no cost, no flicker)
    if (ids.length && before.version === view.version && ids.join() === shownIds.join()) {
      show({ ...view, tags: before.tags, contrast: before.contrast, memoryCf: before.memoryCf, ladder: before.ladder, ladderNotice: before.ladderNotice, explanationSource: before.explanationSource });
    } else if (ids.length) track(explain(ids));
    shownIds = ids;
    return out;
  }

  /** operation=explain: the LLM-worded tags arrive after the cards. Failure keeps the template tags (no message, no error). */
  async function explain(ids) {
    const id = sessionId;
    try {
      const res = await base.post({ operation: 'explain', item_ids: ids });
      if (id === sessionId && validPipelineBlock(res?.pipeline)) show(foldExplain(view, res.pipeline));
    } catch { /* the cards and the template tags are already on screen */ }
  }

  const full = turn => { const out = accept(turn); onTurn(out); return out; };

  async function conditions(patch, extra = {}, clearIssues = true, signal) {
    if (!last) throw new Error('먼저 대화를 시작해주세요.');
    pending = extra;
    return base.updateConditions(sessionFor(last), patch, clearIssues, signal);
  }

  const chat = {
    async send(session, text, history, source = 'typed', signal) {
      last = session;
      const choice = view.recipientChoices?.find(c => (c.label ?? c) === text.trim());
      // a "두 분 함께 / 어머니만" chip is sent as recipient_choice (this request only, K36), never as a sentence
      if (choice) return accept(await conditions({}, { recipient_choice: choice.choice }, true, signal));
      return accept(await base.send(sessionFor(session), text, history, source, signal));
    },
    async updateConditions(session, patch, clearIssues = true, signal) {
      last = session;
      return accept(await base.updateConditions(sessionFor(session), toBaselinePatch(patch), clearIssues, signal));
    },
    async view(session, signal) { last = session; return accept(await base.view(sessionFor(session), signal)); },
  };

  /** A request from the extra UI. Resolves to the turn it showed (or null when the answer carries no cards). */
  async function act(request, signal) {
    if (request.kind === 'patch') {
      const extra = { ...(request.sensitivity ? { sensitivity: request.sensitivity } : {}), ...(request.confirmedReleases ? { confirmed_releases: request.confirmedReleases } : {}),
        ...(request.recipientChoice ? { recipient_choice: request.recipientChoice } : {}) };
      return full(await conditions(toBaselinePatch(request.patch), extra, true, signal));
    }
    const body = bodyFor(request);
    if (!body) throw new Error('지원하지 않는 요청이에요.');
    const res = await base.post(body, signal);
    if (res?.view && res.session?.state) return full(res); // the answer carries the cards of the session as it is now (it passed main's checks in base.post)
    if (validPipelineBlock(res?.pipeline)) show(foldSide(view, res.pipeline));
    return null;
  }

  return {
    chat,
    act,
    /** 찜 / 선물하기: tell the server so it can remember (suggested memories, gift history). The cards stay as they are. */
    feedback: (action, productId) => act({ kind: 'feedback', action, productId }).catch(() => null),
    /** "새 대화": ends the server session so "다음에도 기억할까요?" can be asked. The prompts are in the view afterwards. */
    end: signal => act({ kind: 'end_session' }, signal),
    /** Starts the next conversation: a new session id, an empty view (the tray too). */
    reset() { sessionId = newId(); version = null; last = null; pending = {}; shownIds = []; show(emptyPipeline()); },
    /** Memory of the participant (my page / the app's panel): list people, list one person's memories, delete, edit. */
    memory: {
      people: signal => base.post({ operation: 'memory', action: 'list' }, signal),
      of: (recipientId, signal) => base.post({ operation: 'memory', action: 'list', recipient_id: recipientId }, signal),
      remove: (memoryId, signal) => act({ kind: 'memory_edit', op: 'delete', memoryId }, signal).then(turn => turn ?? { deleted: true }),
    },
    get view() { return view; },
    get sessionId() { return sessionId; },
    idle: () => Promise.allSettled([...tasks]),
  };
}
