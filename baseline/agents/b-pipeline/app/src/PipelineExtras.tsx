// New UI pieces of the b-pipeline mode (TRD §9-4): reason tags, B chips, the "반영 한 줄" with [수정], "기억할까요?" prompts,
// the compare tray and the participant id entry. Colors, fonts and the Chip come from the existing theme/components; nothing
// else in the design changes. Condition A/B is never named on screen (F5): B simply has more fields in the same places.
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors as c, fonts } from './theme';
import { Chip } from './components';
import { wonShort, validParticipantId } from './services/pipelineEvents.mjs';
import { usePassContext } from '../App';
import type { PipelineRequest, PipelineView } from './usePipeline';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Act = (request: PipelineRequest) => void;

/** Tags under a card (template tags at once, the LLM wording replaces them when `explain` arrives) + the gift-history mark. */
export function PipelineTags({ id }: { id: string }) {
  const { pipeline } = usePassContext();
  const tags: string[] = pipeline.view.tags[id] ?? [];
  const gift = pipeline.view.giftHistory[id]?.label;
  if (!tags.length && !gift) return null;
  return (
    <View style={x.tagRow}>
      {gift ? <Text style={[x.tag, x.giftTag]}>{gift}</Text> : null}
      {tags.map((t: string) => <Text key={t} style={x.tag}>{t}</Text>)}
    </View>
  );
}

const PROMPT_ANSWERS = (p: any, conditions: { excluded_ingredients?: string[] }): { label: string; request?: PipelineRequest }[] => {
  switch (p.kind) {
    case 'remember': return [{ label: '기억할게요', request: { kind: 'memory_confirm', accept: true } }, { label: '기억하지 않아요', request: { kind: 'memory_confirm', accept: false } }];
    case 'dismiss_scope': return (p.chips ?? []).map((ch: { label: string; scope: 'product' | 'category' }) => ({ label: ch.label, request: { kind: 'feedback', action: 'dismissed', productId: p.productId, scope: ch.scope } }));
    case 'sensitivity': return [{ label: '네', request: { kind: 'memory_edit', op: 'sensitivity', accept: true } }, { label: '아니요', request: { kind: 'memory_edit', op: 'sensitivity', accept: false } }];
    case 'satisfaction': return [1, 2, 3, 4, 5].map(n => ({ label: `${n}점`, request: { kind: 'feedback', action: 'satisfaction', giftId: p.giftId, satisfaction: n } }));
    case 'suggested': return [{ label: '네', request: { kind: 'memory_edit', op: 'accept_suggested', memoryIds: (p.candidates ?? []).map((m: { memoryId: string }) => m.memoryId) } }, { label: '아니요' }];
    case 'allergy_delete': case 'memory_conflict': return [{ label: '네', request: { kind: 'memory_edit', op: 'resolve_conflict', memoryId: p.memoryId, accept: true } }, { label: '아니요', request: { kind: 'memory_edit', op: 'resolve_conflict', memoryId: p.memoryId, accept: false } }];
    // K19: a session-only allergy leaves only after this confirmation (the conditions minus the asked ingredients)
    case 'allergy_release_session': return [{ label: '해제할게요', request: { kind: 'patch', patch: { excluded_ingredients: (conditions.excluded_ingredients ?? []).filter((v: string) => !(p.ingredients ?? []).includes(v)) }, confirmedReleases: p.ingredients ?? [] } }, { label: '그대로 둘게요' }];
    // K18: a remembered allergy is deleted only on an explicit yes (one memory at a time; several: my page)
    case 'allergy_release': return (p.memoryIds ?? []).length === 1 ? [{ label: '삭제할게요', request: { kind: 'memory_edit', op: 'delete', memoryId: p.memoryIds[0] } }, { label: '그대로 둘게요' }] : [{ label: '닫기' }];
    default: return [{ label: '닫기' }];
  }
};

function Prompt({ p, act, conditions, dismiss }: { p: any; act: Act; conditions: { excluded_ingredients?: string[] }; dismiss: () => void }) {
  const lines: string[] = p.kind === 'remember'
    ? [...(p.candidates ?? []).map((m: { recipientName: string | null; label: string }) => `${m.recipientName ?? ''} ${m.label}`.trim()), ...(p.gifts ?? []).map((g: { productName: string | null }) => g.productName ?? '')].filter(Boolean)
    : [];
  return (
    <View style={x.card}>
      <Text style={x.title}>{p.text}</Text>
      {lines.map((l: string) => <Text key={l} style={x.small}>· {l}</Text>)}
      <View style={x.chips}>
        {PROMPT_ANSWERS(p, conditions).map(a => <Chip key={a.label} label={a.label} onPress={() => { if (a.request) act(a.request); dismiss(); }} />)}
      </View>
    </View>
  );
}

/**
 * Everything under the card row: banner + [수정], prompts, recipient/budget chips, B chips (contrast / counterfactual / price options) and
 * the tray. Rendered the same in A; A's answers simply have no B fields.
 */
export function PipelineExtras() {
  const { pipeline, session, sendChat, chatPending } = usePassContext();
  const v: PipelineView = pipeline.view;
  const act: Act = pipeline.act;
  const [editing, setEditing] = useState(false);
  const [sure, setSure] = useState<string | null>(null);
  const [closed, setClosed] = useState<string[]>([]);
  useEffect(() => setClosed([]), [v.prompts]); // a new answer brings new prompts: the same kind may be asked again
  const down = v.ladder?.find((ch: { direction: string }) => ch.direction === 'down');
  const up = v.ladder?.find((ch: { direction: string }) => ch.direction === 'up');
  const chips = [...(down ? [down] : []), ...(up ? [up] : [])];
  const prompts = v.prompts.filter((p: any, i: number) => !closed.includes(`${p.kind}-${i}`));
  return (
    <View style={x.wrap}>
      {v.banner ? (
        <View style={x.card}>
          <View style={x.rowBetween}>
            <Text style={[x.small, x.flex]}>{v.banner.text}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="반영한 기억 수정" onPress={() => setEditing(e => !e)}><Text style={x.link}>[수정]</Text></Pressable>
          </View>
          {editing && (v.banner.items ?? []).map((m: { memoryId: string; label: string }) => (
            <View key={m.memoryId} style={x.rowBetween}>
              <Text style={x.small}>{m.label}</Text>
              <Chip label={sure === m.memoryId ? '정말 지울까요?' : '기억에서 지우기'} selected={sure === m.memoryId}
                onPress={() => { if (sure !== m.memoryId) { setSure(m.memoryId); return; } setSure(null); setEditing(false); act({ kind: 'memory_edit', op: 'delete', memoryId: m.memoryId }); }} />
            </View>
          ))}
        </View>
      ) : null}
      {v.notice ? <Text style={x.small}>{v.notice}</Text> : null}
      {/* a "두 분 함께 / 어머니만" chip is sent as recipient_choice (this request only, K36); a cap chip as a budget change (R3) */}
      {(v.recipientChoices?.length || v.budgetChips?.length) ? (
        <View style={x.chips}>
          {(v.recipientChoices ?? []).map((ch: { label: string }) => <Chip key={ch.label} label={ch.label} onPress={() => { if (!chatPending) void sendChat(ch.label, 'quick_reply'); }} />)}
          {(v.budgetChips ?? []).map((ch: { label: string; amount_krw: number }) => <Chip key={ch.label} label={ch.label} onPress={() => { if (!chatPending) act({ kind: 'patch', patch: { budget: { amount_krw: ch.amount_krw } } }); }} />)}
        </View>
      ) : null}
      {prompts.map((p: any, i: number) => <Prompt key={`${p.kind}-${i}`} p={p} act={act} conditions={session.state} dismiss={() => setClosed(old => [...old, `${p.kind}-${i}`])} />)}
      {v.contrast ? <Text style={x.fact}>{v.contrast}</Text> : null}
      {v.memoryCf ? <Text style={x.fact}>{v.memoryCf}</Text> : null}
      {chips.length > 0 && (
        <View style={x.chips}>
          {chips.map((ch: any, i: number) => (
            <Chip key={ch.label} label={ch.label} selected={ch.direction === 'down' && v.emphasize === 'down' && i === 0}
              onPress={() => { if (!chatPending) act(ch.direction === 'down' ? { kind: 'ladder_pick', direction: 'down' } : { kind: 'ladder_compare', productId: ch.productId }); }} />
          ))}
        </View>
      )}
      {v.ladderNotice ? <Text style={x.small}>{v.ladderNotice}</Text> : null}
      {v.compare.length > 0 && (
        <View style={x.card}>
          <Text style={x.title}>비교 트레이</Text>
          {v.compare.map((t: { id: string; name: string; price: number; rating: { from: number; to: number } }) => (
            <Text key={t.id} style={x.small}>{t.name} · +{wonShort(t.price)} · 평점 {t.rating.from.toFixed(1)} → {t.rating.to.toFixed(1)}</Text>
          ))}
        </View>
      )}
    </View>
  );
}

/** The server's memory of the people in this conversation (A3: replaces the device-side panel). Delete = really gone, and the next cards drop it (AC9). */
export function PipelineMemoryPanel() {
  const { pipeline, session, chatPending } = usePassContext();
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [memories, setMemories] = useState<Record<string, { id: string; label: string; polarity: number; evidence?: string }[]>>({});
  const [error, setError] = useState('');
  const [sure, setSure] = useState<string | null>(null);
  const names: string[] = session.state.recipients;
  const load = async () => {
    try {
      const { recipients } = await pipeline.memory.people();
      const shown = recipients.filter((r: any) => !names.length || names.some(n => n === r.name || n === r.groupName || (r.aliases ?? []).includes(n)));
      const next: typeof memories = {};
      for (const r of shown) next[r.id] = (await pipeline.memory.of(r.id)).memories;
      setPeople(shown); setMemories(next); setError('');
    } catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { if (open) void load(); }, [open, names.join(), pipeline.view.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = Object.values(memories).reduce((n, list) => n + list.length, 0);
  return (
    <View style={x.card}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(o => !o)}>
        <Text style={x.title}>기억 {open ? '접기' : '관리'}{open ? ` · ${count}개` : ''}</Text>
      </Pressable>
      {open && (
        <>
          <Text style={x.small}>대화에서 "기억할게요"라고 답한 내용만 저장돼요. 지우면 서버에서 완전히 삭제돼요.</Text>
          {!!error && <Text accessibilityRole="alert" style={x.small}>{error}</Text>}
          {!people.length && !error && <Text style={x.small}>저장된 기억이 없어요.</Text>}
          {people.map(r => (
            <View key={r.id} style={x.card}>
              <Text style={x.title}>{r.name}</Text>
              {(memories[r.id] ?? []).length === 0 && <Text style={x.small}>저장된 기억이 없어요.</Text>}
              {(memories[r.id] ?? []).map(m => (
                <View key={m.id} style={x.rowBetween}>
                  <Text style={[x.small, x.flex]}>{m.polarity < 0 ? '피함' : '좋아함'} · {m.label}{m.evidence ? ` (${m.evidence})` : ''}</Text>
                  <Chip label={sure === m.id ? '정말 지울까요?' : '삭제'} selected={sure === m.id}
                    onPress={() => {
                      if (chatPending) return;
                      if (sure !== m.id) { setSure(m.id); return; }
                      setSure(null);
                      pipeline.memory.remove(m.id).then(() => load()).catch((e: Error) => setError(e.message));
                    }} />
                </View>
              ))}
            </View>
          ))}
        </>
      )}
    </View>
  );
}

/** Experiment participant id instead of an account (K7). Shown over the app until an id is entered (and for good if the server address is wrong). */
export function ParticipantGate() {
  const { pipeline } = usePassContext();
  const [id, setId] = useState('');
  const ok = validParticipantId(id.trim());
  return (
    <Modal visible={pipeline.enabled && (pipeline.needsId || !!pipeline.configError)} transparent animationType="fade" onRequestClose={() => {}}>
      <View style={x.overlay}>
        <View style={x.sheet}>
          <Text style={x.title}>참가자 ID를 입력해주세요</Text>
          <Text style={x.small}>영문·숫자·_ . : - 로 64자까지. 진행자가 알려준 ID를 그대로 입력해요.</Text>
          <TextInput accessibilityLabel="참가자 ID" value={id} onChangeText={setId} autoCapitalize="none" autoCorrect={false} maxLength={64} style={x.input} />
          {pipeline.configError ? <Text style={x.small}>{pipeline.configError}</Text> : null}
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: !ok }} disabled={!ok || !!pipeline.configError} onPress={() => pipeline.setParticipant(id.trim())} style={[x.button, !ok && x.disabled]}>
            <Text style={x.buttonText}>시작하기</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const x = StyleSheet.create({
  wrap: { gap: 8, paddingHorizontal: 16, paddingTop: 8 },
  flex: { flex: 1 },
  card: { backgroundColor: c.white, borderColor: c.border, borderWidth: 1, borderRadius: 12, padding: 12, gap: 6 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { color: c.text, fontFamily: fonts.bold, fontSize: 14 },
  small: { color: c.muted, fontFamily: fonts.regular, fontSize: 12 },
  link: { color: c.primary, fontFamily: fonts.medium, fontSize: 12 },
  fact: { color: c.text, fontFamily: fonts.medium, fontSize: 13, backgroundColor: c.tint, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  tag: { color: c.text, fontFamily: fonts.regular, fontSize: 11, backgroundColor: c.segment, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  giftTag: { backgroundColor: c.tint, color: c.primary },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  sheet: { backgroundColor: c.white, borderRadius: 16, padding: 20, gap: 10 },
  input: { borderColor: c.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.regular, color: c.text },
  button: { backgroundColor: c.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  disabled: { opacity: 0.4 },
  buttonText: { color: c.white, fontFamily: fonts.bold },
});
