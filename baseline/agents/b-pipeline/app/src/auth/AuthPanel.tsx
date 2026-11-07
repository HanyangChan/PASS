import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from './AuthProvider';
import { authErrorMessage } from '../services/authService';
import { colors as c, fonts as f } from '../theme';
export function AuthPanel() {
  const { configured, ready, error: connectionError, service } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const running = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const submit = async () => {
    if (running.current || !configured || !ready) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || password.length < 6) {
      setError('이메일 형식과 6자 이상의 비밀번호를 확인해주세요.'); return;
    }
    running.current = true; setBusy(true); setError(''); setNotice('');
    try {
      if (mode === 'signup') {
        const result = await service.signUp(email, password);
        if (!mounted.current) return;
        if (result.needsConfirmation) {
          setMode('signin'); setNotice('인증 메일을 보냈어요. 메일의 링크를 확인한 뒤 앱으로 돌아와 로그인해주세요.');
        } else router.replace('/mypage');
      } else {
        await service.signIn(email, password);
        if (mounted.current) router.replace('/mypage');
      }
      if (mounted.current) setPassword('');
    } catch (failure) { if (mounted.current) setError(authErrorMessage(failure)); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  };
  const disabled = busy || !ready || !configured;
  return <View style={s.form}>
    <Text style={s.title}>{mode === 'signin' ? '이메일로 로그인' : '계정 만들기'}</Text>
    <Text style={s.note}>{configured ? (mode === 'signin' ? '가입한 이메일과 비밀번호로 로그인해주세요.' : '사용할 이메일과 비밀번호를 입력해주세요. 가입 후 인증 메일을 확인해야 해요.') : '로그인 서비스 연결을 준비하고 있어요. 게스트 추천과 기기 기록은 계속 이용할 수 있어요.'}</Text>
    {!!(error || connectionError) && <Text accessibilityRole="alert" style={s.error}>{error || connectionError}</Text>}
    {!!notice && <Text accessibilityLiveRegion="polite" style={s.note}>{notice}</Text>}
    <Text style={s.label}>이메일</Text>
    <TextInput accessibilityLabel="이메일" editable={!busy} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" placeholder="name@example.com" value={email} onChangeText={setEmail} style={s.input}/>
    <Text style={s.label}>비밀번호</Text>
    <TextInput accessibilityLabel="비밀번호" editable={!busy} secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} placeholder="비밀번호" value={password} onChangeText={setPassword} style={s.input}/>
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => setShowPassword(value => !value)}><Text style={s.note}>{showPassword ? '비밀번호 숨기기' : '비밀번호 표시'}</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={disabled} onPress={() => void submit()} style={[s.action, disabled && s.disabled]}><Text style={s.actionText}>{busy ? '처리 중…' : mode === 'signin' ? '로그인' : '회원가입'}</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setNotice(''); setPassword(''); }}><Text style={s.label}>{mode === 'signin' ? '회원가입' : '로그인으로 돌아가기'}</Text></Pressable>
    <Pressable accessibilityRole="button" onPress={() => router.replace('/')}><Text style={s.note}>로그인 없이 둘러보기</Text></Pressable>
  </View>;
}
const s = StyleSheet.create({ form: { gap: 14 }, title: { color: c.text, fontFamily: f.bold, fontSize: 19 }, label: { color: c.text, fontFamily: f.medium, fontSize: 15 }, note: { color: c.muted, fontFamily: f.regular, fontSize: 13, lineHeight: 22 }, input: { backgroundColor: c.white, borderColor: c.border, borderWidth: 1, borderRadius: 12, padding: 14, color: c.text, fontFamily: f.regular }, action: { backgroundColor: c.primary, padding: 16, borderRadius: 12, alignItems: 'center' }, actionText: { color: c.white, fontFamily: f.bold }, disabled: { opacity: 0.4 }, error: { color: c.primary, padding: 12, backgroundColor: c.tint } });
