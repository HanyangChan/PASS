import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CATEGORY_NAMES } from '../../lib/catalog.mjs';
import { feedbackWeights } from '../../lib/engine.mjs';
import { colors as c, fonts } from './theme';
import type { EngineProduct } from './domain';
import type { FeedbackSignal, PastChat, PastChatDetail } from './chatHistory';

const category = (key: string) => (CATEGORY_NAMES as Record<string, string>)[key] ?? key;
const date = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}월 ${d.getDate()}일`; };
const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`;

// Mypage shows the current feedback weights and archived conversations.
export function PastChats({ chats, signal, products, open, remove }: {
  chats: PastChat[]; signal: FeedbackSignal[]; products: EngineProduct[];
  open: (chat: PastChat) => Promise<PastChatDetail>;
  remove?: (id: string) => Promise<void>;
}) {
  const [opened, setOpened] = useState<{ id: string; detail: PastChatDetail | null; error?: string } | null>(null);
  const [deletion, setDeletion] = useState<{ id: string; pending: boolean; error?: string } | null>(null);
  const weights = feedbackWeights(products, { liked: signal.filter(f => f.helpful).map(f => f.giftId), disliked: signal.filter(f => !f.helpful).map(f => f.giftId) });
  const entries = Object.entries(weights.categories as Record<string, number>).sort((a, b) => b[1] - a[1]);
  const name = new Map(products.map(p => [p.id, p.name.replace('가상 ', '')]));
  const toggle = (chat: PastChat) => {
    if (opened?.id === chat.id) return setOpened(null);
    const request = { id: chat.id, detail: null };
    setOpened(request);
    open(chat).then(detail => setOpened(current => current === request ? { id: chat.id, detail } : current),
      () => setOpened(current => current === request ? { ...request, error: '대화를 불러오지 못했어요.' } : current));
  };
  const confirmRemoval = async (id: string) => {
    if (!remove || deletion?.pending) return;
    setDeletion({ id, pending: true });
    try {
      await remove(id);
      setOpened(current => current?.id === id ? null : current);
      setDeletion(null);
    } catch {
      setDeletion({ id, pending: false, error: '대화를 삭제하지 못했어요. 다시 시도해주세요.' });
    }
  };
  return (
    <View style={st.wrap}>
      <Text style={st.title}>추천에 반영 중인 피드백</Text>
      {entries.length || weights.disliked.size ? (
        <View style={st.box}>
          {entries.map(([key, score]) => <Text key={key} style={st.line}>{category(key)} {signed(score)}점</Text>)}
          {weights.disliked.size > 0 && <Text style={st.line}>👎 받은 상품 {weights.disliked.size}개는 −5점</Text>}
          <Text style={st.muted}>같은 조건 안에서만 순서를 바꿔요. 예산·알레르기 조건은 그대로예요.</Text>
        </View>
      ) : <Text style={st.muted}>추천 카드의 👍/👎가 다음 추천 점수에 반영돼요.</Text>}
      <Text style={st.title}>지난 대화 {chats.length}개</Text>
      {chats.length === 0 && <Text style={st.muted}>새 대화를 시작하면 지금 대화가 여기에 남아요.</Text>}
      {chats.map(chat => {
        const up = chat.feedback.filter(f => f.helpful).length, down = chat.feedback.length - up;
        const isOpen = opened?.id === chat.id;
        return (
          <View key={chat.id} style={st.box}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: isOpen }} onPress={() => toggle(chat)}>
              <Text style={st.line} numberOfLines={1}>{chat.title}</Text>
              <Text style={st.muted}>{[date(chat.at), chat.recipients.join('·'), `👍 ${up} · 👎 ${down}`].filter(Boolean).join(' · ')}</Text>
            </Pressable>
            {isOpen && (
              <View style={st.body}>
                {opened.error ? <Text style={st.muted}>{opened.error}</Text> : !opened.detail ? <Text style={st.muted}>불러오는 중…</Text> : <>
                  {opened.detail.messages.map((m, i) => <Text key={i} style={m.role === 'user' ? st.user : st.assistant}>{m.text}</Text>)}
                  {opened.detail.recommendations.length > 0 && <>
                    <Text style={st.line}>그때 추천한 상품</Text>
                    {opened.detail.recommendations.map(gift => <Text key={gift.id} style={st.muted}>{gift.name} · {gift.price.toLocaleString('ko-KR')}원</Text>)}
                  </>}
                </>}
                {chat.feedback.map(f => <Text key={f.giftId} style={st.muted}>{f.helpful ? '👍' : '👎'} {f.rank}순위 · {name.get(f.giftId) ?? f.giftId}</Text>)}
                {remove && (deletion?.id === chat.id ? (
                  <View style={st.body}>
                    <Text style={st.muted}>{deletion.error ?? '이 대화를 삭제할까요?'}</Text>
                    <Pressable accessibilityRole="button" disabled={deletion.pending} onPress={() => void confirmRemoval(chat.id)}>
                      <Text style={st.line}>{deletion.pending ? '삭제 중…' : '삭제'}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" disabled={deletion.pending} onPress={() => setDeletion(null)}>
                      <Text style={st.muted}>취소</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable accessibilityRole="button" disabled={deletion?.pending} onPress={() => setDeletion({ id: chat.id, pending: false })}>
                    <Text style={st.muted}>대화 삭제</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}
const st = StyleSheet.create({
  wrap: { gap: 8 },
  title: { fontFamily: fonts.bold, fontSize: 16, color: c.text, marginTop: 8 },
  box: { backgroundColor: c.white, borderColor: c.border, borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
  line: { fontFamily: fonts.medium, fontSize: 14, color: c.text },
  muted: { fontFamily: fonts.regular, fontSize: 12, color: c.muted },
  body: { marginTop: 8, gap: 6 },
  user: { alignSelf: 'flex-end', backgroundColor: c.tint, color: c.text, padding: 8, borderRadius: 10, fontFamily: fonts.regular, fontSize: 13 },
  assistant: { alignSelf: 'flex-start', backgroundColor: c.segment, color: c.text, padding: 8, borderRadius: 10, fontFamily: fonts.regular, fontSize: 13 },
});
