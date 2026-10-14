import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useMemo,
  useState,
} from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
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
  ArrowLeftRight,
  Star,
  Calendar as CalendarIcon,
  X,
} from 'lucide-react-native';
import SearchIcon from './assets/figma/search.svg';
import FilterIcon from './assets/figma/filter.svg';
import { colors as c, fonts as f } from './src/theme';
import { ChatTools } from './src/ChatTools';
import { AttachmentPicker } from './src/AttachmentPicker';
import { PersonalizationPanel } from './src/PersonalizationPanel';
import { usePersonalization } from './src/usePersonalization';
import { personalizeSession, protectRememberedAllergies, assertSameRecipient } from './src/services/personalization';
import { useAuth } from './src/auth/AuthProvider';
import { Gift, categories, rankGifts, selectGifts } from './src/catalog';
import { giftRepository, productRepository, calendarRepository } from './src/services/localServices';
import { createLocalChatService } from './src/services/chatService';
import { createCloudRecords } from './src/services/cloudRecords';
import { createSnapshotPersistence } from './src/services/snapshotPersistence';
import { supabase } from './src/auth/client';
import { randomUUID } from 'expo-crypto';
import { createServerChatService, resolveChatUrl } from './src/services/serverChatService';
import { daysUntil, sortByUpcoming, upcomingWithin, isValidMonthDay } from './src/services/calendarDates';
import type { ChatSession, ChatMessage, EngineProduct, CalendarEvent, CalendarEventKind } from './src/domain';
import { calendarEventKinds } from './src/domain';
import {
  Chip,
  GiftCard,
  GiftImage,
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
const nav = [
  { key: 'home', label: '홈', Icon: Home },
  { key: 'chat', label: 'AI 추천', Icon: Sparkles },
  { key: 'ranking', label: '선물 랭킹', Icon: Trophy },
  { key: 'calendar', label: '캘린더', Icon: CalendarIcon },
  { key: 'mypage', label: '마이페이지', Icon: User },
] as const;
const eventKindMeta: Record<CalendarEventKind, { label: string; emoji: string }> = {
  birthday: { label: '생일', emoji: '🎂' },
  anniversary: { label: '기념일', emoji: '💝' },
  etc: { label: '기타', emoji: '📌' },
};
const formatMonthDay = (date: string) => {
  const [month, day] = date.split('-');
  return `${Number(month)}월 ${Number(day)}일`;
};
const ddayLabel = (days: number) => (days === 0 ? 'D-day' : `D-${days}`);
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
}: {
  activeScreen?: Screen;
  detailPage?: boolean;
  resultPage?: boolean;
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
    chatError,
    sendChat,
    personalization,
    appliedMemory,
    changeChatConditions,
    resetChat,
    heroFailed,
    setHeroFailed,
    recipient,
    setRecipient,
    search,
    setSearch,
    showSearch,
    setShowSearch,
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
  const [eventTitle, setEventTitle] = useState('');
  const [eventMonth, setEventMonth] = useState('');
  const [eventDay, setEventDay] = useState('');
  const [eventKind, setEventKind] = useState<CalendarEventKind>('birthday');
  const [eventFormError, setEventFormError] = useState('');
  const submitEvent = () => {
    if (!eventsReady) return;
    const month = Number(eventMonth), day = Number(eventDay);
    if (!eventTitle.trim()) return setEventFormError('이름을 입력해주세요.');
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > 31)
      return setEventFormError('날짜를 월/일로 올바르게 입력해주세요.');
    const date = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (!isValidMonthDay(date)) return setEventFormError('존재하는 날짜를 입력해주세요.');
    addEvent(eventTitle, date, eventKind);
    setEventTitle(''); setEventMonth(''); setEventDay(''); setEventKind('birthday'); setEventFormError('');
  };
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
    if (open) router.push('/results');
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
    setShowSearch(false);
    setFilter('전체');
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
  const send = (text: string, source: 'typed' | 'quick_reply' = 'typed') => {
    if (!text.trim()) return;
    // Clear optimistically so a slow (e.g. LLM) round trip can't let further typing
    // pile onto the just-sent text; restore it only if the send actually fails.
    if (source === 'typed') setInput('');
    void sendChat(text, source).then(ok => {
      if (ok) setComparisonId(null);
      else if (ok === false && source === 'typed') setInput(text);
    });
  };
  const chat = (label?: string) => {
    navigate('chat');
    if (label)
      send(label === '부모님' ? '부모님' : `${label} 선물을 찾고 있어요`);
  };
  const changeBudget = (a: any) => {
    void changeChatConditions(a.patch, `예산을 ${won(a.amount)}으로 변경해줘.`, false).then(ok => { if (ok) setComparisonId(null); });
  };
  const cards = (gifts: Gift[], ranked = false) =>
    gifts.map((g, i) => (
      <GiftCard
        key={g.id}
        gift={g}
        rank={ranked ? i + 1 : undefined}
        saved={liked(g)}
        onSave={() => save(g)}
        onOpen={() => open(g)}
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
                    <Text style={s.sourceLink}>Amazon에서 보기</Text>
                  </Pressable>
                )}
                <Text style={s.small}>
                  {detail.source === 'engine'
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
              {!question.key && (
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
                    {categories.map((cat) => (
                      <Pressable
                        key={cat.label}
                        accessibilityRole="button"
                        accessibilityLabel={`${cat.label} 선물 상담`}
                        onPress={() => chat(cat.label)}
                        style={s.category}
                      >
                        <Text style={s.emoji}>{cat.emoji}</Text>
                        <Text style={s.categoryLabel}>{cat.label}</Text>
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
                  <Text style={s.demoNote}>
                    상품 정보: Kaggle Amazon Products Dataset (CC BY-NC 4.0) · 가격·배송은 데모 값이에요.
                  </Text>
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
                <View style={s.header}>
                  <Text style={[s.title, s.flex]}>선물 랭킹</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="선물 검색"
                    onPress={() => setShowSearch((v) => !v)}
                    style={s.iconButton}
                  >
                    <SearchIcon />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="상품군 필터"
                    onPress={() => { setDraftFilter(filter); setDraftSort(sort); setDraftPrice(priceLimit); setShowFilter(true); }}
                    style={s.iconButton}
                  >
                    <FilterIcon />
                  </Pressable>
                </View>
                <ScrollView
                  style={s.flex}
                  contentContainerStyle={s.bottom}
                  keyboardShouldPersistTaps="handled"
                >
                  <Text style={s.note}>
                    받는 분에게 어울리는 카테고리별 인기 상품이에요. 리뷰 수 기준이에요.
                  </Text>
                  {showSearch && (
                    <TextInput
                      accessibilityLabel="선물 이름 검색"
                      value={search}
                      onChangeText={setSearch}
                      placeholder="선물 이름 검색"
                      style={s.searchInput}
                      autoFocus
                    />
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
                    <Text style={s.sectionTitle}>{recipient} 인기 선물</Text>
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
                    <Text style={s.empty}>검색 조건에 맞는 선물이 없어요.</Text>
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
                <ChatTools conditions={session.state} onVoice={setInput} onApply={(patch) => {
                  void changeChatConditions(patch, '추천 조건을 변경했어요.').then(ok => { if (ok) setComparisonId(null); });
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
                  <Text style={s.demoNote}>
                    {chatPending ? '추천을 확인하고 있어요…' : recommendation?.mode === 'llm' ? '서버 AI 조건 해석 · Amazon 상품' : recommendation ? '서버 규칙 기반 해석 · Amazon 상품' : '기기 규칙 기반 해석 · Amazon 상품'}
                  </Text>
                  <Text style={s.assistant}>
                    선물을 함께 골라볼게요. 누구에게 드릴 선물인가요?
                  </Text>
                  <PersonalizationPanel store={personalization} conditions={session.state} issues={session.issues} recent={recent} applied={appliedMemory} chatPending={chatPending} />
                  {!!chatError && <Text accessibilityRole="alert" style={s.note}>{chatError}</Text>}
                  {messages.map((m, i) => (
                    <Text
                      key={i}
                      style={m.role === 'user' ? s.user : s.assistant}
                    >
                      {m.text}
                    </Text>
                  ))}
                  {!question.key && result.items.length === 0 && <View style={s.noMatches}>
                    <Text style={s.sectionTitle}>조건에 맞는 선물이 아직 없어요</Text><Text style={s.small}>{result.message}</Text>
                    <Button label="예산 5만 원으로 다시 찾기" onPress={() => changeBudget({ amount: 50000, patch: { budget: { amount_krw: 50000 } } })}/>
                    <Button label="제외 조건 풀어보기" onPress={() => {
                      void changeChatConditions({ excluded_categories: [], excluded_ingredients: [] }, '제외 조건을 풀어줘.');
                    }}/>
                  </View>}
                  {!question.key && result.items.length > 0 && (
                    <>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chatCards}>
                        {result.items.map((p: any, i: number) => {
                          const g = toGift(p);
                          return <View key={g.id} style={s.chatCard}>
                            <View style={s.chatCardHero}><GiftImage gift={g}/><Text style={s.rankBadge}>{i + 1}순위</Text>
                              <Pressable accessibilityRole="button" accessibilityLabel={`${g.name} ${liked(g) ? '찜 해제' : '찜하기'}`} onPress={() => save(g)} style={s.cardHeart}><Heart size={22} color={liked(g) ? c.primary : c.muted}/></Pressable>
                            </View>
                            <View style={s.chatCardBody}><Text numberOfLines={2} style={s.sectionTitle}>{g.name}</Text><Text style={s.chatCardPrice}>{won(g.price)}</Text><Text style={s.small}>{g.shippingIncluded ? '배송비 포함' : '상품값 기준'}</Text>
                              <Button label="자세히 보기" onPress={() => open(g)}/>
                            </View>
                          </View>;
                        })}
                      </ScrollView>
                      <View style={s.resultButton}>
                        <Pressable accessibilityRole="button" accessibilityLabel="조건을 바꾸면 추천이 어떻게 달라지는지 비교해보기" onPress={() => setResultsOpen(true)} style={s.compareButton}>
                          <View style={s.compareIcon}><ArrowLeftRight size={18} color={c.white}/></View>
                          <View style={s.flex}>
                            <Text style={s.compareTitle}>조건을 바꾸면 어떻게 달라질까요?</Text>
                            <Text style={s.compareSubtitle}>예산·조건별 추천 비교해보기</Text>
                          </View>
                          <ChevronRight size={20} color={c.primary}/>
                        </Pressable>
                      </View>
                    </>
                  )}
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
                  <View style={s.composer}>
                    <AttachmentPicker onSelect={name => setAttachments(old => [...new Set([...old, name])])}/>
                    <View style={s.inputShell}>
                    <TextInput
                      ref={inputRef}
                      accessibilityLabel="선물 조건 입력"
                      value={input}
                      onChangeText={setInput}
                      editable={!chatPending}
                      placeholder={chatPending ? '보내는 중…' : '받는 분, 예산을 말해 주세요'}
                      maxLength={1200}
                      multiline
                      style={[s.input, s.flex, chatPending && s.inputDisabled]}
                    />
                    <ChatTools mode="voice" conditions={session.state} onVoice={setInput} onApply={() => {}} />
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="메시지 보내기"
                      disabled={chatPending || (!input.trim() && attachments.length === 0)}
                      onPress={() => {
                        if (attachments.length) {
                          setMessages(old => [...old, { role: 'user', text: `첨부: ${attachments.join(' · ')}` }, { role: 'assistant', text: '첨부를 확인했어요. 받는 분과 예산을 알려주시면 선물을 골라볼게요. 첨부 파일 내용은 분석하지 않아요.' }]);
                          setAttachments([]);
                        }
                        if (input.trim()) send(input);
                      }}
                      style={[s.send, !input.trim() && attachments.length === 0 && s.disabled]}
                    >
                      <ArrowUp size={22} color={input.trim() || attachments.length ? c.white : c.muted} />
                    </Pressable>
                  </View>
                </View>
              </>
            ) : screen === 'calendar' ? (
              <ScrollView style={s.flex} contentContainerStyle={s.bottom} keyboardShouldPersistTaps="handled">
                <View style={s.header}>
                  <Text style={s.title}>캘린더</Text>
                </View>
                <Text style={[s.subtitle, s.eventIntro]}>
                  생일·기념일을 기록해두면 1주일 전부터 홈 화면에서 알려드려요. 2월 29일은 윤년에 알려드려요.
                </Text>
                <View style={s.homeSection}>
                  {!eventsReady && (calendarLoadError ? (
                    <View style={s.eventForm}>
                      <Text accessibilityRole="alert" style={s.small}>{calendarLoadError}</Text>
                      <Button label="일정 다시 불러오기" onPress={retryCalendarLoad} />
                    </View>
                  ) : <Text style={s.empty}>기기 일정을 불러오는 중이에요.</Text>)}
                  <SectionHeader title="이벤트 추가" />
                  <View style={s.eventForm}>
                    <TextInput
                      accessibilityLabel="이벤트 이름"
                      value={eventTitle}
                      onChangeText={(v) => { setEventTitle(v); setEventFormError(''); }}
                      placeholder="예: 엄마 생신"
                      style={s.eventInput}
                    />
                    <View style={s.eventFormRow}>
                      <TextInput
                        accessibilityLabel="월"
                        value={eventMonth}
                        onChangeText={(v) => { setEventMonth(v.replace(/\D/g, '').slice(0, 2)); setEventFormError(''); }}
                        placeholder="월"
                        keyboardType="numeric"
                        maxLength={2}
                        style={[s.eventInput, s.eventDateInput]}
                      />
                      <TextInput
                        accessibilityLabel="일"
                        value={eventDay}
                        onChangeText={(v) => { setEventDay(v.replace(/\D/g, '').slice(0, 2)); setEventFormError(''); }}
                        placeholder="일"
                        keyboardType="numeric"
                        maxLength={2}
                        style={[s.eventInput, s.eventDateInput]}
                      />
                      <View style={s.row}>
                        {calendarEventKinds.map((kind) => (
                          <Chip key={kind} label={eventKindMeta[kind].label} selected={eventKind === kind} onPress={() => setEventKind(kind)} />
                        ))}
                      </View>
                    </View>
                    {!!eventFormError && <Text accessibilityRole="alert" style={[s.small, s.eventError]}>{eventFormError}</Text>}
                    <Pressable accessibilityRole="button" disabled={!eventsReady} onPress={submitEvent} style={[s.button, !eventsReady && { opacity: 0.5 }]}>
                      <Text style={s.buttonText}>추가하기</Text>
                    </Pressable>
                  </View>
                </View>
                <View style={s.homeSection}>
                  <SectionHeader title={`이벤트 ${events.length}개`} />
                  {events.length ? (
                    sortByUpcoming(events).map((e) => (
                      <View key={e.id} style={s.eventRow}>
                        <Text style={s.eventBannerEmoji}>{eventKindMeta[e.kind].emoji}</Text>
                        <View style={s.flex}>
                          <Text style={s.eventName}>{e.title}</Text>
                          <Text style={s.small}>
                            {eventKindMeta[e.kind].label} · {formatMonthDay(e.date)} · {ddayLabel(daysUntil(e.date))}
                          </Text>
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${e.title} 삭제`}
                          onPress={() => removeEvent(e.id)}
                          style={s.eventDelete}
                        >
                          <X size={18} color={c.muted} />
                        </Pressable>
                      </View>
                    ))
                  ) : (
                    <Text style={s.empty}>{eventsReady ? '등록된 이벤트가 없어요.' : '일정을 불러온 후 표시합니다.'}</Text>
                  )}
                </View>
              </ScrollView>
            ) : (
              <ScrollView style={s.flex} contentContainerStyle={s.bottom}>
                <View style={s.header}>
                  <Text style={s.title}>마이 페이지</Text>
                </View>
                <View style={s.myIntro}>
                  <User size={32} color={c.primary} />
                  <Text style={s.sectionTitle}>{loggedIn ? (user?.email ?? '로그인한 사용자') : '로그인하면 이어서 볼 수 있어요'}</Text>
                  <Button label={loggedIn ? '계정과 선물 기록' : '로그인하기'} onPress={() => router.push(loggedIn ? '/account' : '/login')}/>
                  {!loggedIn && <Button label="이 기기의 선물 준비 기록" onPress={() => router.push('/account')}/> }
                  <Text style={s.subtitle}>
                    {loggedIn ? '찜·최근 본 선물과 대화는 계정에 저장돼요.' : '찜과 최근 본 선물은 이 기기에 저장돼요.'}
                  </Text>
                </View>
                <View style={s.homeSection}>
                  <SectionHeader
                    title={`찜한 선물 ${saved.length}개`}
                    onMore={() => setAllSaved((v) => !v)}
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
                <View style={s.homeSection}>
                  <SectionHeader
                    title={`최근 본 선물 ${recent.length}개`}
                    onMore={() => setAllRecent((v) => !v)}
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
                <View style={s.homeSection}>
                  <SectionHeader title="도움말" />
                  <Text style={s.help}>
                    랭킹과 대화 추천은 같은 상품 목록(Kaggle Amazon Products
                    Dataset, CC BY-NC 4.0)을 사용해요. 실제 결제·배송 기능은 준비
                    중입니다. {loggedIn ? '로그인은 연결되어 있으며, 마지막 대화와 선물 기록은 계정에서 복원돼요.' : '게스트 대화는 앱을 종료하면 사라지고, 찜과 최근 본 선물은 기기에 남아요.'}
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
            <View style={s.row}><Button label="초기화" onPress={() => { setDraftFilter('전체'); setDraftPrice(null); setDraftSort('인기순'); }}/><View style={s.flex}><Button label="필터 적용" onPress={() => { setFilter(draftFilter); setSort(draftSort); setPriceLimit(draftPrice); setShowFilter(false); }} /></View></View>
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
  const chatService = useMemo(() => createLocalChatService(catalog.products), [catalog.products]);
  const rankingByRecipient = useMemo(() => rankGifts(catalog.products), [catalog.products]);
  const personalization = usePersonalization(owner ?? null);
  const [appliedMemory, setAppliedMemory] = useState<string[]>([]);
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
    [showSearch, setShowSearch] = useState(false),
    [filter, setFilter] = useState('전체'),
    [showFilter, setShowFilter] = useState(false),
    [sort, setSort] = useState('인기순');
  const [session, setSession] = useState<ChatSession>(() => chatService.createSession()),
    [messages, setMessages] = useState<ChatMessage[]>([]),
    [input, setInput] = useState(''),
    [comparisonId, setComparisonId] = useState<string | null>(null),
    [allSaved, setAllSaved] = useState(false),
    [allRecent, setAllRecent] = useState(false);
  const serverChat = useMemo(() => owner && supabase && chatEndpoint ? createServerChatService(chatEndpoint, supabase.auth, owner) : null, [owner]);
  const [recommendation, setRecommendation] = useState<{ key: string; view: ReturnType<typeof chatService.view>; mode: string } | null>(null);
  const [chatPending, setChatPending] = useState(false);
  const [chatError, setChatError] = useState(chatConfigurationError);
  const chatFlight = useRef<{ revision: number; controller: AbortController | null }>({ revision: 0, controller: null });
  useEffect(() => () => { chatFlight.current.revision++; chatFlight.current.controller?.abort(); }, []);
  const runChat = async (operation: 'turn' | 'conditions' | 'view', text: string, patch?: Parameters<typeof chatService.updateConditions>[1], clearIssues = true, source: 'typed' | 'quick_reply' = 'typed') => {
    if (!personalization.ready) { setChatError(personalization.error || '개인화 기록을 불러오고 있어요. 잠시 후 다시 시도해주세요.'); return false; }
    if (!ready || personalization.busy || chatFlight.current.controller) return false;
    if (owner && chatConfigurationError) { setChatError(chatConfigurationError); return false; }
    const controller = new AbortController();
    const revision = ++chatFlight.current.revision;
    chatFlight.current.controller = controller; setChatPending(true); setChatError('');
    try {
      const recalled = operation === 'turn' ? personalizeSession(session, personalization.data, text)
        : operation === 'conditions' && patch?.recipients ? personalizeSession(session, personalization.data, '', patch.recipients)
          : { session, reasons: appliedMemory };
      const requestSession = recalled.session;
      const requestPatch = patch?.recipients ? { ...patch, recipients: requestSession.state.recipients } : patch;
      let turn = serverChat
        ? operation === 'turn' ? await serverChat.send(requestSession, text, requestSession.state.recipients.join() === session.state.recipients.join() ? messages : [], source, controller.signal)
          : operation === 'conditions' ? await serverChat.updateConditions(requestSession, requestPatch!, clearIssues, controller.signal)
          : await serverChat.view(session, controller.signal)
        : operation === 'turn' ? chatService.send(requestSession, text) : chatService.updateConditions(requestSession, requestPatch ?? {}, clearIssues);
      assertSameRecipient(requestSession, turn.session);
      const protectedSession = protectRememberedAllergies(turn.session, personalization.data);
      if (JSON.stringify(protectedSession) !== JSON.stringify(turn.session)) {
        const safe = serverChat
          ? await serverChat.updateConditions(turn.session, { recipients: protectedSession.state.recipients, excluded_ingredients: protectedSession.state.excluded_ingredients }, false, controller.signal)
          : chatService.updateConditions(turn.session, { recipients: protectedSession.state.recipients, excluded_ingredients: protectedSession.state.excluded_ingredients }, false);
        assertSameRecipient(requestSession, safe.session);
        if (JSON.stringify(protectRememberedAllergies(safe.session, personalization.data)) !== JSON.stringify(safe.session)) throw new Error('저장한 제외 조건을 적용하지 못했어요. 다시 시도해주세요.');
        turn = { ...safe, message: `저장한 알레르기 제외 조건을 유지했어요.\n${safe.message}` };
      }
      // A newer revision (new chat / another send) superseded this one; drop the result without
      // treating it as a failure, so the caller doesn't restore this request's stale draft text.
      if (chatFlight.current.revision !== revision) return null;
      if (operation === 'view' && JSON.stringify(turn.session) !== JSON.stringify(session)) setSession(turn.session);
      if (operation !== 'view') {
        setSession(turn.session);
        setAppliedMemory(recalled.reasons);
        setMessages(old => [...old, { role: 'user', text: text.trim() }, { role: 'assistant', text: [...recalled.reasons, turn.message].join('\n') }]);
      }
      if ('view' in turn) setRecommendation({ key: JSON.stringify(turn.session), view: turn.view, mode: turn.mode });
      return true;
    } catch (error) {
      if (chatFlight.current.revision !== revision) return null;
      setChatError((error as Error).message || '추천 요청에 실패했어요. 다시 보내주세요.');
      return false;
    } finally {
      if (chatFlight.current.revision === revision) { chatFlight.current.controller = null; setChatPending(false); }
    }
  };
  useEffect(() => {
    if (ready && serverChat && recommendation?.key !== JSON.stringify(session) && !chatFlight.current.controller) void runChat('view', '');
    // Hydrate server ranking once after restoration; successful turns already include it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, serverChat, personalization.ready]);
  const resetChat = () => {
    chatFlight.current.revision++; chatFlight.current.controller?.abort(); chatFlight.current.controller = null;
    setChatPending(false); setChatError(''); setRecommendation(null);
    setSession(chatService.createSession()); setMessages([]); setAppliedMemory([]);
  };
  useEffect(() => {
    let mounted = true;
    const repository = owner && supabase ? createCloudRecords(supabase, owner, randomUUID) : null;
    cloud.current = repository;
    setLoadError('');
    const emptySession = chatService.createSession();
    const restore = repository ? repository.load(emptySession) : giftRepository.load().then(records => ({ ...records, session: emptySession, messages: [] as ChatMessage[] }));
    restore.then(records => {
      if (!mounted) return;
      setSaved(records.saved); setRecent(records.recent);
      if ('migrationNotice' in records && records.migrationNotice) setConditionMigrationNotice(String(records.migrationNotice));
      setSession(records.session); setMessages(records.messages);
      persistence.current.restore({ gifts: JSON.stringify({ saved: records.saved, recent: records.recent }), chat: JSON.stringify({ session: records.session, messages: records.messages }) });
      if ('failed' in records && Array.isArray(records.failed) && records.failed.length) setNotice('기기에 저장한 기록 일부를 불러오지 못했어요.');
      setReady(true);
    }).catch(() => { if (mounted) setLoadError('계정 기록을 불러오지 못했어요. 연결을 확인하고 다시 시도해주세요.'); });
    return () => { mounted = false; repository?.close(); };
  }, [owner, loadAttempt]);
  useEffect(() => {
    if (!ready) return;
    let mounted = true;
    const revision = ++saveRevision.current;
    const gifts = JSON.stringify({ saved, recent });
    const chat = JSON.stringify({ session, messages });
    const tasks: Promise<void>[] = [];
    const giftWrite = persistence.current.write('gifts', gifts, () => cloud.current ? cloud.current.saveGifts({ saved, recent }) : giftRepository.save({ saved, recent }));
    if (giftWrite) tasks.push(giftWrite);
    if (cloud.current) {
      const chatWrite = persistence.current.write('chat', chat, () => cloud.current!.saveChat(session, messages));
      if (chatWrite) tasks.push(chatWrite);
    }
    if (tasks.length) Promise.all(tasks).then(() => {
      if (mounted && revision === saveRevision.current) { setSyncFailed(false); setNotice(''); }
    }).catch(() => {
      if (mounted && revision === saveRevision.current) { setSyncFailed(true); setNotice(user ? '계정에 기록을 저장하지 못했어요. 다시 시도해주세요.' : '기기에 기록을 저장하지 못했어요.'); }
    });
    return () => { mounted = false; };
  }, [saved, recent, session, messages, ready, saveAttempt, user]);
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
    chatError,
    personalization,
    appliedMemory,
    sendChat: (text: string, source: 'typed' | 'quick_reply' = 'typed') => runChat('turn', text, undefined, true, source),
    changeChatConditions: (patch: Parameters<typeof chatService.updateConditions>[1], text: string, clearIssues = true) => runChat('conditions', text, patch, clearIssues),
    resetChat,
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
    showSearch,
    setShowSearch,
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
      <PassContext.Provider value={value}>{children}</PassContext.Provider>
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
  demoNote: {
    fontFamily: f.regular,
    fontSize: 12,
    lineHeight: 18,
    color: c.muted,
    marginHorizontal: 20,
    marginTop: 12,
  },
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
  eventIntro: { paddingHorizontal: 20, paddingBottom: 4 },
  eventBannerEmoji: { fontSize: 20 },
  eventBannerText: { fontFamily: f.medium, fontSize: 14, color: c.text },
  eventForm: { marginHorizontal: 20, gap: 10 },
  eventFormRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  eventInput: {
    backgroundColor: c.white,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    color: c.text,
    fontFamily: f.regular,
    fontSize: 15,
  },
  eventDateInput: { width: 64, textAlign: 'center' },
  eventError: { color: c.primary },
  eventRow: {
    marginHorizontal: 20,
    marginBottom: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  eventName: { fontFamily: f.bold, fontSize: 15, color: c.text, marginBottom: 2 },
  eventDelete: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
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
  emoji: { fontSize: 24, lineHeight: 30 },
  categoryLabel: { fontFamily: f.medium, fontSize: 12, color: c.text },
  segment: {
    marginHorizontal: 16,
    marginBottom: 10,
    height: 44,
    backgroundColor: c.segment,
    borderRadius: 12,
    padding: 4,
    flexDirection: 'row',
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  segmentSelected: { backgroundColor: c.white },
  segmentText: { fontFamily: f.medium, fontSize: 14, color: c.muted },
  sectionHeader: {
    marginHorizontal: 16,
    marginTop: 9,
    marginBottom: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sort: { minHeight: 32, flexDirection: 'row', gap: 2, alignItems: 'center' },
  searchInput: {
    backgroundColor: c.white,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 10,
    color: c.text,
    fontFamily: f.regular,
    fontSize: 15,
  },
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
  chips: { paddingHorizontal: 16, gap: 8 },
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
  resultButton: { marginHorizontal: 16, marginVertical: 4 },
  compareButton: { backgroundColor: c.white, borderWidth: 1.5, borderColor: c.primary, borderRadius: 16, minHeight: 64, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  compareIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  compareTitle: { fontFamily: f.bold, fontSize: 14, color: c.text, marginBottom: 2 },
  compareSubtitle: { fontFamily: f.regular, fontSize: 12, color: c.muted },
  attach: { width: 40, height: 44, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: c.segment, flexShrink: 0 },
  inputShell: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', backgroundColor: c.white, borderWidth: 1, borderColor: c.border, borderRadius: 26, overflow: 'hidden' },
  attachmentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 8 },
  attachmentChip: { borderWidth: 1, borderColor: c.border, backgroundColor: c.white, borderRadius: 12, padding: 10 },
  noMatches: { marginHorizontal: 16, padding: 16, backgroundColor: c.white, borderRadius: 16, gap: 12 },
  chatCards: { paddingHorizontal: 16, gap: 12, alignItems: 'stretch' },
  chatCard: { width: 248, backgroundColor: c.white, borderWidth: 1, borderColor: c.border, borderRadius: 16, overflow: 'hidden' },
  chatCardHero: { height: 92, backgroundColor: c.image, alignItems: 'center', justifyContent: 'center' },
  rankBadge: { position: 'absolute', top: 8, left: 8, backgroundColor: c.primary, color: c.white, fontFamily: f.bold, fontSize: 12, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  cardHeart: { position: 'absolute', top: 4, right: 4, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  chatCardBody: { padding: 14, gap: 8 },
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
  myIntro: {
    paddingHorizontal: 20,
    paddingVertical: 24,
    gap: 12,
    alignItems: 'center',
  },
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
