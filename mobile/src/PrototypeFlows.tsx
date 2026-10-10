import React, { createContext, useContext, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Check, X } from 'lucide-react-native';
import { colors as c, fonts as f } from './theme';
import { Gift } from './catalog';
import { GiftImage, won } from './components';
import { usePassContext } from '../App';
import { useAuth } from './auth/AuthProvider';
import { AuthPanel } from './auth/AuthPanel';
import { authErrorMessage } from './services/authService';
const PrototypeContext = createContext<ReturnType<typeof usePrototypeState> | null>(null);
function usePrototypeState() {
  const { user } = useAuth();
  const [records, setRecords] = useState<Record<string, Gift[]>>({});
  const owner = user?.id ?? 'guest';
  const prepared = records[owner] ?? [];
  const setPrepared: React.Dispatch<React.SetStateAction<Gift[]>> = update => {
    setRecords(previous => ({ ...previous, [owner]: typeof update === 'function' ? update(previous[owner] ?? []) : update }));
  };
  return { prepared, setPrepared };
}
export function PrototypeProvider({ children }: { children: React.ReactNode }) {
  return <PrototypeContext.Provider value={usePrototypeState()}>{children}</PrototypeContext.Provider>;
}
export function usePrototype() {
  const state = useContext(PrototypeContext);
  if (!state) throw new Error('PrototypeProvider is required');
  return state;
}
function Action({ label, onPress, secondary = false }: { label: string; onPress: () => void; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={[s.action, secondary && s.secondary]}><Text style={[s.actionText, secondary && s.secondaryText]}>{label}</Text></Pressable>;
}
export function PrototypePage({ kind }: { kind: 'login' | 'account' | 'confirm' | 'complete' }) {
  const router = useRouter();
  const { detail, session } = usePassContext();
  const { prepared, setPrepared } = usePrototype();
  const { user, service } = useAuth();
  const loggedIn = user !== null;
  const [error, setError] = useState('');
  const [modal, setModal] = useState<'seller' | 'purchase' | null>(null);
  const back = () => router.canGoBack() ? router.back() : router.replace('/');
  const logout = async () => {
    setError('');
    try { await service.signOut(); router.replace('/mypage'); }
    catch (failure) { setError(authErrorMessage(failure)); }
  };
  return <SafeAreaView style={s.safe}>
    <View style={s.header}><Pressable accessibilityRole="button" accessibilityLabel="이전 화면" onPress={back} style={s.icon}><ArrowLeft size={22} color={c.text}/></Pressable><Text style={s.title}>{kind === 'login' ? '로그인' : kind === 'account' ? '계정과 선물 기록' : kind === 'confirm' ? '선물 확인' : '선물 준비 완료'}</Text></View>
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      {kind === 'login' ? <>
        <AuthPanel/>
      </> : kind === 'account' ? <>
        <Text style={s.title}>{user?.email ?? '로그인 없이 이용 중'}</Text><Text style={s.note}>로그인은 계정에 연결돼요. 선물 준비 기록은 아직 이 화면의 체험 기록이며 계정과 동기화되지 않아요.</Text>
        <Text style={s.label}>선물 준비 기록 {prepared.length}개</Text>
        {prepared.length ? prepared.map((g, i) => <View key={`${g.id}-${i}`} style={s.card}><Text style={s.title}>{g.name}</Text><Text style={s.note}>{won(g.price)} · 준비 완료 체험</Text></View>) : <Text style={s.note}>선물 준비를 완료하면 여기에 표시돼요.</Text>}
        {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
        <Action label={loggedIn ? '로그아웃' : '로그인하기'} onPress={() => { if (loggedIn) void logout(); else router.push('/login'); }}/>
      </> : !detail ? <><Text style={s.note}>먼저 선물을 선택해주세요.</Text><Action label="선물 찾아보기" onPress={() => router.replace('/ranking')}/></> : kind === 'confirm' ? <>
        <Text style={s.title}>이 선물로 정할까요?</Text>
        <View style={s.product}><GiftImage gift={detail}/><View style={s.flex}><Text style={s.label}>{detail.name}</Text><Text style={s.note}>{detail.category}</Text></View></View>
        <View style={s.card}><View style={s.row}><Text style={[s.note,s.flex]}>표시 금액</Text><Text style={s.label}>{won(detail.price)}</Text></View><Text style={s.note}>배송비 {detail.shippingIncluded === true ? '포함' : '판매처에서 확인'} · 데모 가격</Text></View>
        <View style={s.card}><Text style={s.label}>확인한 선물 조건</Text><Text style={s.note}>{session.state.recipients.join(' · ') || '받는 분 미정'} · {session.state.occasion || '상황 미정'}</Text><Text style={s.note}>예산 {session.state.budget.amount_krw ? won(session.state.budget.amount_krw) : '미정'} · {session.state.preferences.length ? '선호 조건 반영' : '선호 조건 미정'}</Text></View>
        <Text style={s.note}>판매처 이동과 구매 완료 확인은 화면 체험으로 진행돼요. 실제 주문·결제는 발생하지 않아요.</Text>
        <Action label="판매처에서 구매하기" onPress={() => setModal('seller')}/>
      </> : <>
        <View style={s.success}><Check size={34} color="#2D8061"/></View><Text style={[s.title,s.center]}>선물 준비를 마쳤어요</Text><Text style={[s.note,s.center]}>구매 완료 확인 흐름을 체험했어요. 실제 구매나 발송은 이루어지지 않았어요.</Text><View style={s.product}><GiftImage gift={detail}/><Text style={[s.label,s.flex]}>{detail.name}</Text></View><Action label="홈으로 가기" onPress={() => router.replace('/')}/><Action label="다른 선물 찾기" secondary onPress={() => router.replace('/ranking')}/>
      </>}
    </ScrollView>
    <Modal visible={modal !== null} transparent animationType="slide" onRequestClose={() => { setModal(null); }}>
      <View style={s.overlay}><SafeAreaView edges={['bottom']} style={s.sheet}><View style={s.row}><Text style={[s.title,s.flex]}>{modal === 'seller' ? '판매처로 이동할까요?' : '구매를 마치셨나요?'}</Text><Pressable accessibilityRole="button" accessibilityLabel="확인창 닫기" onPress={() => { setModal(null); }} style={s.icon}><X size={20} color={c.text}/></Pressable></View>
        <Text style={s.note}>{modal === 'seller' ? '예시 판매처 이동을 체험해요. 외부 사이트를 열거나 결제하지 않아요.' : '구매 완료를 확인하면 선물 준비 기록에 체험 결과를 남겨요.'}</Text>
        <Action label={modal === 'seller' ? '이동하기 체험' : '네, 구매했어요 (체험)'} onPress={() => {
          if (modal === 'seller') setModal('purchase'); else { if (detail) setPrepared(old => [detail, ...old]); setModal(null); router.replace('/gift-complete'); }
        }}/><Action label="취소" secondary onPress={() => { setModal(null); }}/>
      </SafeAreaView></View>
    </Modal>
  </SafeAreaView>;
}
const s = StyleSheet.create({ safe: { flex: 1, backgroundColor: c.background }, flex: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8, backgroundColor: c.white }, icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, content: { padding: 20, gap: 16 }, title: { color: c.text, fontFamily: f.bold, fontSize: 19 }, label: { color: c.text, fontFamily: f.medium, fontSize: 15 }, note: { color: c.muted, fontFamily: f.regular, fontSize: 13, lineHeight: 22 }, brand: { flexDirection: 'row', gap: 8, alignItems: 'center' }, input: { backgroundColor: c.white, borderColor: c.border, borderWidth: 1, borderRadius: 12, padding: 14, color: c.text, fontFamily: f.regular }, password: { flexDirection: 'row', alignItems: 'center' }, row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, action: { backgroundColor: c.primary, padding: 16, borderRadius: 12, minHeight: 50, alignItems: 'center', justifyContent: 'center' }, actionText: { color: c.white, fontFamily: f.bold, fontSize: 14 }, secondary: { backgroundColor: c.white, borderWidth: 1, borderColor: c.border }, secondaryText: { color: c.text }, error: { padding: 14, backgroundColor: c.tint, color: c.primary, fontFamily: f.regular }, product: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: c.white, padding: 12, borderRadius: 16 }, card: { backgroundColor: c.white, borderRadius: 16, padding: 16, gap: 10 }, overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000066' }, sheet: { backgroundColor: c.white, padding: 20, gap: 16, borderTopLeftRadius: 24, borderTopRightRadius: 24 }, success: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#E5F3EB', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginTop: 44 }, center: { textAlign: 'center' } });
