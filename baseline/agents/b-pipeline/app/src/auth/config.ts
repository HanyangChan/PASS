export function resolveAuthConfig(url?: string, key?: string) {
  if (!url && !key) return null;
  if (!url || !key) throw new Error('Supabase URL과 Publishable key를 모두 설정해주세요.');
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:') throw new Error('Supabase URL은 HTTPS 주소여야 합니다.');
  if (!key.startsWith('sb_publishable_')) throw new Error('클라이언트에는 Supabase Publishable key만 사용해주세요.');
  return { url: endpoint.origin, key };
}
