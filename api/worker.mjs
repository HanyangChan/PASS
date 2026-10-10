import products from '../lib/products.json' with { type: 'json' };
import { validateRequest, validateState, llmTurn, geminiFailure } from '../lib/llm.mjs';
import { fastRuleTurn, singleTurn, finishSingle, engineState, singleQuestion } from '../lib/single-gift.mjs';
import { apply, recommend } from '../lib/engine.mjs';
import { budgetAlternatives } from '../lib/counterfactual.mjs';

class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
async function readJson(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '')) throw new ApiError(415, 'content_type', 'JSON 요청이 필요합니다.');
  if (Number(request.headers.get('content-length')) > 32768) throw new ApiError(413, 'too_large', '입력이 너무 깁니다.');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'invalid_request', '요청 내용이 없습니다.');
  const chunks = []; let size = 0, timeout;
  try {
    const deadline = new Promise((_, reject) => { timeout = setTimeout(() => reject(new ApiError(408, 'body_timeout', '요청 시간이 초과되었습니다.')), 5000); });
    while (true) {
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > 32768) throw new ApiError(413, 'too_large', '입력이 너무 깁니다.');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new ApiError(400, 'invalid_request', '입력 형식을 확인해주세요.'); }
  } finally { clearTimeout(timeout); void reader.cancel().catch(() => {}); }
}
function inputOf(raw) {
  try {
    if (!raw || !['turn', 'conditions', 'view'].includes(raw.operation)) throw Error();
    const session = raw.session;
    validateState(session.state);
    if (!Array.isArray(session.issues) || session.issues.length > 12 || session.issues.some(q => typeof q !== 'string' || q.length > 400)) throw Error();
    if (raw.operation === 'turn') return { ...validateRequest({ ...session, text: raw.text, history: raw.history, source: raw.source }), operation: 'turn' };
    if (raw.operation === 'conditions') {
      if (!raw.patch || typeof raw.patch !== 'object' || Array.isArray(raw.patch) || Object.keys(raw.patch).some(key => !Object.hasOwn(session.state, key))) throw Error();
      if (raw.patch.budget !== undefined && (!raw.patch.budget || Array.isArray(raw.patch.budget) || typeof raw.patch.budget !== 'object' || Object.keys(raw.patch.budget).some(key => !['amount_krw', 'shipping_included'].includes(key)))) throw Error();
      validateState(apply(session.state, raw.patch));
      if (raw.clearIssues !== undefined && typeof raw.clearIssues !== 'boolean') throw Error();
    }
    return { ...raw, state: session.state, issues: session.issues };
  } catch { throw new ApiError(400, 'invalid_request', '입력 형식을 확인해주세요.'); }
}
export function recommendationView(session) {
  const state = engineState(session.state);
  return { question: singleQuestion(session), result: recommend(products, state), comparison: budgetAlternatives(products, state) };
}
export function createApi({ fetcher = fetch, extract = llmTurn } = {}) {
  return {
    async fetch(request, env) {
      const origin = request.headers.get('origin');
      const allowed = (env.APP_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
      const headers = { 'Cache-Control': 'no-store', Vary: 'Origin', 'X-Request-ID': crypto.randomUUID() };
      const json = (body, status = 200) => Response.json(body, { status, headers });
      if (origin && !allowed.includes(origin)) return json({ error: '허용되지 않은 요청입니다.', code: 'origin_denied' }, 403);
      if (origin) Object.assign(headers, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' });
      const path = new URL(request.url).pathname;
      if (path === '/health' && request.method === 'GET') return json({ ok: true, provider: env.GEMINI_API_KEY ? 'gemini' : 'rules', catalog: 'food-demo-v1' });
      if (path !== '/api/chat') return json({ error: 'API 경로를 확인해주세요.', code: 'not_found' }, 404);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      if (request.method !== 'POST') return json({ error: 'POST 요청이 필요합니다.', code: 'method' }, 405);
      try {
        if (!env.IP_LIMITER || !env.USER_LIMITER || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_') || new URL(env.SUPABASE_URL).protocol !== 'https:') throw new ApiError(503, 'configuration', '서버 연결 설정이 필요합니다.');
        // Never use a client-supplied owner ID or decoded-but-unverified JWT claims.
        const ip = request.headers.get('CF-Connecting-IP') ?? 'native-local';
        if (!(await env.IP_LIMITER.limit({ key: ip })).success) throw new ApiError(429, 'rate_limit', '요청이 너무 많아요. 잠시 후 다시 시도해주세요.');
        const authorization = request.headers.get('authorization');
        if (!/^Bearer [A-Za-z0-9_.-]+$/.test(authorization ?? '')) throw new ApiError(401, 'unauthorized', '다시 로그인해주세요.');
        let auth;
        try { auth = await fetcher(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: authorization }, signal: AbortSignal.timeout(5000) }); }
        catch { throw new ApiError(503, 'auth_unavailable', '로그인 확인에 실패했어요. 잠시 후 다시 시도해주세요.'); }
        if (!auth.ok) {
          if ([401, 403].includes(auth.status)) throw new ApiError(401, 'unauthorized', '다시 로그인해주세요.');
          throw new ApiError(503, 'auth_unavailable', '로그인 확인에 실패했어요.');
        }
        const user = await auth.json();
        if (!user.id || user.role !== 'authenticated') throw new ApiError(401, 'unauthorized', '다시 로그인해주세요.');
        if (!(await env.USER_LIMITER.limit({ key: user.id })).success) throw new ApiError(429, 'rate_limit', '요청이 너무 많아요. 잠시 후 다시 시도해주세요.');
        const input = inputOf(await readJson(request));
        let turn, mode = 'rules';
        if (input.operation === 'view') turn = finishSingle(input.state, input.state, input.issues, products);
        else if (input.operation === 'conditions') turn = finishSingle(input.state, apply(input.state, input.patch), input.clearIssues === false ? input.issues : [], products);
        else {
          turn = fastRuleTurn(input, products);
          if (turn) mode = 'rules_fast';
          else if (env.GEMINI_API_KEY) {
            try { turn = await extract(input, products, { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || 'gemini-3.6-flash', fetcher }); mode = 'llm'; }
            catch (error) { const failure = geminiFailure(error); return json({ error: failure.error, code: failure.code }, 503); }
          } else turn = singleTurn({ state: input.state, issues: input.issues }, input.text, products);
        }
        return json({ ...turn, view: recommendationView(turn.session), mode, catalog: 'food-demo-v1' });
      } catch (error) {
        if (error instanceof ApiError) { if (error.status === 429) headers['Retry-After'] = '60'; return json({ error: error.message, code: error.code }, error.status); }
        // Keep tokens, input and upstream response bodies out of logs and errors.
        return json({ error: '서버 응답을 처리하지 못했어요. 다시 시도해주세요.', code: 'unavailable' }, 503);
      }
    },
  };
}
export default createApi();
