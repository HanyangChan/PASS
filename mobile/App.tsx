import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useMemo,
  useState,
  useCallback,
} from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  AppState,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { NotoSansKR_400Regular } from '@expo-google-fonts/noto-sans-kr/400Regular';
import { NotoSansKR_500Medium } from '@expo-google-fonts/noto-sans-kr/500Medium';
import { NotoSansKR_700Bold } from '@expo-google-fonts/noto-sans-kr/700Bold';
import {
  Home,
  Sparkles,
  Trophy,
  User,
  Gift as GiftIcon,
  ArrowLeft,
  Heart,
  Share2,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Star,
  ThumbsDown,
  ThumbsUp,
  Calendar as CalendarIcon,
  Clock3,
  LogIn,
  Cake,
  Gem,
  GraduationCap,
  Users,
  Puzzle,
  Briefcase,
  HandHeart,
} from 'lucide-react-native';
import SearchIcon from './assets/figma/search.svg';
import FilterIcon from './assets/figma/filter.svg';
import { colors as c, fonts as f } from './src/theme';
import { CalendarScreen, ddayLabel, eventKindMeta } from './src/CalendarScreen';
import { ChatTools } from './src/ChatTools';
import { ChatPendingIndicator } from './src/ChatPendingIndicator';
import { AgentModeControl } from './src/AgentModeControl';
import type { ChatAgentMode } from './src/chatAgentModes';
import { AttachmentPicker } from './src/AttachmentPicker';
import { personalizeSession, emptyPersonalization, assertSameRecipient } from './src/services/personalization';
import { useAuth } from './src/auth/AuthProvider';
import { Gift, rankGifts, selectGifts } from './src/catalog';
import { giftRepository, productRepository, calendarRepository, feedbackRepository, feedbackPreference, historyRepository } from './src/services/localServices';
import { chatTitle, HISTORY_RECOMMENDATION_LIMIT, rankingFeedback, restoreHistorySession, type FeedbackSignal, type PastChat } from './src/chatHistory';
import { cardReason } from './src/cardReason';
import { feedbackContext, productFeedbackKey } from '../lib/feedback.mjs';
import { PastChats } from './src/PastChats';
import { createFeedbackScheduler, stampConversation, toggleFeedback, type CardFeedback } from './src/cardFeedback';
import { createLocalChatService } from './src/services/chatService';
import { createCloudRecords } from './src/services/cloudRecords';
import { createSnapshotPersistence } from './src/services/snapshotPersistence';
import { supabase } from './src/auth/client';
import { randomUUID } from 'expo-crypto';
import { createServerChatService, resolveChatUrl } from './src/services/serverChatService';
import { daysUntil, upcomingWithin } from './src/services/calendarDates';
import type { ChatSession, ChatMessage, EngineProduct, CalendarEvent, CalendarEventKind } from './src/domain';
import {
  Chip,
  GiftCard,
  GiftImage,
  ProductImagesContext,
  Tile,
  SectionHeader,
  won,
} from './src/components';
let chatConfigurationError = '';
const chatEndpoint = (() => {
  try { return resolveChatUrl(process.env.EXPO_PUBLIC_CHAT_API_URL); }
  catch (error) { chatConfigurationError = (error as Error).message; return null; }
})();
type Screen = 'home' | 'chat' | 'ranking' | 'calendar' | 'mypage';
const conditionComparisonEnabled = false;
const nav = [
  { key: 'home', label: '홈', Icon: Home },
  { key: 'chat', label: 'AI 추천', Icon: Sparkles },
  { key: 'ranking', label: '선물 랭킹', Icon: Trophy },
  { key: 'calendar', label: '캘린더', Icon: CalendarIcon },
  { key: 'mypage', label: '마이페이지', Icon: User },
] as const;
const homeCategories = [
  { label: '생일', Icon: Cake },
  { label: '결혼', Icon: Gem },
  { label: '졸업', Icon: GraduationCap },
  { label: '부모님', Icon: Users },
  { label: '아이', Icon: Puzzle },
  { label: '연인', Icon: Heart },
  { label: '직장', Icon: Briefcase },
  { label: '감사', Icon: HandHeart },
];
function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={s.button}>
      <Text style={s.buttonText}>{label}</Text>
    </Pressable>
  );
}
export function AppContent({
  activeScreen,
  detailPage = false,
  resultPage = false,
  surveyRecording = false,
}: {
  activeScreen?: Screen;
  detailPage?: boolean;
  resultPage?: boolean;
  surveyRecording?: boolean;
}) {
  const state = useContext(PassContext);
  if (!state) throw new Error('PassProvider is required');
  const {
    screen: baseScreen,
    setScreen,
    detail: selectedDetail,
    setDetail: setSelectedDetail,
    saved,
    setSaved,
    recent,
    setRecent,
    events,
    setEvents,
    eventsReady,
    calendarLoadError,
    retryCalendarLoad,
    ready,
    notice,
    conditionMigrationNotice,
    dismissMigrationNotice,
    setNotice,
    syncFailed,
    retrySave,
    recommendation,
    chatPending,
    agentMode,
    changeAgentMode,
    agentConnected,
    chatError,
    sendChat,
    changeChatConditions,
    resetChat,
    cardFeedback,
    rateCard,
    pastChats,
    feedbackEnabled,
    feedbackToggleDisabled,
    changeFeedbackEnabled,
    resumePastChat,
    restoredRecommendations,
    deletePastChat,
    heroFailed,
    setHeroFailed,
    recipient,
    setRecipient,
    search,
    setSearch,
    filter,
    setFilter,
    showFilter,
    setShowFilter,
    sort,
    setSort,
    session,
    messages,
    setMessages,
    input,
    setInput,
    comparisonId,
    setComparisonId,
    allSaved,
    setAllSaved,
    allRecent,
    setAllRecent,
    chatService,
    catalogProducts,
    rankingByRecipient,
    popularGifts,
    catalogError,
    retryCatalog,
  } = state;
  const router = useRouter();
  const { user } = useAuth();
  const loggedIn = user !== null;
  const [attachments, setAttachments] = useState<string[]>([]);
  const [priceLimit, setPriceLimit] = useState<number | null>(null);
  const [draftFilter, setDraftFilter] = useState('전체');
  const [draftSort, setDraftSort] = useState('인기순');
  const [draftPrice, setDraftPrice] = useState<number | null>(null);
  const [composerFocused, setComposerFocused] = useState(false);
  const screen = activeScreen ?? baseScreen;
  const detail = detailPage ? selectedDetail : null;
  const resultsOpen = resultPage;
  const chatRef = useRef<ScrollView>(null),
    inputRef = useRef<TextInput>(null);
  const close = (fallback: '/' | '/chat') =>
    router.canGoBack() ? router.back() : router.replace(fallback);
  const setDetail = (gift: Gift | null) => {
    if (gift) {
      setSelectedDetail(gift);
      router.push('/gift');
    } else close('/');
  };
  const setResultsOpen = (open: boolean) => {
    if (open && conditionComparisonEnabled) router.push('/results');
    else if (open) return;
    else close('/chat');
  };
  useEffect(() => {
    if (detailPage && !selectedDetail) router.replace('/');
  }, [detailPage, selectedDetail, router]);
  const navigate = (next: Screen) => {
    setScreen(next);
    router.replace(
      next === 'home'
        ? '/'
        : next === 'chat'
          ? '/chat'
          : next === 'ranking'
            ? '/ranking'
            : next === 'calendar'
              ? '/calendar'
              : '/mypage',
    );
    setSearch('');
    setFilter('전체');
    setPriceLimit(null);
    setAllSaved(false);
    setAllRecent(false);
  };
  const open = (g: Gift) => {
    setDetail(g);
    setHeroFailed(false);
    setRecent((old) => [g, ...old.filter((p) => p.id !== g.id)].slice(0, 20));
  };
  const liked = (g: Gift) => saved.some((p) => p.id === g.id);
  const save = (g: Gift) =>
    setSaved((old) =>
      old.some((p) => p.id === g.id)
        ? old.filter((p) => p.id !== g.id)
        : [...old, g],
    );
  const addEvent = (title: string, date: string, kind: CalendarEventKind) =>
    setEvents((old) => [...old, { id: randomUUID(), title: title.trim(), date, kind }]);
  const removeEvent = (id: string) =>
    setEvents((old) => old.filter((e) => e.id !== id));
  const upcomingEvents = upcomingWithin(events, 7);
  const { question, result, comparison } = recommendation?.key === JSON.stringify(session) ? recommendation.view : chatService.view(session);
  const toGift = (product: Parameters<typeof chatService.toGift>[0]): Gift =>
    chatService.toGift(product, session.state);
  const send = (text: string, source: 'typed' | 'quick_reply' = 'typed', fresh?: ChatSession) => {
    if (!text.trim()) return;
    // Clear optimistically so a slow (e.g. LLM) round trip can't let further typing
    // pile onto the just-sent text; restore it only if the send actually fails.
    if (source === 'typed') setInput('');
    void sendChat(text, source, fresh).then(ok => {
      if (ok) setComparisonId(null);
      else if (ok === false && source === 'typed') setInput(text);
    });
  };
  const chat = (label?: string) => {
    navigate('chat');
    if (label)
      send(label === '부모님' ? '부모님' : `${label} 선물을 찾고 있어요`);
  };
  // Category entry: end the current conversation, then send the first message on the fresh session
  // (passed explicitly because setState from resetChat hasn't been applied yet).
  const chatNew = (label: string) => {
    const fresh = resetChat();
    setInput(''); setAttachments([]); setComparisonId(null);
    navigate('chat');
    send(label === '부모님' ? '부모님' : `${label} 선물을 찾고 있어요`, 'typed', fresh);
  };
  const submitComposer = () => {
    if (chatPending || (!input.trim() && attachments.length === 0)) return;
    if (attachments.length) {
      setMessages(old => [...old, { role: 'user', text: `첨부: ${attachments.join(' · ')}` }, { role: 'assistant', text: '첨부를 확인했어요. 받는 분과 예산을 알려주시면 선물을 골라볼게요. 첨부 파일 내용은 분석하지 않아요.' }]);
      setAttachments([]);
    }
    if (input.trim()) send(input);
  };
  const onComposerKeyPress = (e: any) => {
    const ev = e.nativeEvent ?? {};
    if (ev.key !== 'Enter' || ev.shiftKey) return;
    if (ev.isComposing || ev.keyCode === 229) return; // Korean IME composition in progress
    if (Platform.OS === 'web') e.preventDefault?.(); // keep Enter from inserting a newline
    submitComposer();
  };
  const changeBudget = (a: any) => {
    void changeChatConditions(a.patch, `예산을 ${won(a.amount)}으로 변경해줘.`, false).then(ok => { if (ok) setComparisonId(null); });
  };
  const voteButtons = (gift: Gift, rank: number, product?: EngineProduct, reason?: string) => {
    const mine = cardFeedback.find(entry => entry.giftId === gift.id && entry.kind === 'gift_preference' &&
      JSON.stringify(feedbackContext(session.state, entry.context?.scope)) === JSON.stringify(entry.context));
    const productKey = product ? productFeedbackKey(product) : mine?.productKey;
    return ([true, false] as const).map(helpful => {
      const Icon = helpful ? ThumbsUp : ThumbsDown;
      const selected = mine?.helpful === helpful;
      return (
        <Pressable
          key={String(helpful)}
          accessibilityRole="button"
          accessibilityLabel={`${gift.name} 이 상황에 ${helpful ? '좋아요' : '아쉬워요'}`}
          disabled={chatPending || !productKey}
          accessibilityState={{ selected }}
          {...(Platform.OS === 'web' ? { 'aria-pressed': selected } : {})}
          onPress={() => rateCard({ giftId: gift.id, productKey, rank, helpful, reason: reason ?? mine?.reason ?? '', kind: 'gift_preference' })}
          style={[s.cardRateButton, !productKey && s.unavailableVote]}
        >
          <Icon size={18} color={selected ? c.primary : c.muted} fill={selected ? c.primary : 'none'} />
        </Pressable>
      );
    });
  };
  const cards = (gifts: Gift[], ranked = false, rateable = false) =>
    gifts.map((g, i) => (
      <GiftCard
        key={g.id}
        gift={g}
        rank={ranked ? i + 1 : undefined}
        saved={liked(g)}
        onSave={() => save(g)}
        onOpen={() => open(g)}
        actions={rateable ? voteButtons(g, i + 1, catalogProducts.find(product => product.id === g.id)) : undefined}
      />
    ));
  const tiles = (gifts: Gift[]) => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.horizontal}
    >
      {gifts.map((g) => (
        <Tile key={g.id} gift={g} onOpen={() => open(g)} saved={liked(g)} onSave={() => save(g)} />
      ))}
    </ScrollView>
  );
  const ranked = useMemo(() => selectGifts(catalogProducts, { recipient, search, filter, priceLimit, sort }),
    [catalogProducts, recipient, search, filter, priceLimit, sort]);
  const sweetnessLabel: Record<string, string> = { unsweetened: '단맛 없음', naturally_sweet: '자연 단맛', sweet: '단맛 있음' };
  const demoValue = (field: string, text: string) => (detail?.demoFields?.includes(field) ? `${text} · 데모 값` : text);
  const info =
    detail?.source === 'engine'
      ? [
          ...(detail.brand ? [['브랜드', detail.brand]] : []),
          ...(detail.nameEn ? [['원제품명', detail.nameEn]] : []),
          ...(detail.sweetness && detail.sweetness !== 'unknown' ? [['단맛', sweetnessLabel[detail.sweetness] ?? detail.sweetness]] : []),
          ['알레르기', detail.allergensDeclared?.length ? `${detail.allergensDeclared.join(', ')} 포함 (상품명 기준 추정)` : '상품명에 표시된 알레르기 성분 없음 · 구매 전 성분표 확인'],
          ['포장', demoValue('packaging', detail.packaging || '기본 포장')],
          ['배송', demoValue('arrival_days', `도착 예정 ${detail.arrival}`)],
          ['배송비', demoValue('shipping_fee_krw', detail.shippingIncluded ? '표시 금액에 포함' : '상품값에서 별도')],
          ['구매', 'PASS에서는 구매할 수 없어요'],
        ]
      : [
          ['배송', '무료배송 · 2–3일 내 출고 (데모)'],
          ['포장', '프리미엄 선물 박스 기본 포함 (데모)'],
          ['교환·반품', '수령 후 7일 이내 가능 (데모)'],
          ['원산지', '국내산 (데모 정보)'],
        ];
  if (!ready || (detailPage && !detail))
    return (
      <View style={s.loading}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom', 'left', 'right']}>
      <StatusBar style="dark" />
      {catalogError ? (
        <Pressable accessibilityRole="button" onPress={retryCatalog} style={s.catalogBanner}>
          <Text style={s.catalogBannerText}>상품 정보를 불러오지 못했어요 · 다시 시도</Text>
        </Pressable>
      ) : null}
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {notice !== '' && (
          <Text accessibilityRole="alert" style={s.note}>
            {notice}
          </Text>
        )}
        {!!conditionMigrationNotice && <View><Text style={s.note}>{conditionMigrationNotice}</Text><Pressable accessibilityRole="button" onPress={dismissMigrationNotice}><Text style={s.note}>확인</Text></Pressable></View>}
        {syncFailed && <Pressable accessibilityRole="button" onPress={retrySave}><Text style={s.note}>기록 저장 다시 시도</Text></Pressable>}
        {detail ? (
          <>
            <ScrollView style={s.flex} contentContainerStyle={s.bottom}>
              <View style={s.hero}>
                {detail.image && !heroFailed ? (
                  <Image
                    accessibilityLabel={detail.name}
                    source={{ uri: detail.image }}
                    style={s.heroImage}
                    resizeMode="cover"
                    onError={() => setHeroFailed(true)}
                  />
                ) : (
                  <View style={s.heroPlaceholder}>
                    {heroFailed ? (
                      <Text style={s.subtitle}>사진을 불러오지 못했어요</Text>
                    ) : (
                      <GiftImage gift={detail} size={160} />
                    )}
                  </View>
                )}
                <View style={s.heroTop}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="상세 닫기"
                    onPress={() => setDetail(null)}
                    style={s.circle}
                  >
                    <ArrowLeft size={18} color={c.text} />
                  </Pressable>
                  <View style={s.row}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="상세 찜 토글"
                      accessibilityState={{ selected: liked(detail) }}
                      onPress={() => save(detail)}
                      style={s.circle}
                    >
                      <Heart
                        size={18}
                        color={liked(detail) ? c.primary : c.text}
                        fill={liked(detail) ? c.primary : 'none'}
                      />
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="선물 공유"
                      onPress={() => {
                        Share.share({
                          message: `PASS 데모 선물: ${detail.name} · ${won(detail.price)}\n${detail.description}\n실제 판매 상품 정보가 아닙니다.`,
                        }).catch(() => setNotice('공유를 열지 못했어요.'));
                      }}
                      style={s.circle}
                    >
                      <Share2 size={18} color={c.text} />
                    </Pressable>
                  </View>
                </View>
                <View style={s.heroTag}>
                  <Text style={s.small}>{detail.category}</Text>
                </View>
              </View>
              <View style={s.detailBody}>
                {detail.rating && (
                  <View style={s.row}>
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Star
                        key={i}
                        size={14}
                        color="#F59E0B"
                        fill={
                          i <= Math.round(detail.rating!) ? '#F59E0B' : 'none'
                        }
                      />
                    ))}
                    <Text style={s.small}>{detail.rating}{detail.source === 'engine' ? (detail.ratingCount ? ` · 리뷰 ${detail.ratingCount.toLocaleString('ko-KR')}개` : '') : ' · 데모 평점'}</Text>
                  </View>
                )}
                <Text style={s.title}>{detail.name}</Text>
                <Text style={s.subtitle}>{detail.description}</Text>
                <Text style={s.detailPrice}>{won(detail.price)}</Text>
                <View style={s.divider} />
                <Text style={s.sectionTitle}>상품 정보</Text>
                {info.map(([label, value]) => (
                  <View key={label} style={s.infoRow}>
                    <Text style={[s.small, s.infoLabel]}>{label}</Text>
                    <Text style={[s.small, s.flex]}>{value}</Text>
                  </View>
                ))}
                {detail.likeCount !== undefined && (
                  <View style={s.banner}>
                    <Heart size={16} color={c.primary} fill={c.primary} />
                    <Text style={[s.small, s.flex]}>
                      {detail.likeCount.toLocaleString()}명이 선택한 선물 · 데모
                      데이터
                    </Text>
                  </View>
                )}
                {detail.link && (
                  <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(detail.link!)}>
                    <Text style={s.sourceLink}>{detail.id.startsWith('searchapi-') ? '원본 상품 보기' : 'Amazon에서 보기'}</Text>
                  </Pressable>
                )}
                <Text style={s.small}>
                  {detail.id.startsWith('searchapi-') ? '국내 쇼핑 검색 결과의 상품 정보예요. 실제 가격과 배송비는 판매처에서 확인해 주세요.' : detail.source === 'engine'
                    ? '상품 정보: Kaggle Amazon Products Dataset (Lokesh Parab), CC BY-NC 4.0. 가격·배송은 데모 값이에요.'
                    : '상품·가격·평점은 프로토타입용 정보예요. 실제 구매는 제공하지 않아요.'}
                </Text>
              </View>
            </ScrollView>
            <View style={s.detailActions}>
              <View style={s.flex}>
                <Button
                  label="선물하기"
                  onPress={() =>
                    router.push('/gift-confirm')
                  }
                />
              </View>
              <Button
                label={liked(detail) ? '찜 해제' : '찜하기'}
                onPress={() => save(detail)}
              />
            </View>
          </>
        ) : resultsOpen ? (
          <>
            <View style={s.header}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="대화로 돌아가기"
                onPress={() => setResultsOpen(false)}
                style={s.iconButton}
              >
                <ArrowLeft size={24} color={c.text} />
              </Pressable>
              <Text style={[s.title, s.flex]}>AI 추천 결과</Text>
            </View>
            <ScrollView style={s.flex} contentContainerStyle={s.bottom}>
              <Text style={s.note}>
                {session.state.recipients.join(' · ')} · 선물 하나{' '}
                {won(session.state.budget.amount_krw || 0)} 이하
              </Text>
              <Text style={s.note}>
                {question.key ? question.text : result.message}
              </Text>
              {!question.key && cards(result.items.map(toGift), true)}
              {!question.key && conditionComparisonEnabled && (
                <View style={s.comparison}>
                  <Text style={s.sectionTitle}>조건을 바꿔보면?</Text>
                  <Text style={s.subtitle}>{comparison.message}</Text>
                  {comparison.alternatives.map((a: any) => (
                    <View key={a.id} style={s.comparisonItem}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ expanded: comparisonId === a.id }}
                        onPress={() =>
                          setComparisonId(comparisonId === a.id ? null : a.id)
                        }
                        style={s.comparisonToggle}
                      >
                        <Text style={[s.small, s.flex]}>
                          예산을 {won(a.delta)} 올리면
                        </Text>
                        <ChevronDown size={18} color={c.primary} />
                      </Pressable>
                      {comparisonId === a.id && (
                        <View style={s.comparisonBody}>
                          <Text style={s.sectionTitle}>
                            {won(a.amount - a.delta)} → {won(a.amount)}
                          </Text>
                          <Text style={s.subtitle}>{a.effectText}</Text>
                          <Text style={s.small}>
                            새 후보: {a.target.name.replace('가상 ', '')} · 전체
                            후보 중 {a.targetRank}위
                          </Text>
                          <Text style={s.small}>
                            {a.exclusionReason.replaceAll(
                              '세트당 예산',
                              '선물 하나 예산',
                            )}
                          </Text>
                          <Text style={s.small}>{a.rankingReason}</Text>
                          <Button
                            label={`예산 ${won(a.amount)}으로 적용`}
                            onPress={() => changeBudget(a)}
                          />
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>
          </>
        ) : (
          <>
            {screen === 'home' ? (
              <ScrollView style={s.flex} contentContainerStyle={s.bottom}>
                <View style={s.homeHeader}>
                  <View style={s.brand}>
                    <View style={s.brandIcon}>
                      <GiftIcon size={16} color={c.white} />
                    </View>
                    <Text style={s.logo}>PASS</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={loggedIn ? '마이 페이지 열기' : '로그인하기'}
                    onPress={() => loggedIn ? navigate('mypage') : router.push('/login')}
                    style={s.profile}
                  >
                    <User size={18} color={c.muted} />
                  </Pressable>
                </View>
                <View style={s.greeting}>
                  <Text style={s.subtitle}>안녕하세요 👋</Text>
                  <Text style={s.headline}>
                    오늘은 어떤 선물을{'\n'}찾고 계신가요?
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => chat()}
                    style={s.button}
                  >
                    <Sparkles size={16} color={c.white} />
                    <Text style={s.buttonText}>AI 선물 추천받기</Text>
                  </Pressable>
                </View>
                {upcomingEvents.length > 0 && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="다가오는 이벤트, 캘린더 열기"
                    onPress={() => navigate('calendar')}
                    style={s.eventBanner}
                  >
                    <Text style={s.eventBannerEmoji}>{eventKindMeta[upcomingEvents[0].kind].emoji}</Text>
                    <View style={s.flex}>
                      <Text style={s.eventBannerText}>
                        {upcomingEvents.length === 1
                          ? `${upcomingEvents[0].title} ${eventKindMeta[upcomingEvents[0].kind].label}이 ${ddayLabel(daysUntil(upcomingEvents[0].date))} 남았어요`
                          : `다가오는 이벤트가 ${upcomingEvents.length}개 있어요`}
                      </Text>
                    </View>
                    <ChevronRight size={18} color={c.primary} />
                  </Pressable>
                )}
                <View style={s.homeSection}>
                  <SectionHeader title="선물 카테고리" />
                  <View style={s.categoryGrid}>
                    {homeCategories.map(({ label, Icon }) => (
                      <Pressable
                        key={label}
                        accessibilityRole="button"
                        accessibilityLabel={`${label} 선물 상담`}
                        onPress={() => chatNew(label)}
                        style={s.category}
                      >
                        <View style={s.categoryIcon}>
                          <Icon size={22} strokeWidth={1.6} color={c.text} />
                        </View>
                        <Text style={s.categoryLabel}>{label}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
                <View style={s.homeSection}>
                  <SectionHeader
                    title="인기 선물"
                    onMore={() => navigate('ranking')}
                  />
                  {tiles(popularGifts)}
                </View>
                <View style={s.homeSection}>
                  <SectionHeader
                    title="최근 본 선물"
                    onMore={() => {
                      navigate('mypage');
                      setAllRecent(true);
                    }}
                  />
                  {recent.length ? (
                    tiles(recent.slice(0, 5))
                  ) : (
                    <Text style={s.empty}>
                      상품을 살펴보면 여기에 기록돼요.
                    </Text>
                  )}
                </View>
              </ScrollView>
            ) : screen === 'ranking' ? (
              <>
                <View style={s.pageHeading}>
                  <Text accessibilityRole="header" style={s.pageTitle}>선물 랭킹</Text>
                  <Text style={s.subtitle}>받는 분과 예산에 맞는 인기 선물을 찾아보세요.</Text>
                </View>
                <ScrollView
                  style={s.flex}
                  contentContainerStyle={s.bottom}
                  keyboardShouldPersistTaps="handled"
                >
                  <View style={s.rankingToolbar}>
                    <View style={[s.searchField, s.flex]}>
                      <SearchIcon />
                      <TextInput
                        accessibilityLabel="선물 이름 검색"
                        value={search}
                        onChangeText={setSearch}
                        placeholder="상품명이나 브랜드 검색"
                        placeholderTextColor={c.muted}
                        style={[s.searchText, s.flex]}
                      />
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => { setDraftFilter(filter); setDraftSort(sort); setDraftPrice(priceLimit); setShowFilter(true); }}
                      style={[s.filterButton, (filter !== '전체' || priceLimit !== null) && s.filterActive]}
                    >
                      <FilterIcon />
                      <Text style={s.actionText}>필터</Text>
                    </Pressable>
                  </View>
                  {(filter !== '전체' || priceLimit !== null) && (
                    <View style={s.appliedFilters}>
                      {filter !== '전체' && <Chip label={`${filter} ×`} onPress={() => setFilter('전체')} />}
                      {priceLimit !== null && <Chip label={`${won(priceLimit)} 이하 ×`} onPress={() => setPriceLimit(null)} />}
                    </View>
                  )}
                  <View style={s.segment}>
                    {Object.keys(rankingByRecipient).map((label) => (
                      <Pressable
                        key={label}
                        accessibilityRole="button"
                        accessibilityState={{ selected: recipient === label }}
                        onPress={() => setRecipient(label)}
                        style={[
                          s.segmentItem,
                          recipient === label && s.segmentSelected,
                        ]}
                      >
                        <Text
                          style={[s.segmentText, recipient === label && s.bold]}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <View style={s.sectionHeader}>
                    <View style={s.flex}>
                      <Text style={s.sectionTitle}>{search.trim() ? '검색 결과' : recipient === '전체' ? '인기 선물' : `${recipient} 선물`}</Text>
                      {sort === '인기순' && <Text style={s.small}>카테고리별 리뷰 수 기준</Text>}
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`정렬: ${sort}. 눌러 변경`}
                      onPress={() =>
                        setSort(
                          sort === '인기순'
                            ? '낮은 가격순'
                            : sort === '낮은 가격순'
                              ? '높은 가격순'
                              : '인기순',
                        )
                      }
                      style={s.sort}
                    >
                      <Text style={s.small}>{sort}</Text>
                      <ChevronDown size={18} color={c.muted} />
                    </Pressable>
                  </View>
                  {cards(ranked, true)}
                  {!ranked.length && (
                    <View style={s.emptyCard}>
                      <Text style={s.subtitle}>검색 조건에 맞는 선물이 없어요.</Text>
                      <Pressable accessibilityRole="button" style={s.sort} onPress={() => { setSearch(''); setRecipient('전체'); setFilter('전체'); setPriceLimit(null); }}>
                        <Text style={s.actionText}>검색 조건 초기화</Text>
                      </Pressable>
                    </View>
                  )}
                </ScrollView>
              </>
            ) : screen === 'chat' ? (
              <>
                <View style={s.chatHeader}>
                  <View style={s.brandIcon}>
                    <GiftIcon size={20} color={c.white} />
                  </View>
                  <View style={s.flex}>
                    <Text style={s.sectionTitle}>선물AI</Text>
                    <Text style={s.small}>특별한 순간을 위한 선물 이야기</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      resetChat();
                      setInput('');
                      setComparisonId(null);
                      setAttachments([]);
                    }}
                    style={s.reset}
                  >
                    <Text style={s.small}>새 대화</Text>
                  </Pressable>
                </View>
                <ChatTools conditions={session.state} onVoice={setInput} pending={chatPending} requestError={chatError} onApply={async (patch) => {
                  const applied = await changeChatConditions(patch, '추천 조건을 변경했어요.');
                  if (applied) setComparisonId(null);
                  return applied;
                }} />
                <ScrollView
                  ref={chatRef}
                  style={s.flex}
                  contentContainerStyle={s.chat}
                  onContentSizeChange={() =>
                    chatRef.current?.scrollToEnd({ animated: true })
                  }
                  keyboardShouldPersistTaps="handled"
                >
                  <Text style={s.assistant}>
                    선물을 함께 골라볼게요. 누구에게 드릴 선물인가요?
                  </Text>
                  {!!chatError && <Text accessibilityRole="alert" style={s.note}>{chatError}</Text>}
                  {messages.map((m, i) => (
                    <Text
                      key={i}
                      style={m.role === 'user' ? s.user : s.assistant}
                    >
                      {m.text}
                    </Text>
                  ))}
                  {!!restoredRecommendations?.length && (
                    <View>
                      <SectionHeader title="이전 추천 상품" />
                      {cards(restoredRecommendations, true, true)}
                    </View>
                  )}
                  {restoredRecommendations === null && !question.key && result.items.length === 0 && result.status !== 'reference' && <View style={s.noMatches}>
                    <Text style={s.sectionTitle}>조건에 맞는 선물이 아직 없어요</Text><Text style={s.small}>{result.message}</Text>
                    <Button label="예산을 직접 입력하기" onPress={() => {
                      if (!input.trim()) setInput('예산을 ');
                      inputRef.current?.focus();
                    }}/>
                    <Button label="상품 종류를 바꿔 입력하기" onPress={() => {
                      setNotice('예: “차로 바꿔줘”처럼 입력해주세요. 제외 조건은 그대로 유지해요.');
                      inputRef.current?.focus();
                    }}/>
                  </View>}
                  {restoredRecommendations === null && !question.key && result.items.length > 0 && (
                    <>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chatCards}>
                        {result.items.map((p: any, i: number) => {
                          const g = toGift(p);
                          const reason = cardReason(p, session.state);
                          return <View key={g.id} style={s.chatCard}>
                            <View style={s.chatCardHero}>
                              <GiftImage gift={g}/>
                              <Text style={s.rankBadge}>{i + 1}순위</Text>
                              <View style={s.cardRate}>{voteButtons(g, i + 1, p, reason)}</View>
                            </View>
                            <View style={s.chatCardBody}><Text numberOfLines={2} style={s.sectionTitle}>{g.name}</Text><Text style={s.chatCardPrice}>{won(g.price)}</Text><Text style={s.small}>{g.shippingIncluded ? '배송비 포함' : '상품값 기준'}</Text>
                              <Text numberOfLines={2} style={s.cardReason}>{reason}</Text>
                              <Button label="자세히 보기" onPress={() => open(g)}/>
                            </View>
                          </View>;
                        })}
                      </ScrollView>
                    </>
                  )}
                  {!surveyRecording && agentMode === 'langgraph-advisors' && recommendation?.agents && recommendation.key === JSON.stringify(session) && (
                    <View style={s.advisorPanel}>
                      <AgentPanel
                        agents={recommendation.agents}
                        disabled={disabledAdvisors}
                        busy={chatPending}
                        onToggle={toggleAdvisor}
                        onSuggest={(patch, label) => void changeChatConditions(patch as Parameters<typeof changeChatConditions>[0], `${label}로 바꿔줘.`)}
                      />
                    </View>
                  )}
                  {chatPending && <ChatPendingIndicator />}
                </ScrollView>
                <View style={s.inputArea}>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={s.chips}
                  >
                    {question.choices.map((choice: string) => (
                      <Chip
                        key={choice}
                        label={choice}
                        onPress={() => send(choice, 'quick_reply')}
                      />
                    ))}
                  </ScrollView>
                  {attachments.length > 0 && <View style={s.attachmentRow}>{attachments.map(name => <Pressable key={name} accessibilityRole="button" accessibilityLabel={`${name} 첨부 제거`} onPress={() => setAttachments(old => old.filter(item => item !== name))} style={s.attachmentChip}><Text style={s.small}>{name} ×</Text></Pressable>)}</View>}
                  {!surveyRecording && <AgentModeControl value={agentMode} onChange={changeAgentMode} disabled={chatPending} connected={agentConnected} />}
                  <View style={s.composer}>
                    <AttachmentPicker onSelect={name => setAttachments(old => [...new Set([...old, name])])}/>
                    <View style={[s.inputShell, composerFocused && s.inputShellFocused]}>
                    <TextInput
                      ref={inputRef}
                      accessibilityLabel="선물 조건 입력"
                      value={input}
                      onChangeText={setInput}
                      onFocus={() => setComposerFocused(true)}
                      onBlur={() => setComposerFocused(false)}
                      underlineColorAndroid="transparent"
                      onKeyPress={onComposerKeyPress}
                      editable={!chatPending}
                      placeholder={chatPending ? '보내는 중…' : '받는 분, 예산을 말해 주세요'}
                      maxLength={1200}
                      multiline
                      style={[s.input, s.flex, chatPending && s.inputDisabled]}
                    />
                    <ChatTools mode="voice" conditions={session.state} onVoice={setInput} />
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="메시지 보내기"
                      disabled={chatPending || (!input.trim() && attachments.length === 0)}
                      onPress={submitComposer}
                      style={[s.send, !input.trim() && attachments.length === 0 && s.disabled]}
                    >
                      <ArrowUp size={22} color={input.trim() || attachments.length ? c.white : c.muted} />
                    </Pressable>
                  </View>
                </View>
              </>
            ) : screen === 'calendar' ? (
              <CalendarScreen
                events={events}
                ready={eventsReady}
                loadError={calendarLoadError}
                onRetry={retryCalendarLoad}
                onAdd={addEvent}
                onRemove={removeEvent}
              />
            ) : (
              <ScrollView style={s.flex} contentContainerStyle={s.bottom}>
                <View style={s.pageHeading}>
                  <Text accessibilityRole="header" style={s.pageTitle}>마이페이지</Text>
                </View>
                <View style={s.myIntro}>
                  <View style={s.row}>
                    <View style={s.featureIcon}><User size={22} color={c.primary} /></View>
                    <View style={s.flex}>
                      <Text style={s.sectionTitle}>{loggedIn ? (user?.email ?? '로그인한 사용자') : '게스트'}</Text>
                      <Text style={s.small}>
                        {loggedIn ? '선물 기록과 대화는 계정에 저장돼요.' : '찜과 최근 본 선물은 이 기기에 저장돼요.'}
                      </Text>
                    </View>
                  </View>
                  <Pressable accessibilityRole="button" style={s.button} onPress={() => router.push(loggedIn ? '/account' : '/login')}>
                    {!loggedIn && <LogIn size={16} color={c.white} />}
                    <Text style={s.buttonText}>{loggedIn ? '계정과 선물 기록' : '로그인하기'}</Text>
                  </Pressable>
                  {!loggedIn && (
                    <Pressable accessibilityRole="button" onPress={() => router.push('/account')} style={s.recordLink}>
                      <Clock3 size={16} color={c.muted} />
                      <Text style={[s.small, s.flex]}>이 기기의 선물 준비 기록</Text>
                      <ChevronRight size={16} color={c.muted} />
                    </Pressable>
                  )}
                </View>
                <View style={s.accountSection}>
                  <SectionHeader
                    title={`찜한 선물 ${saved.length}개`}
                    onMore={saved.length > 5 ? () => setAllSaved((v) => !v) : undefined}
                    moreLabel={allSaved ? '접기' : '더보기'}
                  />
                  {saved.length ? (
                    allSaved ? (
                      cards(saved)
                    ) : (
                      tiles(saved.slice(0, 5))
                    )
                  ) : (
                    <Text style={s.empty}>
                      마음에 드는 선물의 하트를 눌러보세요.
                    </Text>
                  )}
                </View>
                <View style={s.accountSection}>
                  <SectionHeader
                    title={`최근 본 선물 ${recent.length}개`}
                    onMore={recent.length > 5 ? () => setAllRecent((v) => !v) : undefined}
                    moreLabel={allRecent ? '접기' : '더보기'}
                  />
                  {recent.length ? (
                    allRecent ? (
                      cards(recent)
                    ) : (
                      tiles(recent.slice(0, 5))
                    )
                  ) : (
                    <Text style={s.empty}>아직 살펴본 선물이 없어요.</Text>
                  )}
                </View>
                <View style={s.accountSection}>
                  <PastChats
                    chats={pastChats}
                    feedbackEnabled={feedbackEnabled}
                    feedbackToggleDisabled={feedbackToggleDisabled}
                    onFeedbackChange={changeFeedbackEnabled}
                    busy={chatPending}
                    open={async chat => {
                      await resumePastChat(chat);
                      setComparisonId(null);
                      setAttachments([]);
                      navigate('chat');
                    }}
                    remove={loggedIn ? deletePastChat : undefined}
                  />
                </View>
                <View style={s.accountSection}>
                  <SectionHeader title="도움말" />
                  <Text style={s.help}>
                    실제 결제·배송 기능은 준비 중입니다. {loggedIn ? '로그인은 연결되어 있으며, 대화(최근 30개)와 선물 기록은 계정에서 복원돼요.' : '게스트 대화는 새 대화를 시작하면 이 기기의 지난 대화에 남고(최대 30개), 찜과 최근 본 선물은 기기에 남아요.'}
                  </Text>
                </View>
              </ScrollView>
            )}
            <View style={s.navigation}>
              {nav.map(({ key, label, Icon }) => (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: screen === key }}
                  onPress={() => navigate(key)}
                  style={s.navItem}
                >
                  <Icon
                    size={20}
                    color={screen === key ? c.primary : c.muted}
                  />
                  <Text style={[s.navText, screen === key && s.active]}>
                    {label}
                  </Text>
                  {screen === key && <View style={s.navIndicator} />}
                </Pressable>
              ))}
            </View>
          </>
        )}
      </KeyboardAvoidingView>
      <Modal
        visible={showFilter && activeScreen === 'ranking'}
        transparent
        animationType="slide"
        onRequestClose={() => setShowFilter(false)}
      >
        <View style={s.overlay}>
          <View style={s.sheet}>
            <View style={s.row}><Text style={[s.title,s.flex]}>필터</Text><Pressable accessibilityRole="button" accessibilityLabel="필터 닫기" onPress={() => setShowFilter(false)} style={s.iconButton}><Text style={s.sectionTitle}>×</Text></Pressable></View>
            <ScrollView contentContainerStyle={{ gap: 16 }} keyboardShouldPersistTaps="handled">
            <Text style={s.sectionTitle}>정렬</Text><View style={s.filterChoices}>{['인기순', '낮은 가격순', '높은 가격순'].map(label => <Chip key={label} label={label} selected={draftSort === label} onPress={() => setDraftSort(label)}/>)}</View>
            <Text style={s.sectionTitle}>가격</Text><View style={s.filterChoices}>{[{ label: '전체', value: null }, { label: '3만 원 이하', value: 30000 }, { label: '5만 원 이하', value: 50000 }, { label: '10만 원 이하', value: 100000 }].map(item => <Chip key={item.label} label={item.label} selected={draftPrice === item.value} onPress={() => setDraftPrice(item.value)}/>)}</View>
            <Text style={s.sectionTitle}>상품군</Text>
            <View>
              <View style={s.filterChoices}>
                {[
                  '전체',
                  ...new Set(
                    Object.values(rankingByRecipient)
                      .flat()
                      .map((g) => g.category),
                  ),
                ].map((label) => (
                  <Chip
                    key={label}
                    label={label}
                    selected={draftFilter === label}
                    onPress={() => setDraftFilter(label)}
                  />
                ))}
              </View>
            </View>
            </ScrollView>
            <View style={s.row}>
              <Pressable accessibilityRole="button" style={s.filterReset} onPress={() => { setDraftFilter('전체'); setDraftPrice(null); setDraftSort('인기순'); }}>
                <Text style={s.actionText}>초기화</Text>
              </Pressable>
              <View style={s.flex}>
                <Button label="필터 적용" onPress={() => { setFilter(draftFilter); setSort(draftSort); setPriceLimit(draftPrice); setShowFilter(false); }} />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
export function usePassContext() {
  const state = useContext(PassContext);
  if (!state) throw new Error('PassProvider is required');
  return state;
}
function usePassState() {
  const { user } = useAuth();
  const owner = user?.id;
  const [catalog, setCatalog] = useState<{ products: EngineProduct[]; error: string }>({ products: [], error: productRepository ? '' : '상품 서버 설정이 필요해요.' });
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  useEffect(() => {
    if (!productRepository) return;
    let live = true;
    productRepository.load().then(
      products => { if (live) setCatalog({ products, error: '' }); },
      (error: Error) => { if (live) setCatalog(old => ({ ...old, error: error.message })); },
    );
    return () => { live = false; };
  }, [catalogAttempt]);
  // Feedback the ranking uses: past chats plus this chat's taps, snapshotted per request so cards don't jump mid-tap.
  const [rankingSignal, setRankingSignal] = useState<FeedbackSignal[]>([]);
  const rankingSignalRef = useRef<FeedbackSignal[]>([]);
  const pastFeedback = useRef<CardFeedback[]>([]);
  const guestSession = useRef(randomUUID());
  const [feedbackEnabled, setFeedbackEnabled] = useState(true);
  const feedbackEnabledRef = useRef(true);
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [pastChats, setPastChats] = useState<PastChat[]>([]);
  const [chatRecommendations, setChatRecommendations] = useState<Gift[]>();
  const [restoredRecommendations, setRestoredRecommendations] = useState<Gift[] | null>(null);
  const resumedGuestId = useRef<string | null>(null);
  const deletedPastChats = useRef(new Set<string>());
  const chatService = useMemo(() => createLocalChatService(catalog.products, () => feedbackEnabledRef.current ? rankingSignalRef.current : [], () => guestSession.current), [catalog.products]);
  const rankingByRecipient = useMemo(() => rankGifts(catalog.products), [catalog.products]);
  const cloud = useRef<ReturnType<typeof createCloudRecords> | null>(null);
  const persistence = useRef(createSnapshotPersistence());
  const saveRevision = useRef(0);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [calendarLoadAttempt, setCalendarLoadAttempt] = useState(0);
  const [calendarLoadError, setCalendarLoadError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [conditionMigrationNotice, setConditionMigrationNotice] = useState('');
  const [syncFailed, setSyncFailed] = useState(false);
  const [saveAttempt, setSaveAttempt] = useState(0);
  const [screen, setScreen] = useState<Screen>('home'),
    [detail, setDetail] = useState<Gift | null>(null),
    [saved, setSaved] = useState<Gift[]>([]),
    [recent, setRecent] = useState<Gift[]>([]),
    [events, setEvents] = useState<CalendarEvent[]>([]),
    [eventsReady, setEventsReady] = useState(false),
    [ready, setReady] = useState(false),
    [notice, setNotice] = useState(''),
    [heroFailed, setHeroFailed] = useState(false);
  const [recipient, setRecipient] = useState('전체'),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('전체'),
    [showFilter, setShowFilter] = useState(false),
    [sort, setSort] = useState('인기순');
  const [session, setSession] = useState<ChatSession>(() => chatService.createSession()),
    [messages, setMessages] = useState<ChatMessage[]>([]),
    [input, setInput] = useState(''),
    [comparisonId, setComparisonId] = useState<string | null>(null),
    [allSaved, setAllSaved] = useState(false),
    [allRecent, setAllRecent] = useState(false);
  const serverChat = useMemo(() => owner && supabase && chatEndpoint ? createServerChatService(chatEndpoint, supabase.auth, owner, fetch, () => feedbackEnabledRef.current ? rankingSignalRef.current : [], () => guestSession.current) : null, [owner]);
  const [recommendation, setRecommendation] = useState<{ key: string; view: ReturnType<typeof chatService.view>; agentMode: ChatAgentMode; mode: string } | null>(null);
  const [chatPending, setChatPending] = useState(false);
  const [agentMode, setAgentMode] = useState<ChatAgentMode>('a-router');
  const [chatError, setChatError] = useState(chatConfigurationError);
  const [cardFeedback, setCardFeedback] = useState<CardFeedback[]>([]);
  const cardFeedbackRef = useRef<CardFeedback[]>([]);
  const chatFlight = useRef<{ revision: number; controller: AbortController | null }>({ revision: 0, controller: null });
  const changeAgentMode = useCallback((next: ChatAgentMode) => {
    if (chatFlight.current.controller) return;
    setAgentMode(next);
    setChatError('');
  }, []);
  useEffect(() => () => { chatFlight.current.revision++; chatFlight.current.controller?.abort(); }, []);
  const runChat = async (operation: 'turn' | 'conditions' | 'view', text: string, patch?: Parameters<typeof chatService.updateConditions>[1], clearIssues = true, source: 'typed' | 'quick_reply' = 'typed', fresh?: ChatSession) => {
    if (!ready || chatFlight.current.controller) return false;
    if (owner && chatConfigurationError) { setChatError(chatConfigurationError); return false; }
    const controller = new AbortController();
    const revision = ++chatFlight.current.revision;
    chatFlight.current.controller = controller; setChatPending(true); setChatError('');
    refreshSignal();
    try {
      // `fresh` is a just-reset session whose state hasn't rendered yet; use it instead of the stale closure.
      const baseSession = fresh ?? session, baseMessages = fresh ? [] : messages;
      const noHistory = emptyPersonalization();
      const requestSession = operation === 'turn' ? personalizeSession(baseSession, noHistory, text).session
        : operation === 'conditions' && patch?.recipients ? personalizeSession(baseSession, noHistory, '', patch.recipients).session
          : baseSession;
      const requestPatch = patch?.recipients ? { ...patch, recipients: requestSession.state.recipients } : patch;
      const turn = serverChat
        ? operation === 'turn' ? await serverChat.send(requestSession, text, requestSession.state.recipients.join() === baseSession.state.recipients.join() ? baseMessages : [], source, controller.signal, agentMode)
          : operation === 'conditions' ? await serverChat.updateConditions(requestSession, requestPatch!, clearIssues, controller.signal, agentMode)
          : await serverChat.view(baseSession, controller.signal, agentMode)
        : operation === 'turn' ? await chatService.send(requestSession, text, baseMessages) : chatService.updateConditions(requestSession, requestPatch ?? {}, clearIssues);
      assertSameRecipient(requestSession, turn.session);
      // A newer revision (new chat / another send) superseded this one; drop the result without
      // treating it as a failure, so the caller doesn't restore this request's stale draft text.
      if (chatFlight.current.revision !== revision) return null;
      setRestoredRecommendations(null);
      if (operation === 'view' && JSON.stringify(turn.session) !== JSON.stringify(baseSession)) setSession(turn.session);
      if (operation !== 'view') {
        const result = 'view' in turn ? turn.view.result : chatService.view(turn.session).result;
        if (result.items.length) {
          setChatRecommendations(result.items.slice(0, HISTORY_RECOMMENDATION_LIMIT)
            .map(product => chatService.toGift(product, turn.session.state)));
        }
        setSession(turn.session);
        setMessages(old => [...old, { role: 'user', text: text.trim() }, { role: 'assistant', text: turn.message }]);
      }
      if ('view' in turn) setRecommendation({ key: JSON.stringify(turn.session), view: turn.view, agentMode, mode: turn.mode });
      return true;
    } catch (error) {
      if (chatFlight.current.revision !== revision) return null;
      setChatError((error as Error).message || '추천 요청에 실패했어요. 다시 보내주세요.');
      return false;
    } finally {
      if (chatFlight.current.revision === revision) { chatFlight.current.controller = null; setChatPending(false); }
    }
  };
  const changeFeedbackEnabled = async (enabled: boolean) => {
    if (chatFlight.current.controller || feedbackSaving || feedbackEnabledRef.current === enabled) return;
    feedbackEnabledRef.current = enabled;
    setFeedbackEnabled(enabled);
    setFeedbackSaving(true);
    setRecommendation(null);
    if (serverChat) void runChat('view', '');
    try {
      await feedbackPreference.save(owner, enabled);
    } catch {
      setNotice('피드백 반영 설정을 기기에 저장하지 못했어요.');
    } finally {
      setFeedbackSaving(false);
    }
  };
  useEffect(() => {
    if (ready && restoredRecommendations === null && serverChat && recommendation?.key !== JSON.stringify(session) && !chatFlight.current.controller) void runChat('view', '');
    // Hydrate server ranking once after restoration; successful turns already include it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, serverChat]);
  // Account: the in-memory list is stamped with the conversation id inside cloudRecords. Guest: the
  // device log is keyed by a per-chat session id. Neither path runs on every tap; see the scheduler.
  const saveFeedbackNow = useCallback(() => {
    const resumedId = resumedGuestId.current;
    const task = cloud.current ? cloud.current.saveFeedback() : resumedId
      ? historyRepository.saveFeedback(resumedId, cardFeedbackRef.current)
      : feedbackRepository.save(guestSession.current, cardFeedbackRef.current);
    return task.catch(() => { setNotice(user ? '계정에 피드백을 저장하지 못했어요.' : '기기에 피드백을 저장하지 못했어요.'); });
  }, [user]);
  // The scheduler is created once and always calls the latest save closure through this ref.
  const feedbackFlush = useRef<() => Promise<void> | void>(() => {});
  feedbackFlush.current = saveFeedbackNow;
  const feedbackScheduler = useRef<ReturnType<typeof createFeedbackScheduler> | null>(null);
  feedbackScheduler.current ??= createFeedbackScheduler({ flush: () => feedbackFlush.current() });
  useEffect(() => () => feedbackScheduler.current?.cancel(), []);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') void feedbackScheduler.current?.flushNow(); });
    return () => subscription.remove();
  }, []);
  const rateCard = ({ productKey, ...card }: { giftId: string; productKey?: string; rank: number; helpful: boolean; reason: string; kind?: 'gift_preference' | 'reason_helpfulness' }) => {
    const displayed = recommendation?.key === JSON.stringify(session) ? recommendation : null;
    if (chatPending) return;
    const context = feedbackContext(session.state, guestSession.current);
    if (card.kind === 'gift_preference' && (!productKey || !context)) return;
    const entry: CardFeedback = {
      ...card,
      version: 2,
      kind: card.kind ?? 'reason_helpfulness',
      ...(card.kind === 'gift_preference' && context ? { context, productKey } : {}),
      conversationId: cloud.current ? '' : guestSession.current,
      agentMode: displayed?.agentMode ?? 'local',
      engineMode: displayed?.mode ?? 'local',
      at: new Date().toISOString(),
    };
    const next = toggleFeedback(cardFeedbackRef.current, entry);
    cardFeedbackRef.current = next; setCardFeedback(next);
    cloud.current?.setFeedback(next);
    feedbackScheduler.current?.schedule();
  };
  const refreshSignal = (past = pastFeedback.current) => {
    const next = rankingFeedback(past, cardFeedbackRef.current);
    if (JSON.stringify(next) === JSON.stringify(rankingSignalRef.current)) return;
    rankingSignalRef.current = next; setRankingSignal(next);
  };
  const archiveCurrentChat = (activeId: string | null) => {
    // Save the ending conversation's feedback first; the save is queued before anything for the new chat.
    void feedbackScheduler.current?.flushNow();
    // The ending chat becomes history: its feedback now counts as past, and guests archive it on the device.
    if (messages.length) {
      const id = activeId ?? resumedGuestId.current ?? guestSession.current;
      const feedback = stampConversation(cardFeedbackRef.current, id);
      pastFeedback.current = [...pastFeedback.current, ...feedback];
      const ended: PastChat = { id, at: new Date().toISOString(), title: chatTitle(messages), recipients: session.state.recipients, messages: cloud.current ? null : messages, feedback, recommendations: chatRecommendations, session };
      setPastChats(old => [ended, ...old.filter(c => c.id !== ended.id)].slice(0, 30));
      if (!cloud.current) historyRepository.archive(ended).catch(() => setNotice('기기에 지난 대화를 저장하지 못했어요.'));
    }
  };
  const resetChat = () => {
    archiveCurrentChat(cloud.current?.currentId() ?? null);
    resumedGuestId.current = null; setRestoredRecommendations(null);
    cardFeedbackRef.current = []; setCardFeedback([]); cloud.current?.setFeedback([]); guestSession.current = randomUUID();
    chatFlight.current.revision++; chatFlight.current.controller?.abort(); chatFlight.current.controller = null;
    setChatPending(false); setChatError(''); setRecommendation(null); setChatRecommendations(undefined);
    const next = chatService.createSession();
    setSession(next); setMessages([]);
    return next;
  };
  const resumePastChat = async (chat: PastChat) => {
    if (!ready || chatFlight.current.controller) throw new Error('현재 요청을 마친 후 다시 시도해주세요.');
    const controller = new AbortController();
    const revision = ++chatFlight.current.revision;
    chatFlight.current.controller = controller; setChatPending(true);
    const repository = cloud.current;
    let activeId = repository?.currentId() ?? null;
    try {
      await feedbackScheduler.current?.flushNow();
      if (repository && messages.length) await repository.saveChat(session, messages, chatRecommendations);
      activeId = repository?.currentId() ?? activeId;
      const detail = repository ? await repository.resumeConversation(chat.id, controller.signal)
        : { messages: chat.messages ?? [], recommendations: chat.recommendations ?? [], session: chat.session, feedback: chat.feedback };
      const restored = await restoreHistorySession(detail, chatService);
      if (controller.signal.aborted || chatFlight.current.revision !== revision) throw new Error('대화 불러오기가 취소됐어요.');
      archiveCurrentChat(activeId);
      const storedFeedback = detail.feedback ?? chat.feedback;
      guestSession.current = storedFeedback.findLast(f => f.kind === 'gift_preference')?.context?.scope ?? (repository ? randomUUID() : chat.id);
      const feedback = stampConversation(storedFeedback, repository ? '' : guestSession.current);
      resumedGuestId.current = repository ? null : chat.id;
      cardFeedbackRef.current = feedback; setCardFeedback(feedback);
      repository?.setFeedback(feedback);
      setPastChats(old => old.filter(item => item.id !== chat.id));
      pastFeedback.current = pastFeedback.current.filter(item => item.conversationId !== chat.id);
      refreshSignal();
      setSession(restored); setMessages(detail.messages); setInput('');
      setChatRecommendations(detail.recommendations); setRestoredRecommendations(detail.recommendations.length ? detail.recommendations : null);
      setNotice(!detail.recommendations.length && !chatService.view(restored).question.key
        ? '저장된 추천 상품이 없어 이전 대화의 조건으로 다시 추천해요.'
        : '');
      setRecommendation(null); setChatError('');
      persistence.current.restoreKey('chat', JSON.stringify({ session: restored, messages: detail.messages, recommendations: detail.recommendations }));
    } finally {
      if (chatFlight.current.revision === revision) { chatFlight.current.controller = null; setChatPending(false); }
    }
  };
  useEffect(() => {
    let mounted = true;
    const repository = owner && supabase ? createCloudRecords(supabase, owner, randomUUID) : null;
    cloud.current = repository;
    setLoadError('');
    const emptySession = chatService.createSession();
    const restore = repository ? repository.load(emptySession) : giftRepository.load().then(records => ({ ...records, session: emptySession, messages: [] as ChatMessage[] }));
    Promise.all([restore, feedbackPreference.load(owner).catch(() => true)]).then(([records, enabled]) => {
      if (!mounted) return;
      feedbackEnabledRef.current = enabled; setFeedbackEnabled(enabled);
      setSaved(records.saved); setRecent(records.recent);
      if ('migrationNotice' in records && records.migrationNotice) setConditionMigrationNotice(String(records.migrationNotice));
      setSession(records.session); setMessages(records.messages);
      if ('recommendations' in records && Array.isArray(records.recommendations)) { setChatRecommendations(records.recommendations); setRestoredRecommendations(records.recommendations.length ? records.recommendations : null); }
      const restored = 'feedback' in records && Array.isArray(records.feedback) ? stampConversation(records.feedback as CardFeedback[], '') : [];
      cardFeedbackRef.current = restored; setCardFeedback(restored);
      guestSession.current = restored.findLast(f => f.kind === 'gift_preference')?.context?.scope ?? randomUUID();
      // History never blocks the chat: a failed load only hides mypage history and past-feedback weights.
      const currentId = repository?.currentId();
      const history = repository ? repository.listConversations().then(list => ({ list: list.filter(c => c.id !== currentId), logged: [] as CardFeedback[] }))
        : Promise.all([historyRepository.load(), feedbackRepository.load()]).then(([list, logged]) => ({ list, logged: logged.filter(f => !list.some(c => c.id === f.conversationId)) }));
      history.then(({ list, logged }) => {
        if (!mounted) return;
        const remaining = list.filter(chat => !deletedPastChats.current.has(chat.id));
        setPastChats(current => [...current, ...remaining.filter(chat => !current.some(shown => shown.id === chat.id))].slice(0, 30));
        const localIds = new Set(pastFeedback.current.map(item => item.conversationId));
        pastFeedback.current = [...remaining.filter(chat => !localIds.has(chat.id)).flatMap(chat => chat.feedback), ...logged, ...pastFeedback.current];
        refreshSignal();
      }).catch(() => { if (mounted) setNotice('지난 대화를 불러오지 못했어요.'); });
      persistence.current.restore({ gifts: JSON.stringify({ saved: records.saved, recent: records.recent }), chat: JSON.stringify({ session: records.session, messages: records.messages }) });
      if ('failed' in records && Array.isArray(records.failed) && records.failed.length) setNotice('기기에 저장한 기록 일부를 불러오지 못했어요.');
      setReady(true);
    }).catch(() => { if (mounted) setLoadError('계정 기록을 불러오지 못했어요. 연결을 확인하고 다시 시도해주세요.'); });
    return () => { mounted = false; repository?.close(); if (cloud.current === repository) cloud.current = null; };
  }, [owner, loadAttempt]);
  useEffect(() => {
    if (!ready) return;
    let mounted = true;
    const revision = ++saveRevision.current;
    const gifts = JSON.stringify({ saved, recent });
    const chat = JSON.stringify({ session, messages, recommendations: chatRecommendations });
    const tasks: Promise<void>[] = [];
    const giftWrite = persistence.current.write('gifts', gifts, () => cloud.current ? cloud.current.saveGifts({ saved, recent }) : giftRepository.save({ saved, recent }));
    if (giftWrite) tasks.push(giftWrite);
    if (cloud.current) {
      const chatWrite = persistence.current.write('chat', chat, () => cloud.current!.saveChat(session, messages, chatRecommendations));
      if (chatWrite) tasks.push(chatWrite);
    }
    if (!cloud.current && resumedGuestId.current) {
      const id = resumedGuestId.current;
      const chatWrite = persistence.current.write('chat', chat, () => historyRepository.archive({ id, at: new Date().toISOString(), title: chatTitle(messages), recipients: session.state.recipients, session, messages, recommendations: chatRecommendations, feedback: stampConversation(cardFeedbackRef.current, id) }));
      if (chatWrite) tasks.push(chatWrite);
    }
    if (tasks.length) Promise.all(tasks).then(() => {
      if (mounted && revision === saveRevision.current) { setSyncFailed(false); setNotice(''); }
    }).catch(() => {
      if (mounted && revision === saveRevision.current) { setSyncFailed(true); setNotice(user ? '계정에 기록을 저장하지 못했어요. 다시 시도해주세요.' : '기기에 기록을 저장하지 못했어요.'); }
    });
    return () => { mounted = false; };
  }, [saved, recent, session, messages, chatRecommendations, ready, saveAttempt, user]);
  useEffect(() => {
    // Calendar events are device-local only (not part of the account sync above),
    // so they load and save independently of login state.
    let mounted = true;
    calendarRepository.load().then(list => {
      if (mounted) { setEvents(list); setEventsReady(true); setCalendarLoadError(''); }
    }).catch(() => {
      if (mounted) setCalendarLoadError('기기 일정을 불러오지 못했어요. 다시 시도해주세요.');
    });
    return () => { mounted = false; };
  }, [calendarLoadAttempt]);
  useEffect(() => {
    if (!eventsReady) return;
    calendarRepository.save(events).catch(() => {
      setNotice('기기에 일정을 저장하지 못했어요.');
    });
  }, [events, eventsReady]);

  return {
    screen,
    setScreen,
    detail,
    setDetail,
    saved,
    setSaved,
    recent,
    setRecent,
    events,
    setEvents,
    eventsReady,
    calendarLoadError,
    retryCalendarLoad: () => setCalendarLoadAttempt(value => value + 1),
    ready,
    notice,
    conditionMigrationNotice,
    dismissMigrationNotice: () => setConditionMigrationNotice(''),
    setNotice,
    syncFailed,
    retrySave: () => { persistence.current.retry(); setSaveAttempt(value => value + 1); },
    recommendation,
    chatPending,
    agentMode,
    changeAgentMode,
    agentConnected: Boolean(serverChat),
    chatError,
    sendChat: (text: string, source: 'typed' | 'quick_reply' = 'typed', fresh?: ChatSession) => runChat('turn', text, undefined, true, source, fresh),
    changeChatConditions: (patch: Parameters<typeof chatService.updateConditions>[1], text: string, clearIssues = true) => runChat('conditions', text, patch, clearIssues),
    resetChat,
    cardFeedback,
    rateCard,
    feedbackEnabled,
    feedbackToggleDisabled: chatPending || feedbackSaving,
    changeFeedbackEnabled,
    pastChats,
    rankingSignal,
    resumePastChat,
    restoredRecommendations,
    deletePastChat: async (id: string) => {
      const repository = cloud.current;
      if (!repository) return;
      await repository.deleteConversation(id);
      if (cloud.current !== repository) return;
      deletedPastChats.current.add(id);
      setPastChats(current => current.filter(chat => chat.id !== id));
      pastFeedback.current = pastFeedback.current.filter(item => item.conversationId !== id);
      refreshSignal();
    },
    loadError,
    retryLoad: () => setLoadAttempt(value => value + 1),
    chatService,
    rankingByRecipient,
    catalogProducts: catalog.products,
    popularGifts: rankingByRecipient['전체'].slice(0, 10),
    catalogError: catalog.error,
    retryCatalog: () => setCatalogAttempt(value => value + 1),
    heroFailed,
    setHeroFailed,
    recipient,
    setRecipient,
    search,
    setSearch,
    filter,
    setFilter,
    showFilter,
    setShowFilter,
    sort,
    setSort,
    session,
    setSession,
    messages,
    setMessages,
    input,
    setInput,
    comparisonId,
    setComparisonId,
    allSaved,
    setAllSaved,
    allRecent,
    setAllRecent,
  };
}
const PassContext = createContext<ReturnType<typeof usePassState> | null>(null);
export function PassProvider({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return <View style={s.loading}><ActivityIndicator color={c.primary} /></View>;
  return <AccountPassProvider key={user?.id ?? 'guest'}>{children}</AccountPassProvider>;
}
function AccountPassProvider({ children }: { children: React.ReactNode }) {
  const value = usePassState();
  const productImages = useMemo(() => new Map(value.catalogProducts
    .filter(product => Boolean(product.image))
    .map(product => [product.id, product.image!])), [value.catalogProducts]);
  const { service } = useAuth();
  const [loaded, error] = useFonts({
    NotoSansKR_400Regular,
    NotoSansKR_500Medium,
    NotoSansKR_700Bold,
  });
  if (!loaded && !error)
    return (
      <View style={s.loading}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  if (value.loadError) return <View style={s.loading}><Text accessibilityRole="alert" style={s.note}>{value.loadError}</Text><Pressable accessibilityRole="button" onPress={value.retryLoad}><Text style={s.note}>기록 다시 불러오기</Text></Pressable><Pressable accessibilityRole="button" onPress={() => { void service.signOut().catch(() => value.retryLoad()); }}><Text style={s.note}>로그아웃</Text></Pressable></View>;
  return (
    <SafeAreaProvider>
      <PassContext.Provider value={value}><ProductImagesContext.Provider value={productImages}>{children}</ProductImagesContext.Provider></PassContext.Provider>
    </SafeAreaProvider>
  );
}
const s = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: c.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bottom: { paddingBottom: 24 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  header: {
    height: 56,
    paddingLeft: 16,
    paddingRight: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: { fontFamily: f.bold, fontSize: 22, lineHeight: 31, color: c.text },
  pageHeading: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 14, gap: 2 },
  pageTitle: { fontFamily: f.bold, fontSize: 27, lineHeight: 37, color: c.text },
  actionText: { color: c.primary, fontFamily: f.bold, fontSize: 13 },
  featureIcon: { width: 44, height: 44, backgroundColor: c.tint, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: {
    marginHorizontal: 16,
    marginBottom: 8,
    fontFamily: f.regular,
    fontSize: 13,
    lineHeight: 19,
    color: c.muted,
  },
  small: {
    fontFamily: f.regular,
    fontSize: 12,
    lineHeight: 18,
    color: c.muted,
  },
  subtitle: {
    fontFamily: f.regular,
    fontSize: 14,
    lineHeight: 22,
    color: c.muted,
  },
  bold: { fontFamily: f.bold, color: c.text },
  sectionTitle: {
    fontFamily: f.bold,
    fontSize: 17,
    lineHeight: 24,
    color: c.text,
  },
  empty: {
    paddingHorizontal: 20,
    paddingVertical: 20,
    fontFamily: f.regular,
    fontSize: 14,
    lineHeight: 22,
    color: c.muted,
  },
  button: {
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: c.primary,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontFamily: f.bold, fontSize: 14, color: c.white },
  disabled: { backgroundColor: c.segment },
  horizontal: { paddingHorizontal: 20, gap: 12 },
  sourceLink: { color: c.primary, fontFamily: f.medium, fontSize: 14, paddingVertical: 8 },
  catalogBanner: { backgroundColor: '#FEF2F2', paddingVertical: 8, paddingHorizontal: 16 },
  catalogBannerText: { color: '#B91C1C', fontFamily: f.medium, fontSize: 13, textAlign: 'center' },
  homeHeader: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    backgroundColor: c.white,
    borderBottomWidth: 1,
    borderColor: c.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.primary,
    borderRadius: 12,
  },
  logo: { fontFamily: f.bold, fontSize: 20, letterSpacing: 2, color: c.text },
  profile: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.segment,
  },
  greeting: {
    paddingHorizontal: 20,
    paddingVertical: 24,
    backgroundColor: c.white,
  },
  headline: {
    fontFamily: f.bold,
    fontSize: 24,
    lineHeight: 32,
    color: c.text,
    marginTop: 4,
    marginBottom: 20,
  },
  homeSection: {
    backgroundColor: c.white,
    paddingTop: 20,
    paddingBottom: 20,
    marginTop: 8,
  },
  eventBanner: {
    marginHorizontal: 20,
    marginTop: 4,
    marginBottom: 8,
    padding: 14,
    borderRadius: 16,
    backgroundColor: c.tint,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  eventBannerEmoji: { fontSize: 20 },
  eventBannerText: { fontFamily: f.medium, fontSize: 14, color: c.text },
  categoryGrid: {
    paddingHorizontal: 20,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  category: {
    width: '22%',
    flexGrow: 1,
    flexBasis: '20%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    backgroundColor: c.segment,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 12,
  },
  categoryIcon: { height: 30, justifyContent: 'center' },
  categoryLabel: { fontFamily: f.medium, fontSize: 12, color: c.text },
  accountSection: {
    backgroundColor: c.white,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: c.border,
    marginHorizontal: 16,
    marginTop: 14,
    paddingVertical: 14,
  },
  segment: {
    marginHorizontal: 16,
    marginBottom: 10,
    minHeight: 48,
    backgroundColor: c.segment,
    borderRadius: 12,
    padding: 3,
    flexDirection: 'row',
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  segmentSelected: { backgroundColor: c.tint, borderWidth: 1, borderColor: c.primary },
  segmentText: { fontFamily: f.medium, fontSize: 14, color: c.muted },
  sectionHeader: {
    marginHorizontal: 16,
    marginTop: 9,
    marginBottom: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sort: { minHeight: 44, flexDirection: 'row', gap: 4, alignItems: 'center' },
  rankingToolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 10 },
  searchField: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, minHeight: 48, borderWidth: 1, borderColor: c.border, borderRadius: 12, backgroundColor: c.white },
  searchText: { minWidth: 0, minHeight: 44, color: c.text, fontFamily: f.regular, fontSize: 14 },
  filterButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: c.border, borderRadius: 12, backgroundColor: c.white },
  filterReset: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 16, borderWidth: 1, borderColor: c.border, borderRadius: 12 },
  filterActive: { backgroundColor: c.tint, borderColor: c.primary },
  appliedFilters: { flexWrap: 'wrap', flexDirection: 'row', gap: 6, marginHorizontal: 16, marginBottom: 10 },
  emptyCard: { backgroundColor: c.white, borderWidth: 1, borderColor: c.border, borderRadius: 16, alignItems: 'center', padding: 14, marginHorizontal: 16 },
  navigation: {
    flexDirection: 'row',
    backgroundColor: c.white,
    borderTopWidth: 1,
    borderColor: c.border,
  },
  navItem: {
    flex: 1,
    minHeight: 68,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  navText: { fontFamily: f.medium, fontSize: 12, color: c.muted },
  active: { color: c.primary },
  navIndicator: {
    position: 'absolute',
    bottom: 0,
    width: 32,
    height: 2,
    backgroundColor: c.primary,
    borderRadius: 2,
  },
  chatHeader: {
    ...(Platform.OS === 'web' ? { userSelect: 'none' } : {}),
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: c.white,
    borderBottomWidth: 1,
    borderColor: c.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  chat: { paddingVertical: 16, gap: 16 },
  assistant: {
    marginHorizontal: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    borderTopLeftRadius: 4,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.white,
    color: c.text,
    fontFamily: f.regular,
    fontSize: 14,
    lineHeight: 23,
  },
  user: {
    alignSelf: 'flex-end',
    maxWidth: '80%',
    marginHorizontal: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    borderTopRightRadius: 4,
    backgroundColor: c.primary,
    color: c.white,
    fontFamily: f.regular,
    fontSize: 14,
    lineHeight: 23,
  },
  inputArea: {
    backgroundColor: c.background,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderColor: c.border,
  },
  chips: {
    paddingHorizontal: 16,
    gap: 8,
    ...(Platform.OS === 'web' ? { userSelect: 'none' } : {}),
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
  },
  input: {
    backgroundColor: c.white,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: c.text,
    fontFamily: f.regular,
    fontSize: 14,
    ...(Platform.OS === 'web' ? { outlineStyle: 'solid' as const, outlineWidth: 0, outlineColor: 'transparent' } : {}),
    maxHeight: 120,
    minHeight: 44,
  },
  inputDisabled: { color: c.muted },
  send: {
    width: 44,
    height: 44,
    borderRadius: 24,
    backgroundColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  reset: { padding: 8, minHeight: 44, justifyContent: 'center' },
  conditionStrip: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: c.tint,
  },
  attach: { width: 40, height: 44, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: c.segment, flexShrink: 0 },
  inputShell: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', backgroundColor: c.white, borderWidth: 1, borderColor: c.border, borderRadius: 26, overflow: 'hidden' },
  inputShellFocused: { borderColor: c.primary },
  attachmentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 8 },
  attachmentChip: { borderWidth: 1, borderColor: c.border, backgroundColor: c.white, borderRadius: 12, padding: 10 },
  noMatches: { marginHorizontal: 16, padding: 16, backgroundColor: c.white, borderRadius: 16, gap: 12 },
  chatCards: { paddingHorizontal: 16, gap: 12, alignItems: 'stretch' },
  chatCard: { width: 248, backgroundColor: c.white, borderWidth: 1, borderColor: c.border, borderRadius: 16, overflow: 'hidden' },
  chatCardHero: { height: 92, backgroundColor: c.image, alignItems: 'center', justifyContent: 'center' },
  rankBadge: { position: 'absolute', top: 8, left: 8, backgroundColor: c.primary, color: c.white, fontFamily: f.bold, fontSize: 12, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  cardRate: { position: 'absolute', top: 2, right: 4 },
  unavailableVote: { opacity: 0.45 },
  cardRateButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  chatCardBody: { padding: 14, gap: 8 },
  cardReason: { fontSize: 12, color: c.muted },
  chatCardPrice: { fontFamily: f.bold, fontSize: 20, color: c.text },
  hero: { height: 256, backgroundColor: c.image },
  heroImage: { width: '100%', height: 256 },
  heroPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heroTop: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  circle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFFE0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTag: {
    position: 'absolute',
    bottom: 12,
    left: 16,
    backgroundColor: '#FAF8F4EE',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  detailBody: { padding: 20, gap: 12 },
  detailPrice: {
    fontFamily: f.bold,
    fontSize: 24,
    color: c.primary,
    marginVertical: 4,
  },
  divider: { height: 1, backgroundColor: c.border, marginVertical: 8 },
  infoRow: { flexDirection: 'row', gap: 16 },
  infoLabel: { width: 64 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
    borderRadius: 12,
    backgroundColor: c.segment,
  },
  detailActions: {
    backgroundColor: c.white,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderColor: c.border,
    flexDirection: 'row',
    gap: 12,
  },
  myIntro: { marginHorizontal: 16, padding: 14, gap: 12, backgroundColor: c.white, borderColor: c.border, borderWidth: 1, borderRadius: 20 },
  recordLink: { flexDirection: 'row', minHeight: 44, gap: 8, alignItems: 'center', paddingHorizontal: 10, borderRadius: 11, backgroundColor: c.background },
  help: {
    paddingHorizontal: 20,
    fontFamily: f.regular,
    fontSize: 13,
    lineHeight: 22,
    color: c.muted,
  },
  comparison: {
    margin: 16,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.white,
    gap: 12,
  },
  comparisonItem: { borderTopWidth: 1, borderColor: c.border },
  comparisonToggle: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  comparisonBody: { gap: 12, paddingBottom: 12 },
  overlay: {
    flex: 1,
    backgroundColor: '#00000055',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '90%',
    backgroundColor: c.white,
    padding: 24,
    paddingBottom: 40,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    gap: 16,
  },
  filterChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterScroll: { maxHeight: 320 },
});
