import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudRecords } from '../src/services/cloudRecords.ts';
import { createLocalChatService } from '../src/services/chatService.ts';
const empty = () => createLocalChatService([], {}).createSession();
const gift = id => ({ id, name: '선물', category: '차', price: 30000, description: '예시', icon: 'gift' });
const message = text => ({ role: 'user', text });
function fixture() {
  const rows = { gift_records: [], conversations: [], messages: [] }, writes = [];
  let counter = 0, owner = 'owner', fail = '', stamp = 0;
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: owner } } }, error: null }) },
    from(table) {
      let operation = 'select', payload, options, filters = [], sorting, maximum = 1000, start = 0;
      const query = {
        select() { return query; },
        eq(key, value) { filters.push(row => key === 'conditions->_pass->>committed' ? String(row.conditions._pass.committed) === value : row[key] === value); return query; },
        in(key, values) { filters.push(row => values.includes(row[key])); return query; },
        order(key, { ascending }) { sorting = [key, ascending]; return query; },
        range(from, to) { start = from; maximum = to - from + 1; return query; },
        limit(value) { maximum = value; return query; },
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
          resolve({ data: structuredClone(selected), error: null });
        },
      };
      return query;
    },
  };
  return { rows, writes, client, repo: () => createCloudRecords(client, 'owner', () => `uuid-${++counter}`), fail: value => { fail = value; }, switchOwner: () => { owner = 'other'; } };
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
