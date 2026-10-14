import React, { useState } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import type { Conditions, Gift } from './domain';
import type { usePersonalization } from './usePersonalization';
import { rememberConditions } from './services/personalization';
import { colors as c } from './theme';

const labels: Record<string, string> = { less_sweet: '덜 단 상품', unsweetened: '단맛 없는 상품', fruit: '과일', hangwa: '한과', nuts: '견과류', tea: '차', coffee: '커피', oil: '기름' };
const label = (value: string) => labels[value.replace('category:', '')] ?? value;
type Props = { store: ReturnType<typeof usePersonalization>; conditions: Conditions; recent: Gift[]; applied: string[]; chatPending: boolean };
export function PersonalizationPanel({ store, conditions, recent, applied, chatPending }: Props) {
  const [open, setOpen] = useState(false);
  const recipient = conditions.recipients.length === 1 ? conditions.recipients[0] : null;
  const disabled = !store.ready || store.busy || chatPending;
  const action = (label: string, onPress: () => void, unavailable = disabled) => (
    <Pressable key={label} accessibilityRole="button" accessibilityState={{ disabled: unavailable }} disabled={unavailable} onPress={onPress} style={styles.action}>
      <Text style={{ color: unavailable ? c.muted : c.primary }}>{label}</Text>
    </Pressable>
  );
  return <View style={styles.panel}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)}>
      <Text style={styles.title}>기억과 구매 이력 {open ? '접기' : '관리'} · {store.data.memories.length}명</Text>
    </Pressable>
    {applied.map(reason => <Text key={reason} style={styles.text}>{reason}</Text>)}
    {!!store.error && <View><Text accessibilityRole="alert">{store.error}</Text>{!store.ready && action('다시 불러오기', store.retry, false)}</View>}
    {open && <>
      <Text style={styles.text}>이 기기에서 계정별로 저장해요. 게스트 기록은 별도로 보관해요. 새 대화에서도 수령인이 같으면 반영해요.</Text>
      <Text style={styles.text}>예산과 배송일은 기억하지 않아요. 알레르기 정보가 불완전한 상품은 적합하다고 확정하지 않아요.</Text>
      {action(recipient ? `${recipient}의 현재 선호·제외 조건 기억하기` : '먼저 한 명의 수령인을 정해주세요', () => void store.update(old => rememberConditions(old, conditions, new Date().toISOString())), disabled || !recipient)}
      {store.data.memories.map(memory => <View key={memory.recipient} style={styles.row}>
        <Text style={styles.text}>{memory.recipient} · 선호: {memory.preferences.map(label).join(', ') || '없음'} · 제외: {[...memory.excluded_categories, ...memory.excluded_ingredients].map(label).join(', ') || '없음'}</Text>
        {action('기억 삭제', () => void store.update(old => ({ ...old, memories: old.memories.filter(m => m.recipient !== memory.recipient) })))}
      </View>)}
      <Text style={styles.title}>직접 구매 이력 등록</Text>
      <Text style={styles.text}>최근 본 상품 중 실제 구매한 상품만 등록해주세요. 주문·결제 확인 기록은 아니에요. 등록 후 만족도를 선택하면 다음 새 대화에 참고해요.</Text>
      {!recent.length && <Text style={styles.text}>상품 상세를 열면 등록할 상품이 여기에 표시돼요.</Text>}
      {recent.slice(0, 5).map(gift => action(`${gift.name} 구매 등록`, () => void store.update(old => ({ ...old, purchases: [{ id: `${Date.now()}-${gift.id}`, recipient: recipient!, gift, feedback: 'unknown' as const, source: 'user_reported' as const, recordedAt: new Date().toISOString() }, ...old.purchases].slice(0, 100) })), disabled || !recipient))}
      {store.data.purchases.map(purchase => <View key={purchase.id} style={styles.row}>
        <Text style={styles.text}>{purchase.recipient} · {purchase.gift.name} · {purchase.feedback === 'liked' ? '만족' : purchase.feedback === 'disliked' ? '불만족' : '평가 전'}</Text>
        <View style={styles.actions}>
          {action('만족', () => void store.update(old => ({ ...old, purchases: old.purchases.map(p => p.id === purchase.id ? { ...p, feedback: 'liked' } : p) })))}
          {action('불만족', () => void store.update(old => ({ ...old, purchases: old.purchases.map(p => p.id === purchase.id ? { ...p, feedback: 'disliked' } : p) })))}
          {action('삭제', () => void store.update(old => ({ ...old, purchases: old.purchases.filter(p => p.id !== purchase.id) })))}
        </View>
      </View>)}
      <Text style={styles.text}>조건 수정은 위의 조건 편집에서 변경한 뒤 다시 기억해주세요. 알레르기를 해제하려면 해당 기억을 삭제하고 현재 조건도 수정해주세요.</Text>
    </>}
  </View>;
}
const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderColor: c.muted, borderRadius: 12, padding: 12, gap: 8 },
  title: { fontSize: 14, fontWeight: '600', color: c.text },
  text: { fontSize: 12, lineHeight: 19, color: c.muted },
  action: { paddingVertical: 10, paddingHorizontal: 4 },
  row: { borderTopWidth: 1, borderColor: c.muted, paddingTop: 8 },
  actions: { flexDirection: 'row', gap: 16 },
});
