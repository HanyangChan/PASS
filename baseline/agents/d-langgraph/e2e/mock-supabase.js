// LOCAL E2E ONLY: in-page stand-in for Supabase at https://pass-mock.test (a .test host).
(() => {
  const BASE = 'https://pass-mock.test';
  const user = { id: 'demo-user', aud: 'authenticated', role: 'authenticated', email: 'demo@pass.test', app_metadata: {}, user_metadata: {}, created_at: '2026-11-01T00:00:00Z' };
  const session = () => ({ access_token: 'demo-token', refresh_token: 'demo-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user });
  const put = (k, v) => { if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(v)); };
  const md = d => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  localStorage.setItem('sb-pass-mock-auth-token', JSON.stringify(session()));
  put('pass.calendar-events.v1', [{ id: 'e1', title: '엄마 생일', date: md(new Date(Date.now() + 10 * 864e5)), kind: 'birthday' }]);
  const gift = (id, name, category, price) => ({ id, name, category, price, description: '데모 구매 기록', icon: 'gift' });
  put('pass.personalization.v1.account:demo-user', { memories: [], purchases: [
    { id: 'p1', recipient: '어머니', gift: gift('g1', '수분 크림 세트', '뷰티', 38000), feedback: 'liked', source: 'user_reported', recordedAt: '2026-10-01T00:00:00.000Z' },
    { id: 'p2', recipient: '어머니', gift: gift('g2', '초코 쿠키 세트', '과자·간식', 21000), feedback: 'disliked', source: 'user_reported', recordedAt: '2026-10-02T00:00:00.000Z' },
  ] });
  let rows = null;
  const json = (body, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const real = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.startsWith(BASE)) return real(input, init);
    const u = new URL(url), method = (init.method || 'GET').toUpperCase();
    if (u.pathname === '/auth/v1/token' || u.pathname === '/auth/v1/signup') return json(session());
    if (u.pathname === '/auth/v1/user') return json(user);
    if (u.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
    if (u.pathname === '/rest/v1/products') {
      rows ??= await real('/seed-products.json').then(r => r.json());
      const limit = Number(u.searchParams.get('limit') || 1000), offset = Number(u.searchParams.get('offset') || 0);
      return json(rows.slice(offset, offset + limit));
    }
    if (u.pathname.startsWith('/rest/v1/')) return method === 'GET' || method === 'HEAD' ? json([]) : json([], 201);
    return json({ message: 'mock: not found' }, 404);
  };
})();
