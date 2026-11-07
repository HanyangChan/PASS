// b-pipeline mode of the app (P10, PROTO-REBASE §4 A2~A4). On when EXPO_PUBLIC_PIPELINE_URL is set; the experiment condition is a hidden
// build setting (EXPO_PUBLIC_PIPELINE_EXPERIMENT=A|B), never shown. The screens keep talking to a `serverChat` like main's: this hook hands
// them one (the pipeline client's `chat`) and keeps the extra view (banner, tags, chips, prompts) the extra UI draws. The logic lives in
// services/pipelineEvents.mjs (tested against the real server handlers).
import { useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { createServerChatService, resolveChatUrl } from './services/serverChatService';
import { createPipelineClient, emptyPipeline, participantAuth, validParticipantId } from './services/pipelineEvents.mjs';
import type { Gift } from './domain';

const participantKey = 'pass.pipeline.participant.v1';
let configError = '';
const endpoint = (() => {
  try { return resolveChatUrl(process.env.EXPO_PUBLIC_PIPELINE_URL, true); }
  catch (error) { configError = (error as Error).message; return null; }
})();
const enabled = !!process.env.EXPO_PUBLIC_PIPELINE_URL;
const experiment: 'A' | 'B' = process.env.EXPO_PUBLIC_PIPELINE_EXPERIMENT === 'A' ? 'A' : 'B';

/* eslint-disable @typescript-eslint/no-explicit-any */
const wait = async (): Promise<never> => { throw new Error('참가자 ID를 먼저 입력해주세요.'); };
const blocked: any = { send: wait, updateConditions: wait, view: wait };
export type PipelineView = any; // the shape is emptyPipeline() in services/pipelineEvents.mjs
export type PipelineRequest =
  | { kind: 'patch'; patch: any; sensitivity?: 'value' | 'balanced' | 'quality'; recipientChoice?: string; confirmedReleases?: string[] }
  | { kind: 'ladder_pick'; direction: 'down' }
  | { kind: 'ladder_compare'; productId: string }
  | { kind: 'feedback'; action: 'chosen' | 'dismissed' | 'purchased' | 'satisfaction'; productId?: string; giftId?: string; scope?: 'product' | 'category'; satisfaction?: number }
  | { kind: 'memory_edit'; op: 'delete' | 'update' | 'resolve_conflict' | 'accept_suggested' | 'sensitivity'; memoryId?: string; memoryIds?: string[]; accept?: boolean; patch?: object }
  | { kind: 'memory_confirm'; accept: boolean; indexes?: number[] }
  | { kind: 'end_session' };

/**
 * @param apply   shows a full answer in the screens (App sets session + recommendation)
 * @param fail    shows an error line
 * @param saved   the 찜 list (null until restored): a newly added gift is told to the server as `chosen` (suggested memories)
 */
export function usePipeline(apply: (turn: any) => void, fail: (message: string) => void, saved: Gift[] | null) {
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(!enabled);
  const [view, setView] = useState<PipelineView>(emptyPipeline());
  const handlers = useRef({ apply, fail });
  handlers.current = { apply, fail };
  const ending = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!enabled) return;
    AsyncStorage.getItem(participantKey).then(v => { if (v && validParticipantId(v)) setParticipantId(v); }).catch(() => {}).finally(() => setLoaded(true));
  }, []);
  const client = useMemo(() => {
    if (!endpoint || !participantId) return null;
    return createPipelineClient({
      makeBase: (fields: () => object) => createServerChatService(endpoint, participantAuth(participantId), participantId, fetch, () => ({ participant_id: participantId, ...fields() })),
      experiment, newId: randomUUID, onTurn: (turn: any) => handlers.current.apply(turn), onView: setView,
    } as any);
  }, [participantId]);
  useEffect(() => { setView(emptyPipeline()); ending.current = null; }, [client]);

  const previous = useRef<string[] | null>(null);
  useEffect(() => {
    if (!saved) return;
    const ids = saved.map(g => g.id);
    if (previous.current && client) for (const id of ids) if (!previous.current.includes(id)) void client.feedback('chosen', id);
    previous.current = ids;
  }, [saved, client]);

  const need = () => { if (!client) throw new Error('참가자 ID를 먼저 입력해주세요.'); return client; };
  const finish = () => { const clear = ending.current; ending.current = null; client?.reset(); clear?.(); };
  return {
    enabled,
    needsId: enabled && loaded && !participantId,
    configError,
    view,
    // before the participant id is known the app must not fall back to the on-device recommender (device memory is off in this mode)
    chat: client?.chat ?? (enabled ? blocked : null),
    setParticipant: (id: string) => { if (!validParticipantId(id)) return; setParticipantId(id); AsyncStorage.setItem(participantKey, id).catch(() => {}); },
    /** A request of the extra UI (chips, prompts). Errors show as the chat error line. */
    act: (request: PipelineRequest) => {
      if (!client) return;
      void client.act(request).then(() => { if (ending.current && request.kind === 'memory_confirm') finish(); }).catch((e: Error) => fail(e.message));
    },
    feedback: (action: 'chosen' | 'purchased', productId: string) => { void client?.feedback(action, productId); },
    /** "새 대화": ends the server session first so "다음에도 기억할까요?" can be asked; the screen clears once that is answered (or if nothing is asked). */
    end: (clear: () => void) => {
      if (!client || client.view.version === null) { client?.reset(); clear(); return; }
      ending.current = clear;
      client.end().then(() => { if (!client.view.prompts.some((p: { kind: string }) => p.kind === 'remember')) finish(); }).catch((e: Error) => { ending.current = null; fail(e.message); });
    },
    memory: {
      people: (): Promise<{ recipients: any[] }> => need().memory.people(),
      of: (id: string): Promise<{ memories: any[] }> => need().memory.of(id),
      remove: (id: string) => need().memory.remove(id),
    },
  };
}
