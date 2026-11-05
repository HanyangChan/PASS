// Local experiment server (K7, K57, P9). node:http only, no dependencies.
//  - POST /api/chat has main's worker contract (proto/api/worker.mjs): {operation: turn | conditions | view, session, ...}
//    -> {session, message, mode, view:{question, result, comparison}, catalog} (+ errors {error, code}), plus ONE extra
//    block `pipeline` (banner, tags, contrast, memory_prompts, ...). No streaming: the cards and the template tags come in the
//    same JSON answer; the LLM wording is the later operation=explain (AC3). Other operations: explain, feedback, memory, end_session.
//  - Participant IDs replace accounts (K7): `participant_id` + `session_id` in the body. The saved session in the DB is the
//    truth; the `session` the client sends is only checked for shape (main's validation), never trusted.
//  - createHandlers({store, products, pipeline}) holds routing, validation and mapping. Tests call it directly (no socket).
//  - Nothing the user typed is logged. Errors are answered with a code only.
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createPipeline, EXPERIMENTS } from '../pipeline/index.mjs';
import { createMemoryWriter } from '../memory/write.mjs';
import { keyLabel, MemoryError } from '../memory/keys.mjs';
import { StoreError } from '../db/contract.mjs';
import { createLlm, llmProvider } from '../llm/index.mjs';
import { normalizeConditions } from '../proto/lib/condition-compat.mjs';
import { validateState, validateRequest } from '../proto/lib/llm.mjs';
import { apply } from '../proto/lib/engine.mjs';
import { CATALOG_ID } from '../proto/lib/catalog.mjs';
import { publicState, singleInitial, singleQuestion, finishSingle } from '../proto/lib/single-gift.mjs';
import { recommendationView } from '../proto/api/worker.mjs';
import { wonShort } from '../explainer/template.mjs';

export const MAX_BODY_BYTES = 32768; // main worker's limit
export const OPERATIONS = ['turn', 'conditions', 'view', 'explain', 'feedback', 'memory', 'end_session'];
const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const FEEDBACK_KINDS = { chosen: ['feedback', { action: 'chosen' }], purchased: ['feedback', { action: 'purchased' }], satisfaction: ['feedback', { action: 'satisfaction' }], dismissed: ['feedback', { action: 'dismissed' }],
  dismiss_one: ['feedback', { action: 'dismissed', scope: 'product' }], dismiss_kind: ['feedback', { action: 'dismissed', scope: 'category' }], ladder_save: ['ladder_pick', { direction: 'down' }], ladder_compare: ['ladder_compare', {}] };
const MEMORY_OPS = { resolve_conflict: 'resolve_conflict', accept_suggested: 'accept_suggested', sensitivity: 'sensitivity' };
const STATUS = { invalid_request: 400, invalid_store_input: 400, forbidden_event_field: 400, not_found: 404, version_conflict: 409, session_exists: 409, allergy_cannot_decrease: 409, not_editable: 400, unknown_key: 400 };
// user-facing line for an error code (main's `error` is a Korean sentence, `code` the machine name)
const ERROR_TEXT = { invalid_request: '입력 형식을 확인해주세요.', invalid_owner: '참가자 ID를 확인해주세요.', invalid_json: '입력 형식을 확인해주세요.', body_too_large: '입력이 너무 길어요.', not_found: '찾을 수 없어요.', version_conflict: '화면이 오래되었어요. 다시 불러올게요.',
  session_exists: '이미 시작된 대화예요.', method_not_allowed: 'POST 요청이 필요합니다.', allergy_cannot_decrease: '알레르기는 줄일 수 없어요.', internal: '서버 응답을 처리하지 못했어요. 다시 시도해주세요.' };
const errorBody = code => ({ error: ERROR_TEXT[code] ?? '요청을 처리하지 못했어요.', code });

/** Thrown for shape errors before anything runs. Carries only a code. */
export class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const bad = (code = 'invalid_request') => new HttpError(400, code);
const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const idOf = (x, code = 'invalid_request') => { if (typeof x !== 'string' || !ID.test(x)) throw bad(code); return x; };
const optionalId = (x, code) => (x === undefined ? undefined : idOf(x, code));
const statusOfCode = code => STATUS[code] ?? (code === 'internal' ? 500 : 400);

const publicRecipient = r => ({ id: r.id, name: r.name, aliases: r.aliases, groupName: r.groupName, budgetCapKrw: r.budgetCapKrw, priceSensitivity: r.priceSensitivity });
const publicMemory = m => ({ id: m.id, key: m.key, label: keyLabel(m.key), polarity: m.polarity, strength: m.strength, status: m.status, source: m.source, evidence: m.evidence });
const without = (o, ...keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

/**
 * @param {{store:object, products:object[], pipeline?:object}} deps
 * @returns {{route:(req:{method:string,path:string,body?:any})=>Promise<{status:number, json:any}>}}
 */
export function createHandlers({ store, products, pipeline = createPipeline({ store, products }) }) {
  const writer = createMemoryWriter({ store });

  /** main's validation (proto/api/worker.mjs inputOf) of the session the client sends; the result is not used as state. */
  function mainInput(raw) {
    try {
      const session = { ...raw.session, state: normalizeConditions(raw.session?.state).state };
      validateState(session.state);
      if (!Array.isArray(session.issues) || session.issues.length > 12 || session.issues.some(q => typeof q !== 'string' || q.length > 400)) throw Error();
      if (raw.operation === 'turn') validateRequest({ ...session, text: raw.text, history: raw.history, source: raw.source });
      if (raw.operation === 'conditions') {
        if (!isObject(raw.patch) || Object.keys(raw.patch).some(key => !Object.hasOwn(session.state, key))) throw Error();
        if (raw.patch.budget !== undefined && (!isObject(raw.patch.budget) || Object.keys(raw.patch.budget).some(key => !['amount_krw', 'shipping_included'].includes(key)))) throw Error();
        validateState(normalizeConditions(apply(session.state, raw.patch)).state);
        if (raw.clearIssues !== undefined && typeof raw.clearIssues !== 'boolean') throw Error();
      }
    } catch { throw bad(); }
  }

  /** The body -> {ownerId, sessionId, recipientId?, experiment?, request}. Errors are thrown before anything runs. */
  function parse(body) {
    if (!isObject(body) || !OPERATIONS.includes(body.operation)) throw bad();
    const { operation: op } = body;
    const ownerId = idOf(body.participant_id, 'invalid_owner'), sessionId = idOf(body.session_id);
    if (body.experiment !== undefined && !EXPERIMENTS.includes(body.experiment)) throw bad();
    const args = { ownerId, sessionId, recipientId: optionalId(body.recipient_id), experiment: body.experiment, op };
    const expected = isObject(body.session) && Number.isSafeInteger(body.session.version) ? { expectedVersion: body.session.version } : {};
    const chosen = body.recipient_choice !== undefined ? { recipientChoice: typeof body.recipient_choice === 'string' && body.recipient_choice.length <= 64 ? body.recipient_choice : (() => { throw bad(); })() } : {};
    if (op === 'turn' || op === 'conditions' || op === 'view') {
      mainInput(body);
      if (op === 'turn') return { ...args, request: { kind: 'message', text: body.text, history: body.history, source: body.source ?? 'typed', ...chosen, ...expected } };
      if (op === 'conditions') {
        const req = { kind: 'patch', patch: body.patch, ...chosen, ...expected };
        if (body.clearIssues !== undefined) req.clearIssues = body.clearIssues;
        if (body.sensitivity !== undefined) req.sensitivity = body.sensitivity;
        if (body.confirmed_releases !== undefined) req.confirmedReleases = body.confirmed_releases;
        return { ...args, request: req };
      }
      if (body.what_if_amount_krw !== undefined) return { ...args, request: { kind: 'what_if_budget', amount_krw: body.what_if_amount_krw, ...expected } };
      return { ...args, request: { kind: 'view', ...expected } };
    }
    if (op === 'explain') {
      if (body.item_ids !== undefined && (!Array.isArray(body.item_ids) || body.item_ids.length > 12 || !body.item_ids.every(x => typeof x === 'string' && x.length <= 80))) throw bad();
      return { ...args, itemIds: body.item_ids, request: { kind: 'explain', ...expected } };
    }
    if (op === 'feedback') {
      const map = FEEDBACK_KINDS[body.kind];
      if (!map) throw bad();
      const [kind, fixed] = map;
      const pick = (...keys) => Object.fromEntries(keys.filter(k => body[k] !== undefined).map(k => [k, body[k]]));
      const extra = kind === 'feedback' ? { ...pick('scope', 'satisfaction'), ...(body.product_id !== undefined ? { productId: body.product_id } : {}), ...(body.gift_id !== undefined ? { giftId: body.gift_id } : {}) }
        : kind === 'ladder_compare' ? { productId: body.product_id } : {};
      return { ...args, request: { kind, ...extra, ...fixed, ...expected } };
    }
    if (op === 'end_session') {
      if (body.accept === undefined) return { ...args, request: { kind: 'end_session' } };
      return { ...args, request: { kind: 'memory_confirm', accept: body.accept, ...(body.indexes !== undefined ? { indexes: body.indexes } : {}) } };
    }
    return { ...args, request: null }; // memory: handled in memoryOperation
  }

  const turnArgs = a => ({ ownerId: a.ownerId, sessionId: a.sessionId, ...(a.recipientId ? { recipientId: a.recipientId } : {}), ...(a.experiment ? { experiment: a.experiment } : {}), request: a.request });

  async function runTurn(a) {
    try { return await pipeline.runPipelineTurn({ ...turnArgs(a), llmExplain: a.op === 'explain' }); }
    catch { return { events: [{ type: 'error', code: 'internal' }], mode: 'rules' }; } // the message could hold user text: code only
  }

  /** The `pipeline` block: everything the experiment adds to main's answer, folded from the pipeline events of the turn. */
  function pipelineBlock(events, row, experiment) {
    const find = type => events.find(e => e.type === type);
    const shown = find('cards') ?? find('comparison') ?? find('question');
    const ex = find('explanations');
    const top = ex?.items?.[0];
    const tagged = new Map((find('cards')?.annotations ?? []).map(a => [a.id, a]));
    const tags = {}, gift = {};
    for (const [id, a] of tagged) { tags[id] = a.tags; if (a.giftHistory) gift[id] = a.giftHistory; }
    for (const item of ex?.items ?? []) tags[item.id] = item.tags; // the explainer's tags (template or verified LLM) replace the template draft
    return {
      version: row?.session.version ?? shown?.version ?? 0,
      experiment: experiment ?? row?.meta.experiment ?? null, // the condition the turn ran under (the request may name it without saving)
      banner: shown?.banner ?? null,
      recipient_choices: shown?.recipientChoices ?? null,
      budget_chips: find('question')?.budgetChips ?? null,
      hidden_product_ids: find('cards')?.hiddenProductIds ?? row?.meta.hiddenProductIds ?? [],
      ...(find('cards')?.notice ? { notice: find('cards').notice } : {}),
      tags, gift_history: gift,
      ...(top?.contrastChip ? { contrast: top.contrastChip } : {}),
      ...(top?.memoryCfLine ? { memory_cf: top.memoryCfLine } : {}),
      ...(top?.ladderChips ? { ladder: top.ladderChips } : {}),
      ...(top?.ladderNotice ? { ladder_notice: top.ladderNotice } : {}),
      ...(ex?.emphasize ? { emphasize: ex.emphasize } : {}),
      explanation_source: ex?.source ?? 'template',
      memory_prompts: events.filter(e => e.type === 'memory_prompt').map(e => without(e, 'type')),
      ...(find('compare_add') ? { compare_add: { ...without(find('compare_add'), 'type'), product: products.find(p => p.id === find('compare_add').productId) ?? null } } : {}),
      ...(find('memory_saved') ? { memory_saved: without(find('memory_saved'), 'type') } : {}),
      ...(find('session_end') ? { session_end: true } : {}),
    };
  }

  /** Smallest budget cap (per set, shipping included) of the saved session's people; null = none (R3). Placeholders have no row. */
  async function capOf(ownerId, ids = []) {
    const caps = [];
    for (const id of ids) { if (id.startsWith('new:')) continue; const r = await store.getRecipient(ownerId, id); if (r?.budgetCapKrw) caps.push(r.budgetCapKrw); }
    return caps.length ? Math.min(...caps) : null;
  }
  const setCost = p => p.price_krw + p.shipping_fee_per_set_krw;

  /**
   * main's answer for a turn/conditions/view, built from the saved session (the single source of truth).
   * R3/AC14: the cap is judged here from the saved session on EVERY answer (not from this turn's events, because a state above
   * the cap is saved before it is asked about): a state or card above the cap sends no items and no comparison.
   * Condition A has no price options (AC12): its comparison (budget-raising alternatives) is empty.
   */
  async function mainAnswer(a, before, { events, mode }, { whatIf } = {}) {
    const row = await store.getSession(a.ownerId, a.sessionId);
    const state = row ? publicState(row.session.state) : singleInitial();
    const issues = row?.meta.issues ?? [];
    const shownState = whatIf ? { ...state, budget: { ...state.budget, amount_krw: whatIf } } : state; // a what-if is shown, never saved (AC15)
    const experiment = a.experiment ?? row?.meta.experiment ?? 'B';
    const cap = await capOf(a.ownerId, row?.meta.recipientIds);
    const asked = events.find(e => e.type === 'question');
    const sq = singleQuestion({ state, issues });
    const view = recommendationView({ state: shownState, issues }, products);
    const gated = cap !== null && ((shownState.budget.amount_krw ?? 0) > cap || view.result.items.some(p => setCost(p) > cap));
    if (gated) {
      const text = asked?.gated ? asked.question : `이 분께는 예산 상한 ${wonShort(cap)}(세트당, 배송비 포함)을 정해 두셨어요. 그 안으로 다시 알려주세요.`;
      view.result = { ...view.result, items: [], message: text };
      view.comparison = { status: 'no_alternative', message: '', alternatives: [] };
      const understood = finishSingle(before, state, issues, products).message.split('\n')[0];
      return { session: { state, issues, version: row?.session.version ?? 0 }, message: `${understood.startsWith('이렇게') ? `${understood}\n` : ''}${text}`, mode, view: { ...view, question: { key: 'budget', text, choices: [] } }, catalog: CATALOG_ID, pipeline: pipelineBlock(events, row, a.experiment) };
    }
    if (experiment === 'A') view.comparison = { status: 'no_alternative', message: '', alternatives: [] };
    else if (cap !== null) {
      const alternatives = view.comparison.alternatives.filter(x => x.amount <= cap);
      view.comparison = alternatives.length === view.comparison.alternatives.length ? view.comparison : { status: alternatives.length ? 'ready' : 'no_alternative', message: alternatives.length ? view.comparison.message : '', alternatives };
    }
    const question = asked ? { key: sq.text === asked.question ? sq.key : null, text: asked.question, choices: asked.choices ?? [] } : sq;
    return { session: { state, issues, version: row?.session.version ?? 0 }, message: finishSingle(before, state, issues, products).message, mode, view: { ...view, question }, catalog: CATALOG_ID, pipeline: pipelineBlock(events, row, a.experiment) };
  }

  async function chat(body) {
    const a = parse(body);
    if (a.op === 'memory') return memoryOperation(a, body);
    const prior = await store.getSession(a.ownerId, a.sessionId);
    const before = prior ? publicState(prior.session.state) : singleInitial();
    const out = await runTurn(a);
    const err = out.events.find(e => e.type === 'error');
    if (err) return { __status: statusOfCode(err.code), ...errorBody(err.code) };
    const asked = out.events.find(e => e.type === 'question');
    // an LLM failure (main: 503 + the failure sentence, conditions unchanged) keeps its sentence and code
    if (asked?.code) return { __status: 503, error: asked.question, code: asked.code };
    if (a.op === 'explain') {
      const row = await store.getSession(a.ownerId, a.sessionId);
      const block = pipelineBlock(out.events, row, a.experiment);
      if (a.itemIds) block.tags = Object.fromEntries(Object.entries(block.tags).filter(([id]) => a.itemIds.includes(id)));
      return { session: { version: row?.session.version ?? 0 }, catalog: CATALOG_ID, pipeline: { version: block.version, experiment: block.experiment, tags: block.tags, ...(block.contrast ? { contrast: block.contrast } : {}), ...(block.memory_cf ? { memory_cf: block.memory_cf } : {}), ...(block.ladder ? { ladder: block.ladder } : {}), ...(block.ladder_notice ? { ladder_notice: block.ladder_notice } : {}), explanation_source: block.explanation_source } };
    }
    if (['turn', 'conditions', 'view'].includes(a.op)) return mainAnswer(a, before, out, { whatIf: a.request.kind === 'what_if_budget' ? a.request.amount_krw : undefined });
    // feedback / end_session: the cards and tags of the session as it is now, plus the prompts and results of the request
    const row = await store.getSession(a.ownerId, a.sessionId);
    const base = row ? await mainAnswer(a, publicState(row.session.state), out) : { catalog: CATALOG_ID, pipeline: pipelineBlock(out.events, null, a.experiment) };
    return base;
  }

  async function memoryOperation(a, body) {
    const { ownerId } = a;
    const action = body.action;
    if (!['list', 'edit', 'delete', ...Object.keys(MEMORY_OPS)].includes(action)) throw bad();
    if (action === 'list') {
      if (a.recipientId === undefined) return { recipients: (await store.listRecipients(ownerId)).map(publicRecipient) };
      const recipient = await store.getRecipient(ownerId, a.recipientId);
      if (!recipient) throw new HttpError(404, 'not_found');
      return {
        recipient: publicRecipient(recipient),
        memories: (await store.listMemories(ownerId, a.recipientId)).map(publicMemory),
        gifts: (await store.listGifts(ownerId, a.recipientId)).map(g => ({ id: g.id, productId: g.productId, productName: products.find(p => p.id === g.productId)?.name ?? null, occasion: g.occasion, givenAt: g.givenAt, satisfaction: g.satisfaction })),
      };
    }
    const memoryId = idOf(body.memory_id);
    // inside a conversation (session_id given and saved) the change also refreshes the conditions (AC9); else it is a my-page edit
    const row = await store.getSession(ownerId, a.sessionId);
    if (row && body.in_session === true) {
      const base = { op: 'memory', ownerId, sessionId: a.sessionId, experiment: a.experiment };
      const request = action === 'delete' ? { kind: 'memory_edit', op: 'delete', memoryId }
        : action === 'edit' ? { kind: 'memory_edit', op: 'update', memoryId, patch: body.patch }
        : action === 'resolve_conflict' ? { kind: 'memory_edit', op: 'resolve_conflict', memoryId, accept: body.accept }
        : action === 'sensitivity' ? { kind: 'memory_edit', op: 'sensitivity', accept: body.accept }
        : { kind: 'memory_edit', op: 'accept_suggested', memoryIds: body.memory_ids };
      const prior = publicState(row.session.state);
      const out = await runTurn({ ...base, request });
      const err = out.events.find(e => e.type === 'error');
      if (err) return { __status: statusOfCode(err.code), ...errorBody(err.code) };
      return mainAnswer({ ownerId, sessionId: a.sessionId }, prior, out);
    }
    if (action === 'edit') {
      if (!isObject(body.patch)) throw bad();
      return { memory: publicMemory(await writer.edit(ownerId, memoryId, body.patch)) };
    }
    if (action === 'delete') {
      if (!(await writer.remove(ownerId, memoryId))) throw new HttpError(404, 'not_found');
      return { deleted: true };
    }
    throw bad(); // the conversation-only actions need in_session
  }

  async function route({ method, path, body }) {
    try {
      const clean = (path ?? '').replace(/\/+$/, '') || '/';
      if (clean === '/health' && method === 'GET') return { status: 200, json: { ok: true, catalog: CATALOG_ID, products: products.length } };
      if (clean !== '/api/chat') throw new HttpError(404, 'not_found');
      if (method !== 'POST') throw new HttpError(405, 'method_not_allowed');
      const out = await chat(body);
      const status = out?.__status ?? 200;
      if (out?.__status) delete out.__status;
      return { status, json: out };
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, json: errorBody(e.code) };
      if (e instanceof StoreError || e instanceof MemoryError) return { status: statusOfCode(e.code), json: errorBody(e.code) };
      return { status: 500, json: errorBody('internal') }; // code only: the message could hold user text
    }
  }

  return { route, chat };
}

// ---- http adapter (not covered by socket tests: handlers above are) -------------------------------------------------

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'body_too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve(undefined);
      try { resolve(JSON.parse(text)); } catch { reject(bad('invalid_json')); }
    });
    req.on('error', () => reject(bad()));
  });
}

/**
 * node:http request listener: JSON in, JSON out (no streaming, P9). `origin`: Access-Control-Allow-Origin value ('*' by
 * default: a local experiment server, bound to 127.0.0.1 unless HOST says otherwise; there is no authentication, K7).
 */
export function createListener(handlers, { origin = '*', maxBody = MAX_BODY_BYTES } = {}) {
  return async (req, res) => {
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type', 'cache-control': 'no-store' };
    const json = (status, data) => { res.writeHead(status, { ...cors, 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    try {
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
      const url = new URL(req.url ?? '/', 'http://local');
      const body = req.method === 'POST' ? await readBody(req, maxBody) : undefined;
      const out = await handlers.route({ method: req.method ?? 'GET', path: url.pathname, body });
      json(out.status, out.json);
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, errorBody(e.code));
      json(500, errorBody('internal'));
    }
  };
}

/**
 * ① proto llmTurn options from the environment. The provider is the one every role uses (llmProvider, K72):
 *  - openai-compatible (LLM_API_KEY, default): {generate} through the shared client `llm` (the same one the explainer
 *    uses; one is made from env when not given), role 'dialogue'. LLM_BASE_URL, LLM_MODEL, LLM_REASONING (off default).
 *  - gemini (LLM_PROVIDER=gemini, or only GEMINI_API_KEY as main's worker, K71): GEMINI_API_KEY, GEMINI_MODEL (L3;
 *    proto's default otherwise), thinkingBudget 0 for latency (AC16), dropped by proto if the model rejects it.
 * DIALOGUE_LLM_TIMEOUT_MS for both (L2; default 18000 as main). No key -> null (main's rules).
 */
export function dialogueLlmFrom(env = process.env, { llm = null } = {}) {
  const provider = llmProvider(env);
  const ms = Number(String(env.DIALOGUE_LLM_TIMEOUT_MS ?? '').trim());
  const timeout = Number.isSafeInteger(ms) && ms > 0 ? { timeoutMs: ms } : {};
  if (provider === 'openai-compatible') {
    const client = llm?.provider === 'openai-compatible' ? llm : createLlm({ env, provider });
    return client ? { generate: opts => client.json({ ...opts, role: 'dialogue' }), ...timeout } : null;
  }
  if (provider !== 'gemini') return null;
  const apiKey = (env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return null;
  return { apiKey, ...((env.GEMINI_MODEL || '').trim() ? { model: env.GEMINI_MODEL.trim() } : {}), ...timeout, thinkingBudget: 0 };
}

/** Starts the server from the environment (npm run dev:server). Keys are read from the environment only. */
export async function main(env = process.env) {
  const [{ createSqliteStore }, { loadCatalog }, { logLlmError }] = await Promise.all([import('../db/store.mjs'), import('../data/load.mjs'), import('../llm/index.mjs')]);
  const store = createSqliteStore({ path: env.PIPELINE_DB_PATH || '.data/pipeline.sqlite' });
  const products = loadCatalog();
  // token/latency per call goes to events: provider, role, model, counts, latency, ok. Never the prompt or the answer.
  const llm = createLlm({ env, onError: logLlmError, onUsage: u => { store.logEvent({ sessionId: null, type: 'llm_usage', payload: { provider: u.provider, role: u.role ?? null, model: u.model ?? null, inputTokens: u.inputTokens ?? null, outputTokens: u.outputTokens ?? null, reasoningTokens: u.reasoningTokens ?? null, latencyMs: u.latencyMs ?? null, ok: u.ok === true } }); } });
  const dialogueLlm = dialogueLlmFrom(env, { llm });
  const pipeline = createPipeline({ store, products, llm, dialogueLlm });
  const server = createServer(createListener(createHandlers({ store, products, pipeline }), { origin: env.CORS_ORIGIN || '*' }));
  const port = Number(env.PORT) || 8787, host = env.HOST || '127.0.0.1';
  await new Promise(resolve => server.listen(port, host, resolve));
  console.log(`b-pipeline server http://${host}:${port} (llm: ${llm ? llm.provider : 'none'}, reasoning: ${env.LLM_REASONING || 'off'}, dialogue: ${dialogueLlm ? 'llm' : 'rules'}, products: ${products.length})`);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.code || 'server_failed'); process.exit(1); });
