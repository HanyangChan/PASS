import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudRecords } from '../src/services/cloudRecords.ts';
import { createLocalChatService } from '../src/services/chatService.ts';
import { record, products, state, scope } from '../../tests/fixtures/context-feedback.mjs';
import { rankingFeedback } from '../src/chatHistory.ts';
const empty = () => createLocalChatService([], {}).createSession();
const gift = id => ({ id, name: '선물', category: '차', price: 30000, description: '예시', icon: 'gift' });
const message = text => ({ role: 'user', text });
function fixture() {
  const rows = { gift_records: [], conversations: [], messages: [] }, writes = [];
  let counter = 0, owner = 'owner', fail = '', failAfter = '', stamp = 0;
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: owner } } }, error: null }) },
    from(table) {
      let operation = 'select', payload, options, filters = [], sorting, maximum = 1000, start = 0, single = false;
      const query = {
        select() { return query; },
        eq(key, value) { filters.push(row => key === 'conditions->_pass->>committed' ? String(row.conditions._pass.committed) === value : row[key] === value); return query; },
        in(key, values) { filters.push(row => values.includes(row[key])); return query; },
        order(key, { ascending }) { sorting = [key, ascending]; return query; },
        range(from, to) { start = from; maximum = to - from + 1; return query; },
        limit(value) { maximum = value; return query; },
        single() { single = true; return query; },
        upsert(value, opt) { operation = 'upsert'; payload = structuredClone(value); options = opt; return query; },
        update(value) { operation = 'update'; payload = structuredClone(value); return query; },
        delete() { operation = 'delete'; return query; },
        async then(resolve) {
          if (fail === `${table}:${operation}`) { fail = ''; return resolve({ error: { message: 'network failed' }, data: null }); }
          let selected = rows[table].filter(row => filters.every(filter => filter(row)));
          if (operation === 'upsert') {
            writes.push([table, payload]);
            const keys = options.onConflict.split(',');
            for (const row of Array.isArray(payload) ? payload : [payload]) {
              const previous = rows[table].find(existing => keys.every(key => existing[key] === row[key]));
              if (previous && options.ignoreDuplicates) continue;
              const value = { ...row, updated_at: ++stamp };
              if (previous) Object.assign(previous, value); else rows[table].push(value);
            }
          } else if (operation === 'update') { for (const row of selected) Object.assign(row, payload, { updated_at: ++stamp }); }
          else if (operation === 'delete') rows[table] = rows[table].filter(row => !selected.includes(row));
          else {
            if (sorting) selected.sort((a, b) => (a[sorting[0]] > b[sorting[0]] ? 1 : -1) * (sorting[1] ? 1 : -1));
            selected = selected.slice(start, start + maximum);
          }
          if (failAfter === `${table}:${operation}`) { failAfter = ''; return resolve({ error: { message: 'lost acknowledgement' }, data: null }); }
          resolve({ data: structuredClone(single ? selected[0] ?? null : selected), error: null });
        },
      };
      return query;
    },
  };
  return { rows, writes, client, repo: () => createCloudRecords(client, 'owner', () => `uuid-${++counter}`), fail: value => { fail = value; }, failAfter: value => { failAfter = value; }, switchOwner: () => { owner = 'other'; } };
}

test('cloud gifts round trip preserves order, removal and unseen records on other devices', async () => {
  const f = fixture(), repo = f.repo(); await repo.load(empty());
  await repo.saveGifts({ saved: [gift('a'), gift('b')], recent: [gift('b'), gift('a')] });
  f.rows.gift_records.push({ user_id: 'owner', kind: 'saved', gift_key: 'prototype:other-device', snapshot: gift('other-device'), updated_at: 99 });
  await repo.saveGifts({ saved: [gift('b')], recent: [gift('a'), gift('b')] });
  const restored = await f.repo().load(empty());
  assert.deepEqual(restored.recent.map(g => g.id), ['a', 'b']);
  assert.deepEqual(new Set(restored.saved.map(g => g.id)), new Set(['b', 'other-device']));
});

test('failed saves capture snapshots and can retry without duplicate records', async () => {
  const f = fixture(), repo = f.repo(); await repo.load(empty());
  f.fail('gift_records:upsert');
  const value = { saved: [gift('a')], recent: [] };
  const first = repo.saveGifts(value); value.saved[0].name = 'mutated';
  await assert.rejects(first, /network failed/);
  await repo.saveGifts({ saved: [gift('a')], recent: [] });
  assert.equal(f.rows.gift_records.length, 1);
  assert.equal(f.rows.gift_records[0].snapshot.name, '선물');
});

test('chat commit pointer excludes interrupted messages and retry reuses IDs', async () => {
  const f = fixture(), repo = f.repo(); await repo.load(empty());
  await repo.saveChat(empty(), [message('first')]);
  f.fail('conversations:update');
  await assert.rejects(repo.saveChat(empty(), [message('first'), message('second')]), /network failed/);
  assert.deepEqual((await f.repo().load(empty())).messages, [message('first')]);
  await repo.saveChat(empty(), [message('first'), message('second')]);
  assert.equal(f.rows.messages.length, 2);
  assert.deepEqual((await f.repo().load(empty())).messages, [message('first'), message('second')]);
});

test('new empty chat persists reset without deleting previous conversation', async () => {
  const f = fixture(), repo = f.repo(); await repo.load(empty());
  await repo.saveChat(empty(), [message('previous')]);
  await repo.saveChat(empty(), []);
  assert.equal(f.rows.conversations.length, 2);
  assert.deepEqual((await f.repo().load(empty())).messages, []);
});

test('account change or disposed repository rejects queued writes before touching data', async () => {
  const f = fixture(), repo = f.repo(); await repo.load(empty());
  const queued = repo.saveGifts({ saved: [gift('a')], recent: [] }); repo.close();
  await assert.rejects(queued, /계정이 변경/);
  assert.equal(f.rows.gift_records.length, 0);
  const second = f.repo(); f.switchOwner();
  await assert.rejects(second.load(empty()), /다시 로그인/);
});

test('missing committed messages and oversized messages fail instead of overwriting history', async () => {
  const f = fixture(), repo = f.repo(); await repo.load(empty());
  await repo.saveChat(empty(), [message('first')]);
  f.rows.messages.length = 0;
  await assert.rejects(f.repo().load(empty()), /일부/);
  await assert.rejects(repo.saveChat(empty(), [message('a'.repeat(16001))]), /16,000/);
});

 test('failed new chat commit does not hide the previous completed conversation', async () => {
  const f = fixture(), repo = f.repo(); await repo.load(empty());
  await repo.saveChat(empty(), [message('previous')]);
  f.fail('conversations:update');
  await assert.rejects(repo.saveChat(empty(), [message('new')]), /network failed/);
  assert.deepEqual((await f.repo().load(empty())).messages, [message('previous')]);
});

test('large gift collections page beyond the server default row limit', async () => {
  const f = fixture();
  for (let index = 0; index < 1205; index++) f.rows.gift_records.push({ id: String(index).padStart(4, '0'), user_id: 'owner', kind: 'saved', snapshot: gift(String(index)), updated_at: 1 });
  assert.equal((await f.repo().load(empty())).saved.length, 1205);
});

test('reverting an edit after a partial write removes the already-uploaded addition', async () => {
  const f = fixture(), repo = f.repo(); await repo.load(empty());
  await repo.saveGifts({ saved: [gift('a')], recent: [] });
  f.fail('gift_records:delete');
  await assert.rejects(repo.saveGifts({ saved: [gift('b')], recent: [] }), /network failed/);
  await repo.saveGifts({ saved: [gift('a')], recent: [] });
  assert.deepEqual((await f.repo().load(empty())).saved.map(g => g.id), ['a']);
});

test('lost update/delete acknowledgements do not prevent restoring the previous selection', async () => {
  for (const operation of ['upsert', 'delete']) {
    const f = fixture(), repo = f.repo(); await repo.load(empty());
    await repo.saveGifts({ saved: [gift('a')], recent: [] });
    f.failAfter(`gift_records:${operation}`);
    const edit = operation === 'upsert' ? { ...gift('a'), price: 10000 } : gift('b');
    await assert.rejects(repo.saveGifts({ saved: [edit], recent: [] }), /lost acknowledgement/);
    await repo.saveGifts({ saved: [gift('a')], recent: [] });
    const restored = await f.repo().load(empty());
    assert.deepEqual(restored.saved.map(g => [g.id, g.price]), [['a', 30000]]);
  }
});

test('legacy account chat restores canonically, continues through the API, and saves without duplicating history', async () => {
  const { createApi } = await import('../../api/worker.mjs');
  const { createServerChatService } = await import('../src/services/serverChatService.ts');
  const f=fixture(), writer=f.repo();await writer.load(empty());
  const legacy={state:{...empty().state,recipients:['부모님'],preferences:['category:tea'],excluded_categories:['nuts'],excluded_ingredients:['우유'],budget:{amount_krw:50000,shipping_included:true}},issues:[]};
  const history=[message('차를 좋아하고 견과류는 제외해주세요.')];
  await writer.saveChat(legacy,history);
  const original=structuredClone(f.rows.conversations);
  const repo=f.repo(),restored=await repo.load(empty());
  assert.deepEqual(restored.session.state.preferences,['category:coffee_tea']);
  assert.deepEqual(restored.session.state.excluded_categories,[]);
  assert.deepEqual(restored.session.state.excluded_ingredients,['우유','견과류']);
  assert.deepEqual(restored.messages,history);assert.ok(restored.migrationNotice);
  assert.deepEqual(f.rows.conversations,original); // Loading itself never rewrites account data.
  const api=createApi({catalog:async()=>[],fetcher:async()=>Response.json({id:'owner',role:'authenticated'})});
  const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',APP_ORIGINS:'',IP_LIMITER:{limit:async()=>({success:true})},USER_LIMITER:{limit:async()=>({success:true})}};
  const service=createServerChatService('https://worker.example/api/chat',f.client.auth,'owner',async(url,init)=>api.fetch(new Request(url,init),env));
  const turn=await service.send(restored.session,'예산 6만원',restored.messages);
  assert.equal(turn.session.state.budget.amount_krw,60000);
  assert.deepEqual(turn.session.state.excluded_ingredients,['우유','견과류']);
  const messages=[...history,message('예산 6만원'),{role:'assistant',text:turn.message}];
  await repo.saveChat(turn.session,messages);
  assert.equal(f.rows.conversations.length,1);
  assert.deepEqual((await f.repo().load(empty())).messages,messages);
  assert.deepEqual((await f.repo().load(empty())).migrationNotice,'');
});

const fb = (extra = {}) => ({ conversationId: '', giftId: 'g1', rank: 1, helpful: true, agentMode: 'full-chat', engineMode: 'llm', reason: '이유', at: '2026-11-07T00:00:00.000Z', ...extra });

test('card feedback rides on the chat commit stamped with the conversation id and reloads', async () => {
  const f = fixture(), repo = f.repo(); await repo.load(empty());
  repo.setFeedback([fb()]);
  await repo.saveChat(empty(), [message('first')]);
  const row = f.rows.conversations[0];
  assert.deepEqual(row.conditions._pass.feedback.map(x => [x.conversationId, x.giftId, x.agentMode]), [[row.id, 'g1', 'full-chat']]);
  const restored = await f.repo().load(empty());
  assert.equal(restored.feedback.length, 1);
  assert.equal(restored.feedback[0].conversationId, row.id);
});

test('feedback taps add no requests; one light update only when nothing carried them', async () => {
  const f = fixture(), repo = f.repo(); await repo.load(empty());
  await repo.saveFeedback(); // nothing committed yet: no write, no conversation
  assert.equal(f.rows.conversations.length, 0);
  await repo.saveChat(empty(), [message('first')]);
  const stampAfterChat = f.rows.conversations[0].updated_at;
  for (let i = 0; i < 20; i++) repo.setFeedback([fb({ helpful: i % 2 === 0 })]); // taps: memory only
  assert.equal(f.rows.conversations[0].updated_at, stampAfterChat);
  await repo.saveFeedback();
  const stampAfterFlush = f.rows.conversations[0].updated_at;
  assert.equal(stampAfterFlush, stampAfterChat + 1, 'a burst of taps costs exactly one update');
  assert.equal(f.rows.conversations[0].conditions._pass.feedback[0].helpful, false);
  await repo.saveFeedback();
  assert.equal(f.rows.conversations[0].updated_at, stampAfterFlush, 'unchanged feedback is not rewritten');
  assert.equal(f.rows.messages.length, 1, 'messages are not re-upserted by a feedback flush');
});

test('a chat commit that already carried the feedback makes the later flush a no-op', async () => {
  const f = fixture(), repo = f.repo(); await repo.load(empty());
  await repo.saveChat(empty(), [message('first')]);
  repo.setFeedback([fb()]);
  const flush = repo.saveFeedback();
  await repo.saveChat(empty(), [message('first'), message('second')]);
  await flush;
  const stamp = f.rows.conversations[0].updated_at;
  await repo.saveFeedback();
  assert.equal(f.rows.conversations[0].updated_at, stamp);
  assert.equal(f.rows.conversations[0].conditions._pass.feedback.length, 1);
});

test('old conversations without a feedback field still load', async () => {
  const f = fixture(), repo = f.repo(); await repo.load(empty());
  await repo.saveChat(empty(), [message('first')]);
  delete f.rows.conversations[0].conditions._pass.feedback;
  assert.deepEqual((await f.repo().load(empty())).feedback, []);
});

test('queued chat saves and feedback keep the historical recommendations', async () => {
  const f = fixture(), repo = f.repo();
  await repo.load(empty());
  const recommended = gift('recommended');
  const messages = [message('친구에게 과일 선물')];
  const first = repo.saveChat(empty(), messages, [recommended]);
  const next = repo.saveChat(empty(), [...messages, { role: 'assistant', text: '답변' }]);
  await Promise.all([first, next]);
  repo.setFeedback([fb()]);
  await repo.saveFeedback();
  const [chat] = await repo.listConversations();
  assert.deepEqual(await repo.loadConversation(chat.id), {
    messages: [...messages, { role: 'assistant', text: '답변' }],
    recommendations: [recommended],
  });
  assert.equal(chat.feedback.length, 1);
  await repo.saveChat(empty(), []);
  assert.deepEqual((await repo.loadConversation(repo.currentId())).recommendations, []);
});

test('history deletion is scoped to the account and cannot recreate the active conversation', async () => {
  const f = fixture(), repo = f.repo(); await repo.load(empty());
  await repo.saveChat(empty(), [message('지난 대화')]);
  const previous = repo.currentId();
  await repo.saveChat(empty(), []);
  const active = repo.currentId();
  await assert.rejects(repo.deleteConversation(active), /현재 대화/);
  f.rows.conversations.push({ ...structuredClone(f.rows.conversations[0]), user_id: 'other' });
  await repo.deleteConversation(previous);
  assert.deepEqual((await repo.listConversations()).map(chat => chat.id), [active]);
  assert.equal(f.rows.conversations.find(row => row.user_id === 'other').id, previous);
  f.switchOwner();
  await assert.rejects(repo.loadConversation(active), /로그인/);
});

test('a populated account preserves evaluation-time context across edits, failed writes and restoration', async () => {
  const f = fixture(), repo = f.repo(); await repo.load(empty());
  const s = { state: { ...empty().state, recipients: ['어머니'], occasion: '생일', preferences: ['category:coffee_tea'], budget: { amount_krw: 50000, shipping_included: true } }, issues: [] };
  const vote = record(products[1], s.state);
  repo.setFeedback([vote, { ...vote, kind: 'reason_helpfulness' }]);
  await repo.saveChat(s, [message('mother')]);
  const changed = { state: { ...s.state, recipients: ['친구'] }, issues: [] };
  f.fail('conversations:update');
  await assert.rejects(repo.saveChat(changed, [message('mother'), message('friend')]));
  await repo.saveChat(changed, [message('mother'), message('friend')]);
  const restored = await f.repo().load(empty());
  assert.equal(restored.feedback.length, 2);
  assert.deepEqual(restored.feedback[0].context, vote.context, 'final recipient does not relabel old votes');
  const signals = rankingFeedback(restored.feedback);
  const service = createLocalChatService(products, signals, scope), plain = createLocalChatService(products);
  assert.deepEqual(service.view(restored.session), plain.view(restored.session));
  const list = await f.repo().listConversations();
  assert.equal(list.length, 1);
  assert.equal(list[0].feedback.filter(v => v.kind === 'gift_preference').length, 1);
  f.switchOwner();
  repo.setFeedback([]);
  await assert.rejects(repo.saveFeedback(), /다시 로그인/);
});

test('resuming an archived conversation restores conditions and appends to the same message IDs', async () => {
  const f = fixture(), repo = f.repo(); await repo.load(empty());
  const first = { state: { ...empty().state, recipients: ['어머니'], occasion: '명절', budget: { amount_krw: 50000, shipping_included: true } }, issues: [] };
  repo.setFeedback([record(products[0], first.state)]);
  await repo.saveChat(first, [message('첫 대화')], [gift('historic')]);
  const firstId = repo.currentId();
  const originalIds = [...f.rows.conversations.find(c => c.id === firstId).conditions._pass.message_ids];
  await repo.saveChat(empty(), [message('다른 대화')]);
  const otherId = repo.currentId();
  const detail = await repo.resumeConversation(firstId);
  assert.equal(repo.currentId(), firstId);
  assert.deepEqual(detail.session, first);
  assert.deepEqual(detail.messages, [message('첫 대화')]);
  assert.deepEqual(detail.recommendations, [gift('historic')]);
  assert.equal(detail.feedback.length, 1);
  await repo.saveChat(first, [...detail.messages, message('이어서')]);
  assert.equal(f.rows.conversations.length, 2);
  assert.deepEqual(f.rows.conversations.find(c => c.id === firstId).conditions._pass.message_ids.slice(0, 1), originalIds);
  assert.deepEqual((await repo.loadConversation(firstId)).messages, [message('첫 대화'), message('이어서')]);
  assert.deepEqual((await repo.loadConversation(otherId)).messages, [message('다른 대화')]);
  assert.deepEqual((await f.repo().load(empty())).recommendations, [gift('historic')]);
});

test('failed or cancelled history loads preserve the active conversation and enforce ownership', async () => {
  const f = fixture(), repo = f.repo(); await repo.load(empty());
  await repo.saveChat(empty(), [message('현재')]); const id = repo.currentId();
  await assert.rejects(repo.resumeConversation('missing'));
  assert.equal(repo.currentId(), id);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(repo.resumeConversation(id, controller.signal), /취소/);
  assert.equal(repo.currentId(), id);
  f.switchOwner(); await assert.rejects(repo.resumeConversation(id), /로그인/);
});
