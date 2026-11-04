// b-pipeline mode of the app (TRD §9): the service layer that talks to server/ (SSE). Screens keep their design; this file and
// pipelineEvents.mjs are the only places that know the pipeline's events. Condition A/B is a hidden setting (F5), never shown.
import { createSseParser, reduceEvent, errorText, toBaselinePatch, resolvePipelineUrl, validParticipantId } from './pipelineEvents.mjs';
import type { ConditionPatch } from '../domain';

/** The folded turn (see emptyTurn in pipelineEvents.mjs). Event payloads stay loosely typed: the server is the authority. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type PipelineTurn = {
  version: number | null; question: string | null; cards: any[]; products: any[]; annotations: Record<string, any>; banner: any; notice: string | null;
  hiddenProductIds: string[]; recipientChoices: any[] | null; budgetChips: any[] | null; conditions: any; explanations: any[] | null; emphasize: 'down' | null;
  prompts: any[]; compare: any[]; error: string | null; saved: any; ended: boolean; message?: string; preview?: boolean;
};
export type PipelineRequest =
  | { kind: 'message'; text: string; recipientChoice?: string }
  | { kind: 'patch'; patch: ConditionPatch; sensitivity?: 'value' | 'balanced' | 'quality'; recipientChoice?: string; confirmedReleases?: string[] }
  | { kind: 'view' }
  | { kind: 'what_if_budget'; amount_krw: number }
  | { kind: 'ladder_pick'; direction: 'down' }
  | { kind: 'ladder_compare'; productId: string }
  | { kind: 'feedback'; action: 'chosen' | 'dismissed' | 'purchased' | 'satisfaction'; productId?: string; giftId?: string; scope?: 'product' | 'category'; satisfaction?: number }
  | { kind: 'memory_edit'; op: 'delete' | 'update' | 'resolve_conflict' | 'accept_suggested' | 'sensitivity'; memoryId?: string; memoryIds?: string[]; accept?: boolean; patch?: object }
  | { kind: 'memory_confirm'; accept: boolean; indexes?: number[] }
  | { kind: 'end_session' };

export { resolvePipelineUrl, validParticipantId };

/** XHR (not fetch): response bodies can be read while they arrive on React Native and on the web alike. */
function stream(url: string, body: object, onFrame: (f: { type: string; data: any }) => void, signal?: AbortSignal, timeoutMs = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const parser = createSseParser();
    let seen = 0, done = false;
    const finish = (error?: Error) => { if (done) return; done = true; signal?.removeEventListener('abort', abort); clearTimeout(timer); error ? reject(error) : resolve(); };
    const feed = () => { const text = xhr.responseText; if (text.length > seen) { const chunk = text.slice(seen); seen = text.length; for (const f of parser.feed(chunk)) onFrame(f); } };
    const abort = () => { xhr.abort(); finish(new Error('요청이 취소되었어요.')); };
    const timer = setTimeout(() => { xhr.abort(); finish(new Error('추천 응답 시간이 초과됐어요. 다시 시도해주세요.')); }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onprogress = () => { if (xhr.status === 200) feed(); };
    xhr.onerror = () => finish(new Error('추천 서버 연결을 확인해주세요.'));
    xhr.onload = () => {
      if (xhr.status !== 200) { let code = ''; try { code = JSON.parse(xhr.responseText).error; } catch { /* not JSON */ } return finish(new Error(errorText(code))); }
      feed(); finish();
    };
    xhr.send(JSON.stringify(body));
  });
}

export function createPipelineChatService(baseUrl: string, ownerId: string, experiment?: 'A' | 'B') {
  const origin = resolvePipelineUrl(baseUrl);
  if (!origin) throw new Error('추천 서버 주소가 설정되지 않았어요.');
  if (!validParticipantId(ownerId)) throw new Error('참가자 ID를 확인해주세요.');

  async function json(method: string, path: string, body?: object) {
    const response = await fetch(`${origin}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(errorText(data.error));
    return data;
  }

  return {
    /** Sends one request and folds the streamed events into a turn. onTurn fires after each event (cards first, explanations later). */
    async turn(sessionId: string, request: PipelineRequest, previous: PipelineTurn, onTurn: (t: PipelineTurn) => void, opts: { recipientId?: string; signal?: AbortSignal } = {}): Promise<PipelineTurn> {
      const wire = request.kind === 'patch' ? { ...request, patch: toBaselinePatch(request.patch) } : request;
      let turn: PipelineTurn = { ...previous };
      await stream(`${origin}/chat`, { ownerId, sessionId, request: wire, ...(opts.recipientId ? { recipientId: opts.recipientId } : {}), ...(experiment ? { experiment } : {}) },
        ({ type, data }) => { turn = reduceEvent(turn, { ...data, type }) as PipelineTurn; onTurn(turn); }, opts.signal);
      if (turn.error) throw new Error(errorText(turn.error));
      return turn;
    },
    recipients: () => json('GET', `/recipients?ownerId=${encodeURIComponent(ownerId)}`),
    memory: (recipientId: string) => json('GET', `/memory/${encodeURIComponent(recipientId)}?ownerId=${encodeURIComponent(ownerId)}`),
    editMemory: (id: string, patch: object) => json('PUT', `/memory/${encodeURIComponent(id)}`, { ownerId, patch }),
    deleteMemory: (id: string) => json('DELETE', `/memory/${encodeURIComponent(id)}?ownerId=${encodeURIComponent(ownerId)}`),
  };
}
