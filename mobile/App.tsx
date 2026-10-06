import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Home,
  Sparkles,
  Trophy,
  User,
  Gift as GiftIcon,
  ArrowLeft,
  Heart,
  Share2,
  Send,
  ChevronDown,
  Star,
} from 'lucide-react-native';
import SearchIcon from './assets/figma/search.svg';
import FilterIcon from './assets/figma/filter.svg';
import { colors as c, fonts as f } from './src/theme';
import {
  Gift,
  popularGifts,
  rankingByRecipient,
  categories,
  categoryNames,
} from './src/catalog';
import { savedKey, recentKey, decodeGifts } from './src/storage';
import {
  Chip,
  GiftCard,
  GiftImage,
  Tile,
  SectionHeader,
  won,
} from './src/components';
import {
  singleInitial,
  singleQuestion,
  singleTurn,
  engineState,
  finishSingle,
} from '../lib/single-gift.mjs';
import { recommend, apply } from '../lib/engine.mjs';
import { budgetAlternatives } from '../lib/counterfactual.mjs';
import products from '../lib/products.json';
type Screen = 'home' | 'chat' | 'ranking' | 'mypage';
const nav = [
  { key: 'home', label: '홈', Icon: Home },
  { key: 'chat', label: 'AI 추천', Icon: Sparkles },
  { key: 'ranking', label: '선물 랭킹', Icon: Trophy },
  { key: 'mypage', label: '마이', Icon: User },
] as const;
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
    ready,
    notice,
    setNotice,
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
  } = state;
  const router = useRouter();
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
  const question = singleQuestion(session),
    result = recommend(products, engineState(session.state)),
    comparison = budgetAlternatives(products, engineState(session.state));
  const toGift = (p: any): Gift => ({
    id: p.id,
    name: p.name.replace('가상 ', ''),
    category: categoryNames[p.category],
    price: p.total,
    description: p.description,
    icon: p.category === 'fruit' ? 'fruit' : 'gift',
    source: 'engine',
    shippingIncluded: session.state.budget.shipping_included === true,
    packaging: p.packaging === 'formal' ? '격식 있는 포장' : '기본 포장',
    arrival: p.arrival_date,
  });
  const send = (text: string) => {
    if (!text.trim()) return;
    const turn = singleTurn(session, text.trim(), products);
    setSession(turn.session);
    setMessages((old) => [
      ...old,
      { role: 'user', text: text.trim() },
      { role: 'assistant', text: turn.message },
    ]);
    setInput('');
    setComparisonId(null);
  };
  const chat = (label?: string) => {
    navigate('chat');
    if (label)
      send(label === '부모님' ? '부모님' : `${label} 선물을 찾고 있어요`);
  };
  const changeBudget = (a: any) => {
    const next = apply(session.state, a.patch),
      turn = finishSingle(session.state, next, session.issues, products);
    setSession(turn.session);
    setMessages((old) => [
      ...old,
      { role: 'user', text: `예산을 ${won(a.amount)}으로 변경해줘.` },
      { role: 'assistant', text: turn.message },
    ]);
    setComparisonId(null);
  };
  const cards = (gifts: Gift[], ranked = false) =>
    gifts.map((g, i) => (
      <GiftCard
        key={g.id}
        gift={g}
        rank={
          ranked
            ? screen === 'ranking' && !resultsOpen && sort === '인기순'
              ? rankingByRecipient[recipient].findIndex((p) => p.id === g.id) +
                1
              : i + 1
            : undefined
        }
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
        <Tile key={g.id} gift={g} onOpen={() => open(g)} />
      ))}
    </ScrollView>
  );
  let ranked = rankingByRecipient[recipient].filter(
    (g) =>
      (filter === '전체' || g.category === filter) && g.name.includes(search),
  );
  if (sort !== '인기순')
    ranked = [...ranked].sort((a, b) =>
      sort === '낮은 가격순' ? a.price - b.price : b.price - a.price,
    );
  const info =
    detail?.source === 'engine'
      ? [
          ['배송', `모의 도착일 ${detail.arrival}`],
          [
            '배송비',
            detail.shippingIncluded ? '표시 금액에 포함' : '상품값에서 별도',
          ],
          ['포장', detail.packaging || '미지정'],
          ['구매', '실험용 가상 상품 · 실제 판매 없음'],
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
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {notice !== '' && (
          <Text accessibilityRole="alert" style={s.note}>
            {notice}
          </Text>
        )}
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
                    <Text style={s.small}>{detail.rating} · 데모 평점</Text>
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
                <Text style={s.small}>
                  상품·가격·평점은 프로토타입용 정보예요. 실제 구매는 제공하지
                  않아요.
                </Text>
              </View>
            </ScrollView>
            <View style={s.detailActions}>
              <View style={s.flex}>
                <Button
                  label="선물하기"
                  onPress={() =>
                    setNotice(
                      '현재는 데모 앱이에요. 실제 구매·선물 발송은 준비 중입니다.',
                    )
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
                    accessibilityLabel="마이 페이지 열기"
                    onPress={() => navigate('mypage')}
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
                    프로토타입의 데모 상품·가격·평점이에요.
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
                    onPress={() => setShowFilter(true)}
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
                    받는 분 기준 랭킹이에요. 지금은 데모 데이터예요.
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
                      setSession({ state: singleInitial(), issues: [] });
                      setMessages([]);
                      setInput('');
                      setComparisonId(null);
                    }}
                    style={s.reset}
                  >
                    <Text style={s.small}>새 대화</Text>
                  </Pressable>
                </View>
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
                    규칙 기반 해석 · 식품 선물 데모
                  </Text>
                  <Text style={s.assistant}>
                    식품 선물을 함께 골라볼게요. 누구에게 드릴 선물인가요?
                  </Text>
                  {messages.map((m, i) => (
                    <Text
                      key={i}
                      style={m.role === 'user' ? s.user : s.assistant}
                    >
                      {m.text}
                    </Text>
                  ))}
                  {!question.key && (
                    <>
                      {tiles(result.items.map(toGift))}
                      <View style={s.resultButton}>
                        <Button
                          label="추천 결과 · 예산 비교 보기"
                          onPress={() => setResultsOpen(true)}
                        />
                      </View>
                    </>
                  )}
                </ScrollView>
                {session.state.recipients.length > 0 && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="선물 조건 수정"
                    onPress={() => inputRef.current?.focus()}
                    style={s.conditionStrip}
                  >
                    <Text numberOfLines={2} style={s.small}>
                      {session.state.recipients.join(' · ')}
                      {session.state.budget.amount_krw
                        ? ` · ${won(session.state.budget.amount_krw)} 이하`
                        : ''}
                      {session.state.budget.shipping_included === null
                        ? ''
                        : session.state.budget.shipping_included
                          ? ' · 배송비 포함'
                          : ' · 상품값 기준'}{' '}
                      · 수정하려면 입력해주세요
                    </Text>
                  </Pressable>
                )}
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
                        onPress={() => send(choice)}
                      />
                    ))}
                  </ScrollView>
                  <View style={s.composer}>
                    <TextInput
                      ref={inputRef}
                      accessibilityLabel="선물 조건 입력"
                      value={input}
                      onChangeText={setInput}
                      placeholder="어떤 분께 드릴 선물인가요?"
                      maxLength={1200}
                      multiline
                      style={[s.input, s.flex]}
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="메시지 보내기"
                      disabled={!input.trim()}
                      onPress={() => send(input)}
                      style={[s.send, !input.trim() && s.disabled]}
                    >
                      <Send size={18} color={c.white} />
                    </Pressable>
                  </View>
                </View>
              </>
            ) : (
              <ScrollView style={s.flex} contentContainerStyle={s.bottom}>
                <View style={s.header}>
                  <Text style={s.title}>마이 페이지</Text>
                </View>
                <View style={s.myIntro}>
                  <User size={32} color={c.primary} />
                  <Text style={s.sectionTitle}>내 선물 기록</Text>
                  <Text style={s.subtitle}>
                    찜과 최근 본 선물은 이 기기에 저장돼요.
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
                    랭킹에는 프로토타입의 예시 상품이, 대화에는 기존 식품
                    카탈로그가 사용돼요. 실제 로그인·결제·배송 기능은 준비
                    중입니다. 대화는 앱을 종료하면 사라지고, 찜과 최근 본 선물은
                    기기에 남아요.
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
        visible={showFilter}
        transparent
        animationType="slide"
        onRequestClose={() => setShowFilter(false)}
      >
        <View style={s.overlay}>
          <View style={s.sheet}>
            <Text style={s.title}>상품군</Text>
            <ScrollView style={s.filterScroll}>
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
                    selected={filter === label}
                    onPress={() => setFilter(label)}
                  />
                ))}
              </View>
            </ScrollView>
            <Button label="적용하기" onPress={() => setShowFilter(false)} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
function usePassState() {
  const [screen, setScreen] = useState<Screen>('home'),
    [detail, setDetail] = useState<Gift | null>(null),
    [saved, setSaved] = useState<Gift[]>([]),
    [recent, setRecent] = useState<Gift[]>([]),
    [ready, setReady] = useState(false),
    [notice, setNotice] = useState(''),
    [heroFailed, setHeroFailed] = useState(false);
  const [recipient, setRecipient] = useState('전체'),
    [search, setSearch] = useState(''),
    [showSearch, setShowSearch] = useState(false),
    [filter, setFilter] = useState('전체'),
    [showFilter, setShowFilter] = useState(false),
    [sort, setSort] = useState('인기순');
  const [session, setSession] = useState<any>(() => ({
      state: singleInitial(),
      issues: [],
    })),
    [messages, setMessages] = useState<{ role: string; text: string }[]>([]),
    [input, setInput] = useState(''),
    [comparisonId, setComparisonId] = useState<string | null>(null),
    [allSaved, setAllSaved] = useState(false),
    [allRecent, setAllRecent] = useState(false);
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    Promise.allSettled([
      AsyncStorage.getItem(savedKey).then((raw) => setSaved(decodeGifts(raw))),
      AsyncStorage.getItem(recentKey).then((raw) =>
        setRecent(decodeGifts(raw)),
      ),
    ]).then((r) => {
      if (r.some((v) => v.status === 'rejected'))
        setNotice('기기에 저장한 기록 일부를 불러오지 못했어요.');
      setReady(true);
    });
  }, []);
  useEffect(() => {
    if (ready)
      writes.current = writes.current
        .then(() =>
          AsyncStorage.multiSet([
            [savedKey, JSON.stringify(saved)],
            [recentKey, JSON.stringify(recent)],
          ]),
        )
        .catch(() => setNotice('기기에 기록을 저장하지 못했어요.'));
  }, [saved, recent, ready]);

  return {
    screen,
    setScreen,
    detail,
    setDetail,
    saved,
    setSaved,
    recent,
    setRecent,
    ready,
    notice,
    setNotice,
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
  const value = usePassState();
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
  disabled: { opacity: 0.4 },
  horizontal: { paddingHorizontal: 20, gap: 12 },
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
    backgroundColor: c.white,
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
    backgroundColor: c.segment,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: c.text,
    fontFamily: f.regular,
    fontSize: 14,
    maxHeight: 120,
    minHeight: 44,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reset: { padding: 8, minHeight: 44, justifyContent: 'center' },
  conditionStrip: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: c.tint,
  },
  resultButton: { marginHorizontal: 20 },
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
