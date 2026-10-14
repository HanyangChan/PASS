import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCalendarEvents } from '../src/storage.ts';
import { daysUntil, nextOccurrence, sortByUpcoming, upcomingWithin } from '../src/services/calendarDates.ts';
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
  assert.deepEqual(decoded.map(e => e.id), ['a', 'e']);
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
