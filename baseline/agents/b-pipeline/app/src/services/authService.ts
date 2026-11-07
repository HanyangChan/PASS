import type { SupabaseClient, User } from '@supabase/supabase-js';
export type AuthUser = Pick<User, 'id' | 'email'>;
const identity = (user: User | null): AuthUser | null => user ? { id: user.id, email: user.email } : null;
export function authErrorMessage(error: unknown) {
  const code = (error as { code?: string })?.code;
  if (code === 'invalid_credentials') return '이메일 또는 비밀번호를 확인해주세요.';
  if (code === 'email_not_confirmed') return '메일의 인증 링크를 확인한 뒤 다시 로그인해주세요.';
  if (code === 'user_already_exists') return '이미 가입한 이메일이에요. 로그인해주세요.';
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') return '요청이 많아요. 잠시 후 다시 시도해주세요.';
  if (code === 'weak_password') return '더 안전한 비밀번호를 사용해주세요.';
  return '계정 요청을 처리하지 못했어요. 연결을 확인하고 다시 시도해주세요.';
}
export function createAuthService(client: SupabaseClient | null) {
  const requireClient = () => {
    if (!client) throw new Error('로그인 서비스가 아직 연결되지 않았어요. 게스트로 이용할 수 있어요.');
    return client;
  };
  return {
    configured: client !== null,
    async restore() {
      if (!client) return null;
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      return identity(data.session?.user ?? null);
    },
    subscribe(listener: (user: AuthUser | null) => void) {
      if (!client) return () => {};
      const { data } = client.auth.onAuthStateChange((_event, session) => listener(identity(session?.user ?? null)));
      return () => data.subscription.unsubscribe();
    },
    async signIn(email: string, password: string) {
      const { data, error } = await requireClient().auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      return identity(data.user);
    },
    async signUp(email: string, password: string) {
      const { data, error } = await requireClient().auth.signUp({ email: email.trim(), password });
      if (error) throw error;
      return { needsConfirmation: !data.session };
    },
    async signOut() {
      const { error } = await requireClient().auth.signOut({ scope: 'local' });
      if (error) throw error;
    },
    startRefresh() { client?.auth.startAutoRefresh(); },
    stopRefresh() { client?.auth.stopAutoRefresh(); },
  };
}
