import { validateState } from '../../../lib/llm.mjs';
import type { ChatSession, ChatMessage, ConditionPatch } from '../domain';
import type { createLocalChatService } from './chatService';
import type { ChatAgentMode } from '../chatAgentModes';
import type { AgentPayload } from '../AgentPanel';
import type { recipientCalendar } from './personalization';
type AdvisorContext = { disabled: string[]; calendar: ReturnType<typeof recipientCalendar> };
type View = ReturnType<ReturnType<typeof createLocalChatService>['view']>;
type Auth = { getSession(): Promise<{ data: { session: { access_token: string; user: { id: string } } | null }; error: unknown }> };
export function resolveChatUrl(value?: string) {
  if (!value) return null;
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new Error('추천 API에는 서버 기본 주소를 설정해주세요.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('추천 API는 HTTPS 주소여야 합니다.');
  return `${url.origin}/api/chat`;
}
export function createServerChatService(endpoint: string, auth: Auth, owner: string, fetcher: typeof fetch = fetch) {
  async function request(body: object, signal?: AbortSignal, agentMode?: ChatAgentMode, agents?: AdvisorContext) {
    const { data, error } = await auth.getSession();
    if (error || data.session?.user.id !== owner) throw new Error('다시 로그인해주세요.');
    const controller = new AbortController(); let timedOut = false;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 25000);
    try {
      const context = agentMode === 'langgraph-advisors' && agents ? { agents: { disabled: agents.disabled, calendar: agents.calendar } } : {};
      const response = await fetcher(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify({ ...body, agentMode, ...context }), signal: controller.signal });
      if (!response.ok) {
        const failure = await response.json().catch(() => null);
        const failures: Record<string, string> = {
          interpretation_unavailable: 'AI가 조건 해석을 완료하지 못했어요. 입력은 보관했으니 다시 시도해주세요.',
          agent_unavailable: 'AI가 요청을 완료하지 못했어요. 입력은 보관했으니 다시 시도해주세요.',
          catalog_unavailable: '상품 정보를 불러오지 못했어요. 잠시 후 다시 시도해주세요.',
          auth_unavailable: '로그인 확인에 실패했어요. 잠시 후 다시 시도해주세요.',
          configuration: '추천 서버의 AI 연결 설정을 확인해야 합니다.',
        };
        const messages: Record<number, string> = { 400: '입력 조건을 확인해주세요.', 401: '다시 로그인해주세요.', 403: '앱의 서버 연결 설정을 확인해주세요.', 413: '입력이 너무 길어요.', 429: '요청이 너무 많아요. 잠시 후 다시 시도해주세요.', 503: '추천 서버에 연결하지 못했어요. 잠시 후 다시 시도해주세요.' };
        throw new Error(response.status === 503 && typeof failure?.code === 'string' && Object.hasOwn(failures, failure.code) ? failures[failure.code] : messages[response.status] ?? '추천 요청에 실패했어요.');
      }
      const turn = await response.json();
      if (agentMode && turn.agent !== agentMode) throw new Error('선택한 응답 방식을 적용하지 못했어요. 다시 시도해주세요.');
      try { validateState(turn.session?.state); } catch { throw new Error('추천 서버 응답 형식을 확인해주세요.'); }
      if (!Array.isArray(turn.session.issues) || turn.session.issues.some((v: unknown) => typeof v !== 'string') || typeof turn.message !== 'string' ||
        !['rules', 'rules_fast', 'llm', 'agents'].includes(turn.mode) ||
        (turn.mode === 'agents' && (!turn.agents || !['attribution', 'opinions', 'suggestions', 'memoryProposals', 'autoApplied'].every(key => Array.isArray(turn.agents[key])))) || !turn.view || !Array.isArray(turn.view.result?.items) ||
        !Array.isArray(turn.view.comparison?.alternatives) || !Array.isArray(turn.view.question?.choices) ||
        typeof turn.view.question?.text !== 'string' || typeof turn.view.result?.message !== 'string' ||
        turn.view.result.items.some((p: { id: unknown; name: unknown; total: unknown }) => typeof p.id !== 'string' || typeof p.name !== 'string' || !Number.isFinite(p.total))) throw new Error('추천 서버 응답 형식을 확인해주세요.');
      const latest = await auth.getSession();
      if (latest.data.session?.user.id !== owner || controller.signal.aborted) throw new Error('계정이 변경되거나 요청이 취소되었어요.');
      return turn as { session: ChatSession; message: string; view: View; mode: 'rules' | 'rules_fast' | 'llm' | 'agents'; agents?: AgentPayload };
    } catch (error) {
      if (timedOut) throw new Error('추천 응답 시간이 초과됐어요. 다시 시도해주세요.');
      if (error instanceof TypeError) throw new Error('추천 서버 연결을 확인해주세요.');
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  return {
    send(session: ChatSession, text: string, history: ChatMessage[], source: 'typed' | 'quick_reply' = 'typed', signal?: AbortSignal, agentMode?: ChatAgentMode, agents?: AdvisorContext) {
      return request({ operation: 'turn', session, text: text.trim(), history: history.slice(-6).map(message => ({ ...message, text: message.text.slice(0, 1200) })), source }, signal, agentMode, agents);
    },
    updateConditions(session: ChatSession, patch: ConditionPatch, clearIssues = true, signal?: AbortSignal, agentMode?: ChatAgentMode, agents?: AdvisorContext) {
      return request({ operation: 'conditions', session, patch, clearIssues }, signal, agentMode, agents);
    },
    view(session: ChatSession, signal?: AbortSignal, agentMode?: ChatAgentMode, agents?: AdvisorContext) { return request({ operation: 'view', session }, signal, agentMode, agents); },
  };
}
