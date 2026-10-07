import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Mic, Square, X, Gift, ChevronDown, ChevronUp, Plus } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors as c, fonts as f } from './theme';
import { Chip } from './components';

type Conditions = {
  recipients: string[]; occasion: string | null;
  budget: { amount_krw: number | null; shipping_included: boolean | null };
  preferences: string[]; excluded_categories: string[]; excluded_ingredients: string[];
  brand: string | null; delivery_by: string | null; packaging: string | null;
};
const arrayFields = ['recipients', 'preferences', 'excluded_categories', 'excluded_ingredients'] as const;
const fields = [
  ['recipients', '받는 분', '부모님, 친구'], ['occasion', '선물하는 날', '추석, 생일'],
  ['amount', '예산 (원)', '50000'], ['preferences', '선호 조건', '덜 달게, 차'],
  ['excluded_categories', '제외 상품군', '견과류, 한과'], ['excluded_ingredients', '피할 성분', '땅콩, 우유'],
  ['brand', '브랜드', '브랜드 이름'], ['delivery_by', '수령 마감일', '2026-10-20'],
  ['packaging', '포장', '격식 있는 포장 / 기본 포장'],
] as const;
const conditionLabels: Record<string, string> = { less_sweet: '덜 달게', unsweetened: '단맛 없이', 'category:tea': '차', nuts: '견과류', hangwa: '한과', fruit: '과일', coffee: '커피', tea: '차', formal: '격식 있는 포장', basic: '기본 포장' };
const toLabel = (value: string) => conditionLabels[value] ?? value;
const toValue = (value: string, field: string) => {
  if (field === 'preferences' && value === '차') return 'category:tea';
  return Object.entries(conditionLabels).find(([key, label]) => label === value && (field === 'preferences' ? key.includes(':') || ['less_sweet', 'unsweetened'].includes(key) : !key.includes(':')))?.[0] ?? value;
};
export function ChatTools({ conditions, onApply, onVoice, mode = 'conditions' }: {
  mode?: 'conditions' | 'voice'; conditions: Conditions; onApply: (patch: Partial<Conditions>) => void; onVoice: (text: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [panel, setPanel] = useState<'voice' | 'conditions' | null>(null);
  const [stage, setStage] = useState<'ready' | 'recording' | 'review'>('ready');
  const [transcript, setTranscript] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [shipping, setShipping] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const openConditions = () => {
    setDraft(Object.fromEntries(fields.map(([key]) => {
      const value = key === 'amount' ? conditions.budget.amount_krw : conditions[key];
      return [key, Array.isArray(value) ? value.map(toLabel).join(', ') : value === null ? '' : toLabel(String(value))];
    })));
    setShipping(conditions.budget.shipping_included); setError(''); setPanel('conditions');
  };
  const close = () => setPanel(null);
  const apply = () => {
    const amount = draft.amount.trim() ? Number(draft.amount.replaceAll(',', '')) : null;
    if (amount !== null && (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount))) {
      setError('예산은 0보다 큰 정수로 입력해주세요.'); return;
    }
    const patch: Partial<Conditions> = { budget: { amount_krw: amount, shipping_included: shipping } };
    for (const key of arrayFields) patch[key] = draft[key].split(',').map(v => toValue(v.trim(), key)).filter(Boolean);
    for (const key of ['occasion', 'brand', 'delivery_by', 'packaging'] as const) patch[key] = toValue(draft[key].trim(), key) || null;
    if (patch.delivery_by && (!/^\d{4}-\d{2}-\d{2}$/.test(patch.delivery_by) || Number.isNaN(Date.parse(patch.delivery_by)))) {
      setError('수령 마감일은 YYYY-MM-DD 형식으로 입력해주세요.'); return;
    }
    if (patch.packaging && !['formal', 'basic'].includes(patch.packaging)) {
      setError('포장은 격식 있는 포장 또는 기본 포장으로 입력해주세요.'); return;
    }
    onApply(patch); close();
  };
  return <>
    {mode === 'conditions' ? <View style={s.conditionCard}>
      <Pressable accessibilityRole="button" accessibilityLabel="선물 조건 펼치기 또는 접기" accessibilityState={{ expanded }} onPress={() => setExpanded(old => !old)} style={s.conditionHeader}>
        <Gift size={20} color={c.primary}/><Text style={s.conditionTitle}>선물 조건</Text>{expanded ? <ChevronUp size={20} color={c.muted}/> : <ChevronDown size={20} color={c.muted}/>}
      </Pressable>
      {expanded && <View style={s.summary}>
        {[
          ['받는 분', conditions.recipients.join(' · ') || '미정'],
          ['상황', conditions.occasion || '미정'],
          ['예산', conditions.budget.amount_krw ? `${(conditions.budget.amount_krw / 10000).toLocaleString('ko-KR')}만 원` : '미정'],
          ['선호', conditions.preferences.map(toLabel).join(' · ') || '미정'],
          ['배송비', conditions.budget.shipping_included === null ? '미정' : conditions.budget.shipping_included ? '포함' : '별도'],
        ].map(([label, value]) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={`${label} ${value} 수정`} onPress={openConditions} style={[s.summaryChip, label === '배송비' && conditions.budget.shipping_included === true && s.shippingChip]}>
          <Text style={s.note}>{label} <Text style={s.summaryValue}>{value}</Text></Text>
        </Pressable>)}
        <Pressable accessibilityRole="button" accessibilityLabel="조건 추가 및 전체 확인" onPress={openConditions} style={s.addChip}><Plus size={16} color={c.muted}/><Text style={s.note}>조건 추가</Text></Pressable>
      </View>}
    </View> : <Pressable accessibilityRole="button" accessibilityLabel="음성 입력" onPress={() => { setStage('ready'); setTranscript(''); setPanel('voice'); }} style={s.micButton}><Mic size={22} color={c.primary}/></Pressable>}
    <Modal visible={panel !== null} transparent animationType="slide" onRequestClose={close}>
      <View style={s.overlay}>
        <SafeAreaView edges={['bottom']} style={s.sheet}>
          <View style={s.header}><Text style={s.title}>{panel === 'voice' ? '음성으로 조건 입력' : '현재 추천 조건'}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="닫기" onPress={close} style={s.close}><X size={22} color={c.text}/></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
            {panel === 'voice' ? <>
              <Text style={s.note}>프로토타입 · 실제 녹음 없이 음성 입력 흐름을 체험해요.</Text>
              <View style={s.voice}><Mic size={48} color={c.primary}/><Text style={s.title}>{stage === 'ready' ? '어떤 선물을 찾고 있나요?' : stage === 'recording' ? '듣고 있어요…' : '입력 내용을 확인해주세요'}</Text>
                <Text style={s.note}>{stage === 'recording' ? '말하기를 마친 뒤 완료를 눌러주세요.' : '예: 부모님께 드릴 5만 원 이하 선물'}</Text></View>
              {stage === 'review' && <TextInput accessibilityLabel="음성 인식 내용" multiline value={transcript} onChangeText={setTranscript} style={s.transcript}/>}
              {stage !== 'review' ? <Pressable accessibilityRole="button" onPress={() => {
                if (stage === 'ready') setStage('recording'); else { setTranscript('부모님께 드릴 선물, 5만 원 이하로 배송비 포함해서 추천해줘.'); setStage('review'); }
              }} style={s.primary}><Square size={16} color={c.white}/><Text style={s.white}>{stage === 'ready' ? '말하기 시작' : '말하기 완료'}</Text></Pressable> : <>
                <Pressable accessibilityRole="button" disabled={!transcript.trim()} onPress={() => { onVoice(transcript); close(); }} style={[s.primary, !transcript.trim() && { opacity: 0.4 }]}><Text style={s.white}>입력창에 적용</Text></Pressable>
                <Pressable accessibilityRole="button" onPress={() => { setTranscript(''); setStage('recording'); }} style={s.secondary}><Text style={s.toolText}>다시 말하기</Text></Pressable>
              </>}
              <Pressable accessibilityRole="button" onPress={close} style={s.secondary}><Text style={s.note}>취소</Text></Pressable>
            </> : <>
              <Text style={s.note}>대화에서 확인한 조건이에요. 비어 있는 항목은 아직 정하지 않았어요. 여러 값은 쉼표로 구분해주세요.</Text>
              {fields.map(([key, label, placeholder]) => <View key={key} style={s.field}><Text style={s.label}>{label}</Text>
                <TextInput accessibilityLabel={label} value={draft[key] ?? ''} onChangeText={v => { setDraft(old => ({ ...old, [key]: v })); setError(''); }} placeholder={placeholder} keyboardType={key === 'amount' ? 'numeric' : 'default'} style={s.input}/>
              </View>)}
              <Text style={s.label}>배송비 기준</Text><View style={s.tools}>{([{ label: '미정', value: null }, { label: '배송비 포함', value: true }, { label: '상품값 기준', value: false }] as const).map(item => <Chip key={item.label} label={item.label} selected={shipping === item.value} onPress={() => setShipping(item.value)}/>)}</View>
              {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
              <Pressable accessibilityRole="button" onPress={apply} style={s.primary}><Text style={s.white}>변경 조건 적용</Text></Pressable>
              <Pressable accessibilityRole="button" onPress={close} style={s.secondary}><Text style={s.note}>취소</Text></Pressable>
            </>}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  </>;
}
const s = StyleSheet.create({
  conditionCard: { marginHorizontal: 16, marginTop: 12, marginBottom: 4, borderWidth: 1, borderColor: c.border, borderRadius: 18, backgroundColor: c.white, overflow: 'hidden' },
  conditionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, minHeight: 48 },
  conditionTitle: { flex: 1, fontFamily: f.bold, fontSize: 16, color: c.text },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 12, borderTopWidth: 1, borderColor: c.border },
  summaryChip: { borderRadius: 24, backgroundColor: c.segment, paddingHorizontal: 12, paddingVertical: 6, maxWidth: '100%' },
  summaryValue: { fontFamily: f.bold, color: c.text }, shippingChip: { backgroundColor: c.tint, borderWidth: 1, borderColor: c.primary },
  addChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderStyle: 'dashed', borderColor: c.border, borderRadius: 24, paddingHorizontal: 12, paddingVertical: 6 },
  micButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  tools: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, tool: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 12, backgroundColor: c.tint, borderRadius: 12 },
  toolText: { color: c.primary, fontFamily: f.medium, fontSize: 13 }, overlay: { flex: 1, backgroundColor: '#00000066', justifyContent: 'flex-end' },
  sheet: { backgroundColor: c.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '90%', paddingHorizontal: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16 }, close: { padding: 12 },
  title: { fontFamily: f.bold, fontSize: 18, color: c.text }, content: { gap: 14, paddingBottom: 20 }, note: { fontFamily: f.regular, fontSize: 13, lineHeight: 21, color: c.muted },
  voice: { alignItems: 'center', gap: 16, paddingVertical: 24 }, transcript: { borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 16, minHeight: 100, fontFamily: f.regular, color: c.text },
  primary: { minHeight: 48, padding: 14, borderRadius: 12, backgroundColor: c.primary, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  white: { color: c.white, fontFamily: f.medium, fontSize: 15 }, secondary: { padding: 12, alignItems: 'center' }, field: { gap: 6 }, label: { fontFamily: f.medium, color: c.text, fontSize: 14 },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 12, fontFamily: f.regular, color: c.text }, error: { color: c.primary, fontFamily: f.regular },
});
