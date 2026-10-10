import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshotPersistence } from '../src/services/snapshotPersistence.ts';

test('reverting to the loaded value during an in-flight save persists the final intent', async () => {
  const persistence = createSnapshotPersistence(); persistence.restore({ gifts: 'A' });
  let release, stored = 'A';
  const blocker = new Promise(resolve => { release = resolve; });
  let queue = Promise.resolve();
  const save = value => { queue = queue.then(async () => { await blocker; stored = value; }); return queue; };
  const first = persistence.write('gifts', 'B', () => save('B'));
  const second = persistence.write('gifts', 'A', () => save('A'));
  assert.ok(second); release(); await Promise.all([first, second]);
  assert.equal(stored, 'A');
});

test('a failed intent can be retried while an older failure cannot invalidate the latest intent', async () => {
  const persistence = createSnapshotPersistence(); persistence.restore({ chat: 'A' });
  let rejectFirst;
  const first = persistence.write('chat', 'B', () => new Promise((_, reject) => { rejectFirst = reject; }));
  const rejection = assert.rejects(first, /network/);
  await persistence.write('chat', 'C', async () => {});
  rejectFirst(new Error('network')); await rejection;
  assert.equal(persistence.write('chat', 'C', async () => { throw Error('must skip'); }), null);
  await assert.rejects(persistence.write('chat', 'D', async () => { throw Error('network'); }));
  let persisted;
  await persistence.write('chat', 'D', async () => { persisted = 'D'; });
  assert.equal(persisted, 'D');
});

test('explicit retry allows all current collections to be submitted again', async () => {
  const persistence = createSnapshotPersistence(); persistence.restore({ gifts: 'A', chat: 'B' });
  persistence.retry(); const writes = [];
  await persistence.write('gifts', 'A', async () => { writes.push('gifts'); });
  await persistence.write('chat', 'B', async () => { writes.push('chat'); });
  assert.deepEqual(writes, ['gifts', 'chat']);
});
