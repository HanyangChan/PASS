import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCalendarEvents } from '../src/storage.ts';
import { isValidMonthDay, daysUntil, nextOccurrence, sortByUpcoming, upcomingWithin } from '../src/services/calendarDates.ts';
import { createCalendarRepository } from '../src/services/calendarRepository.ts';
const event = (id, date, kind = 'birthday') => ({ id, title: `이벤트 ${id}`, date, kind });

test('decodeCalendarEvents keeps valid entries and drops malformed ones', () => {
  const values = [
    event('a', '10-21'),
    { id: 'b', title: '', date: '10-21', kind: 'birthday' }, // blank title
    { id: 'c', title: '기념일', date: '13-01', kind: 'birthday' }, // invalid month
    { id: 'd', title: '기념일', date: '10-21', kind: 'unknown' }, // invalid kind
    event('e', '02-30', 'anniversary'),
  ];
  const decoded = decodeCalendarEvents(JSON.stringify(values));
  assert.deepEqual(decoded.map(e => e.id), ['a']);
});

test('decodeCalendarEvents treats missing storage as empty and rejects non-array JSON', () => {
  assert.deepEqual(decodeCalendarEvents(null), []);
  assert.throws(() => decodeCalendarEvents('{"not":"an array"}'));
});

test('daysUntil rolls an already-passed date forward to next year', () => {
  const today = new Date(2026, 9, 14); // Oct 14, 2026
  assert.equal(daysUntil('10-21', today), 7);
  assert.equal(daysUntil('10-14', today), 0);
  assert.equal(nextOccurrence('01-01', today).getFullYear(), 2027);
  assert.equal(nextOccurrence('12-25', today).getFullYear(), 2026);
});

test('sortByUpcoming and upcomingWithin order by days remaining and respect the cutoff', () => {
  const today = new Date(2026, 9, 14);
  const events = [event('far', '12-25'), event('soon', '10-21'), event('today', '10-14')];
  assert.deepEqual(sortByUpcoming(events, today).map(e => e.id), ['today', 'soon', 'far']);
  assert.deepEqual(upcomingWithin(events, 7, today).map(e => e.id), ['today', 'soon']);
});

test('calendarRepository persists events and restores them with decodeCalendarEvents', async () => {
  const store = new Map();
  const repo = createCalendarRepository({
    getItem: async key => store.get(key) ?? null,
    setItem: async (key, value) => { store.set(key, value); },
  });
  assert.deepEqual(await repo.load(), []);
  await repo.save([event('a', '10-21')]);
  assert.deepEqual(await repo.load(), [event('a', '10-21')]);
});


test('recurring dates reject impossible days but accept February 29', () => {
  for (const date of ['02-30', '02-31', '04-31', '06-31', '11-31', '2-09']) {
    assert.equal(isValidMonthDay(date), false, date);
    assert.throws(() => nextOccurrence(date), RangeError);
  }
  for (const date of ['02-29', '04-30', '12-31']) assert.equal(isValidMonthDay(date), true, date);
});

test('February 29 uses the next real leap day without normalizing to March 1', () => {
  for (const [today, year] of [[new Date(2027, 2, 2), 2028], [new Date(2028, 1, 29), 2028], [new Date(2028, 2, 1), 2032], [new Date(2096, 2, 1), 2104]]) {
    const next = nextOccurrence('02-29', today);
    assert.deepEqual([next.getFullYear(), next.getMonth(), next.getDate()], [year, 1, 29]);
  }
  assert.equal(daysUntil('02-29', new Date(2028, 1, 28)), 1);
});

test('failed calendar reads cannot overwrite stored events and can be retried', async () => {
  const original = JSON.stringify([event('a', '10-21')]);
  let stored = original, fail = true;
  const repo = createCalendarRepository({
    getItem: async () => { if (fail) throw new Error('temporary read failure'); return stored; },
    setItem: async (_key, value) => { stored = value; },
  });
  await assert.rejects(repo.load(), /temporary read failure/);
  await assert.rejects(repo.save([]), /not loaded successfully/);
  assert.equal(stored, original);
  fail = false;
  assert.deepEqual(await repo.load(), [event('a', '10-21')]);
  await repo.save([]);
  assert.equal(stored, '[]');
});

test('invalid JSON fails restoration rather than silently erasing it', async () => {
  let stored = '{broken';
  const repo = createCalendarRepository({getItem: async () => stored, setItem: async (_key, value) => {stored = value;}});
  await assert.rejects(repo.load());
  await assert.rejects(repo.save([]));
  assert.equal(stored, '{broken');
});
