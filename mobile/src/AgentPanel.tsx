import React from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { CATEGORY_NAMES } from '../../lib/catalog.mjs';
import { colors as c } from './theme';

// Server agent payload (api/README.md, "에이전트 모드"). Patches use the app's condition fields.
export type AgentPayload = {
  attribution: { holder: 'recipient' | 'giver' | 'other' | 'unclear' | 'gift'; person: string | null; field: string; value: unknown; applied: boolean }[];
  opinions: { agent: string; id: string; text: string; source: string; effect: 'auto' | 'suggest' | 'info'; enabled: boolean }[];
  suggestions: { agent: string; id: string; label: string; reason: string; patch: Record<string, unknown>; preview: { candidates: number; top: string | null } }[];
  memoryProposals: { recipient: string; preferences: string[]; excluded_categories: string[]; excluded_ingredients: string[] }[];
  autoApplied: string[];
  trace: { provider: string; llmCalls: number };
};
export const AGENTS = ['occasion', 'spending', 'taste', 'relationship'] as const;
const AGENT_LABELS: Record<string, string> = { occasion: '명절·기념일', spending: '소비', taste: '취향', relationship: '관계' };
const SOURCES: Record<string, string> = { message: '이번 대화', holiday_table: '기념일 표', calendar: '캘린더', purchase_history: '구매 기록', memory: '기억', engine_rule: '추천 규칙' };
const category = (key: string) => (CATEGORY_NAMES as Record<string, string>)[key] ?? key;
function factLabel(field: string, value: unknown) {
  const v = String(value);
  if (field === 'preferences') return v.startsWith('category:') ? `${category(v.slice(9))} 선호` : v === 'less_sweet' ? '덜 단 것' : v === 'unsweetened' ? '단맛 없는 것' : v;
  if (field === 'excluded_categories') return `${category(v)} 제외`;
  return `${v} 알레르기`;
}
function ownerLabel(holder: string, person: string | null) {
  if (holder === 'recipient') return person ?? '받는 분';
  if (holder === 'giver') return '나 · 미반영';
  if (holder === 'other') return `${person ?? '다른 사람'} · 미반영`;
  return '누구인지 확인 필요';
}

type Props = {
  agents: AgentPayload;
  disabled: string[];
  busy: boolean;
  onToggle: (agent: string, on: boolean) => void;
  onSuggest: (patch: Record<string, unknown>, label: string) => void;
};
export function AgentPanel({ agents, disabled, busy, onToggle, onSuggest }: Props) {
  const facts = agents.attribution.filter(a => a.holder !== 'gift');
  const shown = AGENTS.filter(a => agents.opinions.some(o => o.agent === a));
  return (
    <View style={s.panel} accessibilityLabel="에이전트 의견">
      {facts.length > 0 && (
        <View style={s.block}>
          <Text style={s.title}>이해한 조건과 주인</Text>
          <View style={s.chips}>
            {facts.map((f, i) => (
              <View key={i} style={[s.chip, !f.applied && s.chipOff]}>
                <Text style={[s.chipText, !f.applied && s.mutedText]}>{factLabel(f.field, f.value)} · {ownerLabel(f.holder, f.person)}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
      {shown.length > 0 && (
        <View style={s.block}>
          <Text style={s.title}>에이전트 의견</Text>
          {shown.map(agent => {
            const on = !disabled.includes(agent);
            return (
              <View key={agent} style={s.row}>
                <View style={s.flex}>
                  <Text style={[s.agent, !on && s.mutedText]}>{AGENT_LABELS[agent]}</Text>
                  {agents.opinions.filter(o => o.agent === agent).map(o => (
                    <Text key={o.id} style={[s.text, !on && s.mutedText]}>
                      {o.text}<Text style={s.source}> · {SOURCES[o.source] ?? o.source}{o.effect === 'auto' && on ? ' · 추천에 반영' : ''}</Text>
                    </Text>
                  ))}
                </View>
                <Switch accessibilityLabel={`${AGENT_LABELS[agent]} 에이전트 ${on ? '끄기' : '켜기'}`} value={on} disabled={busy}
                  onValueChange={value => onToggle(agent, value)} trackColor={{ true: c.primary, false: c.border }} thumbColor={c.white}
                  {...({ activeThumbColor: c.white } as object)} /* react-native-web ignores thumbColor when on */ />
              </View>
            );
          })}
        </View>
      )}
      {agents.suggestions.length > 0 && (
        <View style={s.block}>
          <Text style={s.title}>눌러서 적용하는 제안</Text>
          {agents.suggestions.map(x => (
            <Pressable key={x.id} accessibilityRole="button" disabled={busy} onPress={() => onSuggest(x.patch, x.label)} style={s.suggestion}>
              <Text style={s.suggestionText}>{x.label}</Text>
              <Text style={s.source}>{x.reason} · 적용하면 후보 {x.preview.candidates.toLocaleString()}개{x.preview.top ? ` (1위 ${x.preview.top})` : ''}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  panel: { borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, gap: 14, backgroundColor: c.white },
  block: { gap: 8 },
  title: { fontSize: 14, fontWeight: '600', color: c.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderRadius: 14, paddingVertical: 5, paddingHorizontal: 10, backgroundColor: c.tint },
  chipOff: { backgroundColor: c.segment },
  chipText: { fontSize: 12, color: c.primary },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderColor: c.border, paddingTop: 8 },
  flex: { flex: 1, gap: 2 },
  agent: { fontSize: 13, fontWeight: '600', color: c.text },
  text: { fontSize: 13, lineHeight: 19, color: c.text },
  source: { fontSize: 12, color: c.muted },
  mutedText: { color: c.muted },
  suggestion: { borderWidth: 1, borderColor: c.primary, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, gap: 2 },
  suggestionText: { fontSize: 13, fontWeight: '600', color: c.primary },
});
