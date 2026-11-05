// Local experiment server (TRD §10, K7, K53). node:http only, no dependencies.
//  - createHandlers({store, products, pipeline}) holds all routing, validation and mapping. Tests call it directly
//    (no socket, no network); the http adapter below only reads the body and writes JSON or SSE.
//  - POST /chat streams the pipeline events as SSE the moment they happen (cards always before explanations, AC3).
//  - Participant IDs replace accounts (K7): every read and write is scoped by ownerId in the store.
//  - Nothing the user typed is logged. Errors are answered with a code only.
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createPipeline, EXPERIMENTS } from '../pipeline/index.mjs';
import { createMemoryWriter } from '../memory/write.mjs';
import { keyLabel, MemoryError } from '../memory/keys.mjs';
import { StoreError } from '../db/contract.mjs';

export const MAX_BODY_BYTES = 16 * 1024;
const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const FEEDBACK_ACTIONS = ['chosen', 'dismissed', 'purchased', 'satisfaction'];
const STATUS = { invalid_request: 400, invalid_store_input: 400, forbidden_event_field: 400, not_found: 404, version_conflict: 409, session_exists: 409, allergy_cannot_decrease: 409, not_editable: 400, unknown_key: 400 };

/** Thrown for shape errors before anything runs. Carries only a code. */
export class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const bad = (code = 'invalid_request') => new HttpError(400, code);
const safeDecode = s => { try { return decodeURIComponent(s); } catch { throw new HttpError(400, 'invalid_request'); } };
const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);

const idOf = (x, code = 'invalid_request') => { if (typeof x !== 'string' || !ID.test(x)) throw bad(code); return x; };
const ownerOf = x => idOf(x, 'invalid_owner');

function statusOf(e) {
  if (e instanceof HttpError) return e.status;
  if (e instanceof StoreError || e instanceof MemoryError) return STATUS[e.code] ?? 400;
  return 500;
}

const publicRecipient = r => ({ id: r.id, name: r.name, aliases: r.aliases, groupName: r.groupName, budgetCapKrw: r.budgetCapKrw, priceSensitivity: r.priceSensitivity });
const publicMemory = m => ({ id: m.id, key: m.key, label: keyLabel(m.key), polarity: m.polarity, strength: m.strength, status: m.status, source: m.source, evidence: m.evidence });

/**
 * @param {{store:object, products:object[], pipeline?:object, now?:()=>string}} deps
 * @returns {{route:(req:{method:string,path:string,query?:object,body?:any})=>Promise<{status:number, json:any}>,
 *            chat:(body:any, onEvent:(e:object)=>void)=>Promise<{events:object[]}>}}
 */
export function createHandlers({ store, products, pipeline = createPipeline({ store, products }), now }) {
  const writer = createMemoryWriter({ store });

  /** Validates the POST /chat body. Returns the arguments of runPipelineTurn. */
  function chatArgs(body) {
    if (!isObject(body)) throw bad();
    const { ownerId, sessionId, recipientId, request, experiment } = body;
    if (!isObject(request) || typeof request.kind !== 'string') throw bad();
    if (experiment !== undefined && !EXPERIMENTS.includes(experiment)) throw bad();
    return {
      ownerId: ownerOf(ownerId), sessionId: idOf(sessionId),
      ...(recipientId !== undefined ? { recipientId: idOf(recipientId) } : {}),
      request, ...(experiment !== undefined ? { experiment } : {}),
    };
  }

  async function turn(args, onEvent) {
    try { return await pipeline.runPipelineTurn({ ...args, emit: onEvent }); }
    catch { // an unexpected failure never leaks its message (it could contain user text): code only
      const e = { type: 'error', code: 'internal' };
      onEvent?.(e);
      return { events: [e] };
    }
  }

  /** The conditions the app shows in its header and edits with chips (no quantity/scope internals). Display only. */
  const conditionsOf = state => ({
    recipients: state.recipients, occasion: state.occasion, budget: { amount_krw: state.budget.amount_krw, shipping_included: state.budget.shipping_included },
    preferences: state.preferences, excluded_categories: state.excluded_categories, excluded_ingredients: state.excluded_ingredients,
    brand: state.brand, delivery_by: state.delivery_by, packaging: state.packaging,
  });

  /**
   * SSE source: validates first (HttpError before any byte is streamed), then streams every event as it happens.
   * K53: right after the first question | cards | comparison a server-level `conditions` event follows (saved state of the
   * session, display fields only), so the app can show its header without another request. Output order is serialized.
   */
  async function chat(body, onEvent) {
    const args = chatArgs(body);
    let out = Promise.resolve(), sentConditions = false;
    const queue = fn => { out = out.then(fn).catch(() => {}); };
    const full = id => products.find(p => p.id === id) ?? null;
    const emit = e => {
      // the compare tray needs the product itself (K50): the pipeline event carries ids only
      queue(() => onEvent?.(e.type === 'compare_add' ? { ...e, product: full(e.productId) } : e));
      if (!sentConditions && ['question', 'cards', 'comparison'].includes(e.type)) {
        sentConditions = true;
        queue(async () => {
          const row = await store.getSession(args.ownerId, args.sessionId);
          // `products`: the engine products behind the cards, so the app never needs its own catalog in this mode
          if (row) onEvent?.({ type: 'conditions', version: row.session.version, conditions: conditionsOf(row.session.state), products: (e.result?.cards ?? []).map(c => full(c.id)).filter(Boolean) });
        });
      }
    };
    const result = await turn(args, emit);
    await out;
    return result;
  }

  async function memoryOf(ownerId, recipientId) {
    const recipient = await store.getRecipient(ownerId, recipientId);
    if (!recipient) throw new HttpError(404, 'not_found');
    return {
      recipient: publicRecipient(recipient),
      memories: (await store.listMemories(ownerId, recipientId)).map(publicMemory),
      gifts: (await store.listGifts(ownerId, recipientId)).map(g => ({ id: g.id, productId: g.productId, productName: products.find(p => p.id === g.productId)?.name ?? null, occasion: g.occasion, givenAt: g.givenAt, satisfaction: g.satisfaction })),
    };
  }

  const routes = {
    'GET /health': async () => ({ ok: true }),
    'GET /recipients': async ({ query }) => ({ recipients: (await store.listRecipients(ownerOf(query.ownerId))).map(publicRecipient) }),
    async 'GET /memory/:id'({ query, params }) { return memoryOf(ownerOf(query.ownerId), idOf(params.id)); },
    // my page: only evidence / strength change (allergy: evidence only). Real delete below.
    async 'PUT /memory/:id'({ body, params }) {
      if (!isObject(body) || !isObject(body.patch)) throw bad();
      const m = await writer.edit(ownerOf(body.ownerId), idOf(params.id), body.patch);
      return { memory: publicMemory(m) };
    },
    async 'DELETE /memory/:id'({ query, body, params }) {
      const ownerId = ownerOf(query.ownerId ?? body?.ownerId);
      if (!(await writer.remove(ownerId, idOf(params.id)))) throw new HttpError(404, 'not_found');
      return { deleted: true };
    },
    // "다음에도 기억할까요?" answer (K53): candidates are never taken from the client, they live in the saved session (K26)
    async 'POST /memory/confirm'({ body }) {
      if (!isObject(body) || typeof body.accept !== 'boolean') throw bad();
      const args = chatArgs({ ownerId: body.ownerId, sessionId: body.sessionId, request: { kind: 'memory_confirm', accept: body.accept, ...(body.indexes !== undefined ? { indexes: body.indexes } : {}) } });
      return turnJson(args);
    },
    async 'POST /feedback'({ body }) {
      if (!isObject(body) || !FEEDBACK_ACTIONS.includes(body.action)) throw bad();
      const { ownerId, sessionId, productId, giftId, scope, satisfaction, action, experiment } = body;
      const request = { kind: 'feedback', action, ...(productId !== undefined ? { productId } : {}), ...(giftId !== undefined ? { giftId } : {}), ...(scope !== undefined ? { scope } : {}), ...(satisfaction !== undefined ? { satisfaction } : {}) };
      return turnJson(chatArgs({ ownerId, sessionId, request, experiment }));
    },
  };

  async function turnJson(args) {
    const { events } = await turn(args);
    const error = events.find(e => e.type === 'error');
    return error ? { __status: STATUS[error.code] ?? (error.code === 'internal' ? 500 : 400), events } : { events };
  }

  /** Matches "GET /memory/abc" against the route table. Unknown method/path -> 404, wrong method -> 405. */
  function match(method, path) {
    const clean = path.replace(/\/+$/, '') || '/';
    for (const key of Object.keys(routes)) {
      const [m, pattern] = key.split(' ');
      const names = [];
      const re = new RegExp(`^${pattern.replace(/:([a-z]+)/g, (_, n) => { names.push(n); return '([^/]+)'; })}$`);
      const hit = re.exec(clean);
      if (hit && m === method) return { handler: routes[key], params: Object.fromEntries(names.map((n, i) => [n, safeDecode(hit[i + 1])])) };
    }
    const other = Object.keys(routes).some(key => new RegExp(`^${key.split(' ')[1].replace(/:([a-z]+)/g, '([^/]+)')}$`).test(clean));
    throw new HttpError(other ? 405 : 404, other ? 'method_not_allowed' : 'not_found');
  }

  async function route({ method, path, query = {}, body }) {
    try {
      const { handler, params } = match(method, path);
      const out = await handler({ query, body, params });
      const status = out?.__status ?? 200;
      if (out?.__status) delete out.__status;
      return { status, json: out };
    } catch (e) {
      if (e instanceof HttpError || e instanceof StoreError || e instanceof MemoryError) return { status: statusOf(e), json: { error: e.code } };
      return { status: 500, json: { error: 'internal' } }; // code only: the message could hold user text
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

const sse = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * node:http request listener. `origin`: Access-Control-Allow-Origin value ('*' by default: a local experiment server,
 * bound to 127.0.0.1 unless HOST says otherwise; there is no authentication, K7).
 */
export function createListener(handlers, { origin = '*', maxBody = MAX_BODY_BYTES } = {}) {
  return async (req, res) => {
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS', 'access-control-allow-headers': 'content-type', 'cache-control': 'no-store' };
    const json = (status, data) => { res.writeHead(status, { ...cors, 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    try {
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
      const url = new URL(req.url ?? '/', 'http://local');
      const query = Object.fromEntries(url.searchParams);
      const body = req.method === 'GET' || req.method === 'DELETE' ? undefined : await readBody(req, maxBody);
      if (req.method === 'POST' && url.pathname === '/chat') {
        let started = false;
        const start = () => { if (!started) { started = true; res.writeHead(200, { ...cors, 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive' }); } };
        const onEvent = e => { start(); res.write(sse(e.type, e)); };
        // validation errors are thrown before the stream starts, so they get a normal JSON status
        await handlers.chat(body, onEvent);
        start();
        res.end();
        return;
      }
      const out = await handlers.route({ method: req.method ?? 'GET', path: url.pathname, query, body });
      json(out.status, out.json);
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.code });
      json(500, { error: 'internal' });
    }
  };
}

/**
 * ① proto llmTurn options from the environment, as main's worker reads them: GEMINI_API_KEY turns it on, GEMINI_MODEL
 * names the model (L3: passed by the caller; proto's default otherwise), DIALOGUE_LLM_TIMEOUT_MS (L2; default 18000 as
 * main). thinkingBudget 0 for latency (AC16), dropped by proto if the model rejects it. No key -> null (main's rules).
 */
export function dialogueLlmFrom(env = process.env) {
  const apiKey = (env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return null;
  const timeoutMs = Number(String(env.DIALOGUE_LLM_TIMEOUT_MS ?? '').trim());
  return { apiKey, ...((env.GEMINI_MODEL || '').trim() ? { model: env.GEMINI_MODEL.trim() } : {}), ...(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 ? { timeoutMs } : {}), thinkingBudget: 0 };
}

/** Starts the server from the environment (npm run dev:server). Keys are read from the environment only. */
export async function main(env = process.env) {
  const [{ createSqliteStore }, { loadCatalog }, { createLlm, logLlmError }] = await Promise.all([import('../db/store.mjs'), import('../data/load.mjs'), import('../llm/index.mjs')]);
  const store = createSqliteStore({ path: env.PIPELINE_DB_PATH || '.data/pipeline.sqlite' });
  const products = loadCatalog();
  // token/latency per call goes to events: provider, role, model, counts, latency, ok. Never the prompt or the answer.
  const llm = createLlm({ env, onError: logLlmError, onUsage: u => { store.logEvent({ sessionId: null, type: 'llm_usage', payload: { provider: u.provider, role: u.role ?? null, model: u.model ?? null, inputTokens: u.inputTokens ?? null, outputTokens: u.outputTokens ?? null, latencyMs: u.latencyMs ?? null, ok: u.ok === true } }); } });
  const pipeline = createPipeline({ store, products, llm, dialogueLlm: dialogueLlmFrom(env) });
  const server = createServer(createListener(createHandlers({ store, products, pipeline }), { origin: env.CORS_ORIGIN || '*' }));
  const port = Number(env.PORT) || 8787, host = env.HOST || '127.0.0.1';
  await new Promise(resolve => server.listen(port, host, resolve));
  console.log(`b-pipeline server http://${host}:${port} (llm: ${llm ? llm.provider : 'none'}, dialogue: ${dialogueLlmFrom(env) ? 'llm' : 'rules'}, products: ${products.length})`);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.code || 'server_failed'); process.exit(1); });
