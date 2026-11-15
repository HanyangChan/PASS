import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CATEGORY_NAMES } from '../../lib/catalog.mjs';
import { feedbackWeights } from '../../lib/engine.mjs';
import { colors as c, fonts } from './theme';
import type { ChatMessage, EngineProduct } from './domain';
import type { FeedbackSignal, PastChat } from './chatHistory';

const category = (key: string) => (CATEGORY_NAMES as Record<string, string>)[key] ?? key;
const date = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}월 ${d.getDate()}일`; };
const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`;

// Mypage: the score weights the ranking currently applies, then past chats (read only).
export function PastChats({ chats, signal, products, open }: {
  chats: PastChat[]; signal: FeedbackSignal[]; products: EngineProduct[];
  open: (chat: PastChat) => Promise<ChatMessage[]>
}) {
  const [opened, setOpened] = useState<{ id: string; messages: ChatMessage[] | null; error?: string } | null>(null);
  const weights = feedbackWeights(products, { liked: signal.filter(f => f.helpful).map(f => f.giftId), disliked: signal.filter(f => !f.helpful).map(f => f.giftId) });
  const entries = Object.entries(weights.categories as Record<string, number>).sort((a, b) => b[1] - a[1]);
  const name = new Map(products.map(p => [p.id, p.name.replace('가상 ', '')]));
  const toggle = (chat: PastChat) => {
    if (opened?.id === chat.id) return setOpened(null);
    setOpened({ id: chat.id, messages: chat.messages });
    if (!chat.messages) open(chat).then(messages => setOpened(o => o?.id === chat.id ? { id: chat.id, messages } : o),
      () => setOpened(o => o?.id === chat.id ? { id: chat.id, messages: [], error: '대화를 불러오지 못했어요.' } : o));
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
                {opened.messages === null ? <Text style={st.muted}>불러오는 중…</Text> : opened.error ? <Text style={st.muted}>{opened.error}</Text>
                  : opened.messages.map((m, i) => <Text key={i} style={m.role === 'user' ? st.user : st.assistant}>{m.text}</Text>)}
                {chat.feedback.map(f => <Text key={f.giftId} style={st.muted}>{f.helpful ? '👍' : '👎'} {f.rank}순위 · {name.get(f.giftId) ?? f.giftId}</Text>)}
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
