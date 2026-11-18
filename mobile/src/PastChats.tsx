import React, { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { colors as c, fonts } from './theme';
import type { EngineProduct } from './domain';
import type { FeedbackSignal, PastChat, PastChatDetail } from './chatHistory';

const date = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}월 ${d.getDate()}일`; };

// Mypage keeps the PR23 feedback switch and archived conversations.
export function PastChats({ chats, feedbackEnabled, feedbackToggleDisabled, onFeedbackChange, products, open, remove }: {
  chats: PastChat[]; signal: FeedbackSignal[]; products: EngineProduct[];
  feedbackEnabled: boolean;
  feedbackToggleDisabled: boolean;
  onFeedbackChange: (enabled: boolean) => void;
  open: (chat: PastChat) => Promise<PastChatDetail>;
  remove?: (id: string) => Promise<void>;
}) {
  const [opened, setOpened] = useState<{ id: string; detail: PastChatDetail | null; error?: string } | null>(null);
  const [deletion, setDeletion] = useState<{ id: string; pending: boolean; error?: string } | null>(null);
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
      <View style={st.feedbackPanel}>
        <View style={st.feedbackHeader}>
          <Text style={[st.title, st.feedbackTitle]}>지난 피드백 반영</Text>
          <Switch
            accessibilityLabel="지난 피드백 반영"
            value={feedbackEnabled}
            disabled={feedbackToggleDisabled}
            onValueChange={onFeedbackChange}
          />
        </View>
        <Text style={st.muted}>{feedbackEnabled
          ? '상품 평가는 같은 대화·같은 조건에서 다음 추천에 반영돼요. 다른 상황이나 대화에는 섞이지 않아요.'
          : '저장된 피드백을 추천 순위에 반영하지 않아요.'}</Text>
        {feedbackEnabled && <Text style={st.muted}>추천 카드의 👍/👎로 상품을 평가해요. 같은 선택을 다시 누르면 취소돼요.</Text>}
      </View>
      <Text style={[st.title, st.historyTitle]}>지난 대화 {chats.length}개</Text>
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
                {chat.feedback.map((f, i) => <Text key={`${f.giftId}:${i}`} style={st.muted}>{f.kind === 'gift_preference' ? '상품' : '설명'} {f.helpful ? '👍' : '👎'} {f.rank}순위 · {name.get(f.giftId) ?? f.giftId}</Text>)}
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
  wrap: { paddingHorizontal: 20, gap: 12 },
  feedbackPanel: { backgroundColor: c.background, borderRadius: 16, padding: 16, gap: 8 },
  feedbackHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  feedbackTitle: { marginTop: 0, flexShrink: 1 },
  title: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 24, color: c.text },
  historyTitle: { marginTop: 12, marginBottom: 2 },
  box: { backgroundColor: c.white, borderColor: c.border, borderWidth: 1, borderRadius: 14, padding: 16, gap: 6 },
  line: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 22, color: c.text },
  muted: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 20, color: c.muted },
  body: { marginTop: 8, gap: 6 },
  user: { alignSelf: 'flex-end', backgroundColor: c.tint, color: c.text, padding: 8, borderRadius: 10, fontFamily: fonts.regular, fontSize: 13 },
  assistant: { alignSelf: 'flex-start', backgroundColor: c.segment, color: c.text, padding: 8, borderRadius: 10, fontFamily: fonts.regular, fontSize: 13 },
});
