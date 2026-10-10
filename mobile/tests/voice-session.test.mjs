import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceSession } from '../src/voiceSession.mjs';

test('closing and reopening invalidates an outstanding permission request', async () => {
  const session = createVoiceSession();
  session.open();
  const request = session.begin();
  let release;
  const permission = new Promise(resolve => { release = resolve; });
  let starts = 0;
  const oldRequest = permission.then(() => { if (session.isCurrent(request)) starts += 1; });
  session.close(); session.open();
  release(); await oldRequest;
  assert.equal(starts, 0);
  assert.equal(session.finish(request), false);
  assert.notEqual(session.begin(), null);
});

test('only one permission request can prepare at a time', () => {
  const session = createVoiceSession(); session.open();
  const request = session.begin();
  assert.equal(session.begin(), null);
  assert.equal(session.finish(request), true);
  assert.notEqual(session.begin(), null);
});

test('an old completion cannot unlock a new pending request', () => {
  const session = createVoiceSession(); session.open();
  const old = session.begin(); session.close(); session.open();
  const current = session.begin();
  assert.equal(session.finish(old), false);
  assert.equal(session.begin(), null);
  assert.equal(session.finish(current), true);
});

test('unmount cancellation prevents recognition and new starts', () => {
  const session = createVoiceSession(); session.open();
  const request = session.begin(); session.close();
  assert.equal(session.isCurrent(request), false);
  assert.equal(session.begin(), null);
});
