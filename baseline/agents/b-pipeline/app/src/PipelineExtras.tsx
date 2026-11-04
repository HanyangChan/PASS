// New UI pieces of the b-pipeline mode (TRD §9-4): reason tags, B chips, the "반영 한 줄" with [수정], "기억할까요?" prompts,
// the compare tray and the participant id entry. Colors, fonts and the Chip come from the existing theme/components; nothing
// else in the design changes. Condition A/B is never named on screen (F5): B simply has more fields in the same places.
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors as c, fonts } from './theme';
import { Chip } from './components';
import { wonShort } from './services/pipelineEvents.mjs';
import { validParticipantId } from './services/pipelineEvents.mjs';
import type { PipelineTurn, PipelineRequest } from './services/pipelineChatService';

type Act = (request: PipelineRequest) => void;

/** Tags under a card: the LLM/template tags once explanations exist, the card event's template tags before that. */
export function tagsOf(turn: PipelineTurn, id: string): string[] {
  const fromExplanations = turn.explanations?.find((i: { id: string }) => i.id === id)?.tags;
  return fromExplanations ?? turn.annotations[id]?.tags ?? [];
}

export function PipelineTags({ turn, id }: { turn: PipelineTurn; id: string }) {
  const tags = tagsOf(turn, id);
  const gift = turn.annotations[id]?.giftHistory?.label;
  if (!tags.length && !gift) return null;
  return (
    <View style={x.tagRow}>
      {gift ? <Text style={[x.tag, x.giftTag]}>{gift}</Text> : null}
      {tags.map((t: string) => <Text key={t} style={x.tag}>{t}</Text>)}
    </View>
  );
}

const PROMPT_ANSWERS = (p: any, turn: PipelineTurn): { label: string; request?: PipelineRequest }[] => {
  switch (p.kind) {
    case 'remember': return [{ label: '기억할게요', request: { kind: 'memory_confirm', accept: true } }, { label: '기억하지 않아요', request: { kind: 'memory_confirm', accept: false } }];
    case 'dismiss_scope': return (p.chips ?? []).map((ch: { label: string; scope: 'product' | 'category' }) => ({ label: ch.label, request: { kind: 'feedback', action: 'dismissed', productId: p.productId, scope: ch.scope } }));
    case 'sensitivity': return [{ label: '네', request: { kind: 'memory_edit', op: 'sensitivity', accept: true } }, { label: '아니요', request: { kind: 'memory_edit', op: 'sensitivity', accept: false } }];
    case 'satisfaction': return [1, 2, 3, 4, 5].map(n => ({ label: `${n}점`, request: { kind: 'feedback', action: 'satisfaction', giftId: p.giftId, satisfaction: n } }));
    case 'suggested': return [{ label: '네', request: { kind: 'memory_edit', op: 'accept_suggested', memoryIds: (p.candidates ?? []).map((m: { memoryId: string }) => m.memoryId) } }, { label: '아니요' }];
    case 'allergy_delete': case 'memory_conflict': return [{ label: '네', request: { kind: 'memory_edit', op: 'resolve_conflict', memoryId: p.memoryId, accept: true } }, { label: '아니요', request: { kind: 'memory_edit', op: 'resolve_conflict', memoryId: p.memoryId, accept: false } }];
    // K19: a session-only allergy leaves only after this confirmation (the conditions minus the asked ingredients)
    case 'allergy_release_session': return [{ label: '해제할게요', request: { kind: 'patch', patch: { excluded_ingredients: (turn.conditions?.excluded_ingredients ?? []).filter((v: string) => !(p.ingredients ?? []).includes(v)) }, confirmedReleases: p.ingredients ?? [] } }, { label: '그대로 둘게요' }];
    // K18: a remembered allergy is deleted only on an explicit yes (one memory at a time; several: my page)
    case 'allergy_release': return (p.memoryIds ?? []).length === 1 ? [{ label: '삭제할게요', request: { kind: 'memory_edit', op: 'delete', memoryId: p.memoryIds[0] } }, { label: '그대로 둘게요' }] : [{ label: '닫기' }];
    default: return [{ label: '닫기' }];
  }
};

function Prompt({ p, act, turn, dismiss }: { p: any; act: Act; turn: PipelineTurn; dismiss: () => void }) {
  const lines: string[] = p.kind === 'remember'
    ? [...(p.candidates ?? []).map((m: { recipientName: string | null; label: string }) => `${m.recipientName ?? ''} ${m.label}`.trim()), ...(p.gifts ?? []).map((g: { productName: string | null }) => g.productName ?? '')].filter(Boolean)
    : [];
  return (
    <View style={x.card}>
      <Text style={x.title}>{p.text}</Text>
      {lines.map((l: string) => <Text key={l} style={x.small}>· {l}</Text>)}
      <View style={x.chips}>
        {PROMPT_ANSWERS(p, turn).map(a => <Chip key={a.label} label={a.label} onPress={() => { if (a.request) act(a.request); dismiss(); }} />)}
      </View>
    </View>
  );
}

/**
 * Everything under the card row: banner + [수정], prompts, B chips (contrast / counterfactual / price options) and the tray.
 * `top` is the rank-1 explanation item (B fields live only there). Rendered the same in A; A's items simply have no B fields.
 */
export function PipelineExtras({ turn, act, busy }: { turn: PipelineTurn; act: Act; busy: boolean }) {
  const [editing, setEditing] = useState(false);
  const [sure, setSure] = useState<string | null>(null);
  const [closed, setClosed] = useState<string[]>([]);
  const top = turn.explanations?.[0];
  const down = top?.ladderChips?.find((ch: { direction: string }) => ch.direction === 'down');
  const up = top?.ladderChips?.find((ch: { direction: string }) => ch.direction === 'up');
  const chips = [...(down ? [down] : []), ...(up ? [up] : [])];
  const prompts = turn.prompts.filter((p: any, i: number) => !closed.includes(`${p.kind}-${i}`));
  return (
    <View style={x.wrap}>
      {turn.banner ? (
        <View style={x.card}>
          <View style={x.rowBetween}>
            <Text style={[x.small, x.flex]}>{turn.banner.text}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="반영한 기억 수정" onPress={() => setEditing(v => !v)}><Text style={x.link}>[수정]</Text></Pressable>
          </View>
          {editing && (turn.banner.items ?? []).map((m: { memoryId: string; label: string }) => (
            <View key={m.memoryId} style={x.rowBetween}>
              <Text style={x.small}>{m.label}</Text>
              <Chip label={sure === m.memoryId ? '정말 지울까요?' : '기억에서 지우기'} selected={sure === m.memoryId}
                onPress={() => { if (sure !== m.memoryId) { setSure(m.memoryId); return; } setSure(null); setEditing(false); act({ kind: 'memory_edit', op: 'delete', memoryId: m.memoryId }); }} />
            </View>
          ))}
        </View>
      ) : null}
      {turn.notice ? <Text style={x.small}>{turn.notice}</Text> : null}
      {prompts.map((p: any, i: number) => <Prompt key={`${p.kind}-${i}`} p={p} act={act} turn={turn} dismiss={() => setClosed(old => [...old, `${p.kind}-${i}`])} />)}
      {top?.contrastChip ? <Text style={x.fact}>{top.contrastChip}</Text> : null}
      {top?.memoryCfLine ? <Text style={x.fact}>{top.memoryCfLine}</Text> : null}
      {chips.length > 0 && (
        <View style={x.chips}>
          {chips.map((ch: any, i: number) => (
            <Chip key={ch.label} label={ch.label} selected={ch.direction === 'down' && turn.emphasize === 'down' && i === 0}
              onPress={() => { if (!busy) act(ch.direction === 'down' ? { kind: 'ladder_pick', direction: 'down' } : { kind: 'ladder_compare', productId: ch.productId }); }} />
          ))}
        </View>
      )}
      {top?.ladderNotice ? <Text style={x.small}>{top.ladderNotice}</Text> : null}
      {turn.compare.length > 0 && (
        <View style={x.card}>
          <Text style={x.title}>비교 트레이</Text>
          {turn.compare.map((t: { id: string; name: string; price: number; rating: { from: number; to: number } }) => (
            <Text key={t.id} style={x.small}>{t.name} · +{wonShort(t.price)} · 평점 {t.rating.from.toFixed(1)} → {t.rating.to.toFixed(1)}</Text>
          ))}
        </View>
      )}
    </View>
  );
}

/** Experiment participant id instead of an account (K7). Shown over the app until an id is entered. */
export function ParticipantGate({ visible, error, onSubmit }: { visible: boolean; error?: string; onSubmit: (id: string) => void }) {
  const [id, setId] = useState('');
  const ok = validParticipantId(id.trim());
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => {}}>
      <View style={x.overlay}>
        <View style={x.sheet}>
          <Text style={x.title}>참가자 ID를 입력해주세요</Text>
          <Text style={x.small}>영문·숫자·_ . : - 로 64자까지. 진행자가 알려준 ID를 그대로 입력해요.</Text>
          <TextInput accessibilityLabel="참가자 ID" value={id} onChangeText={setId} autoCapitalize="none" autoCorrect={false} maxLength={64} style={x.input} />
          {error ? <Text style={x.small}>{error}</Text> : null}
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: !ok }} disabled={!ok} onPress={() => onSubmit(id.trim())} style={[x.button, !ok && x.disabled]}>
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
