import { normalizeConditions } from '../lib/condition-compat.mjs';
import { fetchCatalog, toEngineProduct, cachedCatalog, todayKst } from '../lib/catalog.mjs';
import { catalogId, catalogSource, fromWebItem, mergeCatalogs } from '../lib/catalog-source.mjs';
import webCatalog from '../supabase/seed/products-kr.json' with { type: 'json' };
import { validateRequest, validateState, geminiFailure } from '../lib/llm.mjs';
import { fastRuleTurn, singleTurn, finishSingle, engineState, singleQuestion, occasionReply } from '../lib/single-gift.mjs';
import { apply, recommend, APP_RANKING } from '../lib/engine.mjs';
import { budgetAlternatives } from '../lib/counterfactual.mjs';
import { prototypeRouterTurn, RouterInterpretationError } from './router-agent.mjs';
import { prototypeFullChatTurn, FullChatError } from './full-chat-agent.mjs';
import { createAgent as createFeedbackAgent } from '../baseline/agents/full-chat-feedback/index.mjs';
import { resolveLlm } from '../lib/llm-provider.mjs';
import { LANGGRAPH_AGENT, prototypeLangGraphTurn, readAdvisorContext } from './langgraph-agent.mjs';
import { parseConditions } from '../baseline/agents/a-router/parser.mjs';

const selectableAgents = ['a-router', LANGGRAPH_AGENT, 'full-chat', 'full-chat-feedback-2'];

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
function explicitGiftPatch(text, state, shoppingText) {
  const occasion = occasionReply(text);
  if (occasion) return { occasion };
  const shopping = shoppingText?.(text);
  if (!shopping && !/(?:명절|설날|추석|한가위)(?:에)?\s*(?:(?:드릴|줄|드리는|주는)\s+)?선물/.test(text)) return null;
  const parsed = parseConditions(shopping ?? text, engineState(state));
  const patch = parsed.patch;
  if (parsed.unresolved || parsed.questions.length || parsed.limitations?.length || patch.quantity !== undefined ||
      patch.same_product !== undefined || patch.budget?.scope !== undefined) return null;
  if (!patch.occasion && !patch.brand) return null;
  return patch;
}
function inputOf(raw, shoppingText) {
  try {
    if (!raw || !['turn', 'conditions', 'view'].includes(raw.operation)) throw Error();
    const session = { ...raw.session, state: normalizeConditions(raw.session?.state).state };
    validateState(session.state);
    if (!Array.isArray(session.issues) || session.issues.length > 12 || session.issues.some(q => typeof q !== 'string' || q.length > 400)) throw Error();
    let occasionText;
    if (raw.operation === 'turn') {
      const turn = validateRequest({ ...session, text: raw.text, history: raw.history, source: raw.source });
      const patch = explicitGiftPatch(turn.text, session.state, shoppingText);
      if (!patch || (session.issues.length && patch.excluded_ingredients)) return { ...turn, operation: 'turn' };
      occasionText = patch.occasion ? turn.text : undefined;
      raw = { operation: 'conditions', patch, clearIssues: false };
    }
    if (raw.operation === 'conditions') {
      if (!raw.patch || typeof raw.patch !== 'object' || Array.isArray(raw.patch) || Object.keys(raw.patch).some(key => !Object.hasOwn(session.state, key))) throw Error();
      if (raw.patch.budget !== undefined && (!raw.patch.budget || Array.isArray(raw.patch.budget) || typeof raw.patch.budget !== 'object' || Object.keys(raw.patch.budget).some(key => !['amount_krw', 'shipping_included'].includes(key)))) throw Error();
      const patch = normalizeConditions(apply(session.state, raw.patch)).state;
      validateState(patch);
      const routerPatch = Object.fromEntries(Object.keys(raw.patch).map(key => [key, key === 'budget' ? Object.fromEntries(Object.keys(raw.patch.budget).map(k => [k, patch.budget[k]])) : patch[key]]));
      raw = { ...raw, patch, routerPatch };
      if (raw.clearIssues !== undefined && typeof raw.clearIssues !== 'boolean') throw Error();
    }
    return { ...raw, session, state: session.state, issues: session.issues, occasionText };
  } catch { throw new ApiError(400, 'invalid_request', '입력 형식을 확인해주세요.'); }
}
// Rows are cached per isolate for 10 minutes; demo arrival dates are recomputed per request day.
// CATALOG_SOURCE=amazon (default) | web | both picks the product list every chat mode receives.
function defaultCatalog(fetcher) {
  let rows = null;
  return async env => {
    const source = catalogSource(env.CATALOG_SOURCE);
    const today = todayKst();
    const lists = [];
    if (source !== 'web') {
      rows ??= cachedCatalog(() => fetchCatalog({ url: env.SUPABASE_URL, key: env.SUPABASE_PUBLISHABLE_KEY, fetcher }));
      lists.push((await rows()).map(row => toEngineProduct(row, today)));
    }
    if (source !== 'amazon') lists.push(webCatalog.map(item => fromWebItem(item, today, { imageBase: env.WEB_IMAGE_BASE })));
    return mergeCatalogs(...lists);
  };
}
const catalogLabel = env => { try { return catalogId(env.CATALOG_SOURCE); } catch { return 'invalid'; } };
export function recommendationView(session, products) {
  const state = engineState(session.state);
  return { question: singleQuestion(session), result: recommend(products, state, APP_RANKING), comparison: budgetAlternatives(products, state, APP_RANKING) };
}
export function createApi({ fetcher = fetch, extract, catalog = defaultCatalog(fetcher), flowerAdvice, shoppingText, onDiagnostic } = {}) {
  return {
    async fetch(request, env) {
      const origin = request.headers.get('origin');
      const allowed = (env.APP_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
      const headers = { 'Cache-Control': 'no-store', Vary: 'Origin', 'X-Request-ID': crypto.randomUUID() };
      const json = (body, status = 200) => Response.json(body, { status, headers });
      const diagnose = (code,status,routing) => { try { onDiagnostic?.({event:'recommendation_request_failed',requestId:headers['X-Request-ID'],code,status,...(routing?{routing}:{})}); } catch {} };
      if (origin && !allowed.includes(origin)) return json({ error: '허용되지 않은 요청입니다.', code: 'origin_denied' }, 403);
      if (origin) Object.assign(headers, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' });
      const path = new URL(request.url).pathname;
      if (path === '/health' && request.method === 'GET') {
        let count = null;
        try { count = (await catalog(env)).length; } catch {}
        let llm;
        try { llm = resolveLlm(env, {extract,fetcher}); } catch { return json({ok:false,code:'configuration'},503); }
        const fullChat=['full-chat','full-chat-feedback-1','full-chat-feedback-2'].includes(env.CHAT_AGENT);
        if(fullChat && (llm.provider!=='openai-compatible'||!llm.options.apiKey)) return json({ok:false,agent:'full-chat',code:'configuration'},503);
        const availableAgents=llm.provider==='openai-compatible'&&llm.options.apiKey ? selectableAgents : ['a-router', LANGGRAPH_AGENT];
        return json({ agent: env.CHAT_AGENT || 'legacy', llmMode: fullChat?env.CHAT_AGENT==='full-chat'?'agent-loop':'feedback-loop':env.CHAT_AGENT === LANGGRAPH_AGENT ? 'attribution-graph' : env.A_ROUTER_LLM_MODE || 'single', ok: count !== null, provider: llm.options.apiKey ? llm.provider : 'rules', model: llm.options.model, availableAgents, catalog: catalogLabel(env), products: count ?? 0, ...(env.WEB_IMAGE_BASE ? { webImageBase: env.WEB_IMAGE_BASE } : {}), ...(flowerAdvice ? { flowerSeasons: true } : {}) },count===null?503:200);
      }
      if (path !== '/api/chat') return json({ error: 'API 경로를 확인해주세요.', code: 'not_found' }, 404);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      if (request.method !== 'POST') return json({ error: 'POST 요청이 필요합니다.', code: 'method' }, 405);
      try {
        if (env.CHAT_AGENT && ![...selectableAgents, 'full-chat-feedback-1', 'legacy'].includes(env.CHAT_AGENT)) throw new ApiError(503, 'configuration', '추천 에이전트 설정을 확인해주세요.');
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
        const raw = await readJson(request);
        if (raw?.agentMode !== undefined && !selectableAgents.includes(raw.agentMode)) throw new ApiError(400,'invalid_request','응답 방식을 확인해주세요.');
        const chatAgent = raw?.agentMode ?? env.CHAT_AGENT;
        let llm;
        try { llm = resolveLlm(env, {extract,fetcher}); } catch { throw new ApiError(503,'configuration','LLM 연결 설정을 확인해주세요.'); }
        const fullChat=['full-chat','full-chat-feedback-1','full-chat-feedback-2'].includes(chatAgent);
        if (fullChat && (llm.provider!=='openai-compatible'||!llm.options.apiKey)) throw new ApiError(503,'configuration','전체 채팅 Agent는 서버의 OpenAI 호환 LLM 설정과 키가 필요합니다.');
        if (chatAgent === 'a-router' && env.A_ROUTER_LLM_MODE && !['single','subagents'].includes(env.A_ROUTER_LLM_MODE)) throw new ApiError(503,'configuration','서브 에이전트 모드 설정을 확인해주세요.');
        if (chatAgent === 'a-router' && env.A_ROUTER_LLM_MODE === 'subagents' && llm.provider !== 'openai-compatible') throw new ApiError(503,'configuration','서브 에이전트 모드는 OpenAI 호환 공급자를 사용해주세요.');
        const input = inputOf(raw, shoppingText);
        let advisorContext;
        if (chatAgent === LANGGRAPH_AGENT) {
          try { advisorContext = readAdvisorContext(raw.agents); }
          catch { throw new ApiError(400, 'invalid_request', '자문에 사용할 조건을 확인해주세요.'); }
        }
        const flowerTurn = input.operation === 'turn' ? flowerAdvice?.(input) : null;
        if (flowerTurn) {
          const { question, message } = flowerTurn;
          const view = {
            question,
            result: { status: 'reference', items: [], message, notice: null },
            comparison: { status: 'no_alternative', alternatives: [], message: '' },
          };
          return json({ ...flowerTurn, view, changes: [], mode: 'rules', agent: chatAgent || 'legacy', llmProvider: null, llmModel: null, catalog: catalogLabel(env) });
        }
        let products;
        try { products = await catalog(env); } catch { throw new ApiError(503, 'catalog_unavailable', '상품 정보를 불러오지 못했어요. 잠시 후 다시 시도해주세요.'); }
        let turn, mode = 'rules';
        if (advisorContext) {
          turn = await prototypeLangGraphTurn(input, products, { env, fetcher, signal: request.signal, advisorContext });
          mode = turn.mode;
        } else if (fullChat) {
          const feedback=chatAgent!=='full-chat';
          turn = await prototypeFullChatTurn(input,products,{env,fetcher,signal:request.signal,...(feedback?{agentFactory:createFeedbackAgent,maxReviews:Number(chatAgent.slice(-1))}:{})});
          mode = turn.mode;
        } else if (chatAgent === 'a-router') {
          turn = await prototypeRouterTurn(input, products, { extract: llm.extract, ...llm.options, llmMode: env.A_ROUTER_LLM_MODE || 'single', signal: request.signal });
          mode = turn.mode;
        } else if (input.operation === 'view') turn = finishSingle(input.state, input.state, input.issues, products);
        else if (input.operation === 'conditions') turn = finishSingle(input.state, apply(input.state, input.patch), input.clearIssues === false ? input.issues : [], products);
        else {
          turn = fastRuleTurn(input, products);
          if (turn) mode = 'rules_fast';
          else if (llm.options.apiKey) {
            try { turn = await llm.extract(input, products, llm.options); mode = 'llm'; }
            catch (error) { const failure = geminiFailure(error); diagnose(failure.code,503); return json({ error: failure.error, code: failure.code }, 503); }
          } else turn = singleTurn({ state: input.state, issues: input.issues }, input.text, products);
        }
        if (input.occasionText && input.routerPatch?.occasion === '명절' && turn.session.state.occasion === '명절') {
          turn = { ...turn, message: `선물하는 날을 명절로 설정했어요.\n${turn.message}` };
        }
        const usedModel = mode === 'llm' || mode === 'agents' && turn.routing.llmCalls > 0;
        return json({ ...turn, view: turn.view ?? recommendationView(turn.session, products), mode, llmProvider: usedModel ? llm.provider : null, llmModel: usedModel ? llm.options.model : null, catalog: catalogLabel(env) });
      } catch (error) {
        if (error instanceof FullChatError) { const code=error.code==='configuration'?'configuration':'agent_unavailable';diagnose(code,503,error.routing);return json({error:'전체 채팅 Agent가 요청을 완료하지 못했어요. 조건은 바뀌지 않았어요. 다시 시도해주세요.',code,routing:error.routing},503); }
        if (error instanceof RouterInterpretationError) { diagnose('interpretation_unavailable',503,error.routing); return json({error:'조건 해석 서비스에 연결하지 못했어요. 조건은 바뀌지 않았어요. 다시 시도해주세요.',code:'interpretation_unavailable',routing:error.routing},503); }
        if (error?.code === 'ERR_MODULE_NOT_FOUND') { diagnose('agent_unavailable',503); return json({error:'LangGraph 의존성을 설치해주세요. 저장소 루트에서 npm run setup을 실행하세요.',code:'agent_unavailable'},503); }
        if (error instanceof ApiError) { if(error.status>=500)diagnose(error.code,error.status); if (error.status === 429) headers['Retry-After'] = '60'; return json({ error: error.message, code: error.code }, error.status); }
        diagnose(['invalid_input','invalid_interpretation','version_conflict'].includes(error?.code)?error.code:'unavailable',503);
        // Keep tokens, input and upstream response bodies out of logs and errors.
        return json({ error: '서버 응답을 처리하지 못했어요. 다시 시도해주세요.', code: 'unavailable' }, 503);
      }
    },
  };
}
export default createApi();
