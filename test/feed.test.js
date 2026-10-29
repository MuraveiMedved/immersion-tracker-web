import test from 'node:test'
import assert from 'node:assert/strict'
import { readProfile, recentZooEvents, zooFeed, FEED_SHARED, FEED_MAX_LINES } from '../src/model/race.js'
import { DAY } from '../src/model/time.js'

const now = 100 * DAY

test('recent zoo events are the latest few, newest first', () => {
  const openings = Array.from({ length: 15 }, (_, i) => ({ id: String(i + 1), animalId: `a${i + 1}`, atMillis: (i + 1) * 1000, upgradeKey: i === 14, cert: i === 13 ? { foil: true } : null }))
  const events = recentZooEvents(openings)
  assert.equal(events.length, FEED_SHARED)
  assert.deepEqual(events[0], { atMillis: 15000, animalId: 'a15', tradeUp: true, holo: false })
  assert.deepEqual(events[1], { atMillis: 14000, animalId: 'a14', tradeUp: false, holo: true })
})

test('a phone profile\'s "ze" reads the same here; none from older versions', () => {
  const p = readProfile({ userId: 't', name: 'Trenton', profile: { v: 1, ze: [[now - 1000, 'snow_leopard', 1, 1], [now - 5000, 'fennec_fox', 0, 0], ['bad'], [now, '', 0, 0]] } })
  assert.deepEqual(p.zooEvents, [
    { atMillis: now - 1000, animalId: 'snow_leopard', tradeUp: true, holo: true },
    { atMillis: now - 5000, animalId: 'fennec_fox', tradeUp: false, holo: false },
  ])
  assert.equal(readProfile({ userId: 'x', profile: { v: 1 } }).zooEvents, null)
})

test('the feed merges, orders, dedupes and drops old or unknown animals', () => {
  const ev = (atMillis, animalId, tradeUp = false) => ({ atMillis, animalId, tradeUp, holo: false })
  const lines = zooFeed({
    mine: [ev(now - 500, 'orca')],
    myName: 'Me',
    myUserId: 'me',
    people: [
      { userId: 't', name: 'Trenton', updatedAt: 1, zooEvents: [ev(now - 3000, 'orca')] },
      { userId: 'b', name: 'Blake', updatedAt: 5, zooEvents: [ev(now - 1000, 'snow_leopard', true), ev(now - 4000, 'mystery')] },
      { userId: 't', name: 'Trenton', updatedAt: 9, zooEvents: [ev(now - 2000, 'fennec_fox'), ev(now - 20 * DAY, 'okapi')] },
      { userId: 'me', name: 'Me', updatedAt: 9, zooEvents: [ev(now - 10, 'orca')] },
    ],
    known: (id) => id !== 'mystery',
    now,
  })
  assert.deepEqual(lines.map((l) => [l.userId, l.event.animalId]), [[null, 'orca'], ['b', 'snow_leopard'], ['t', 'fennec_fox']])
})

test('earlier holo finds come after the latest few and stay in the feed', () => {
  const openings = Array.from({ length: 15 }, (_, i) => ({ id: String(i + 1), animalId: `a${i + 1}`, atMillis: (i + 1) * 1000, cert: i === 1 ? { foil: true } : null }))
  const events = recentZooEvents(openings)
  assert.equal(events.length, FEED_SHARED + 1)
  assert.deepEqual(events.at(-1), { atMillis: 2000, animalId: 'a2', tradeUp: false, holo: true })
  const ze = events.map((e) => [e.atMillis, e.animalId, e.tradeUp ? 1 : 0, e.holo ? 1 : 0])
  assert.equal(readProfile({ userId: 't', profile: { v: 1, ze } }).zooEvents.length, FEED_SHARED + 1)
  const ev = (atMillis, animalId, holo = false) => ({ atMillis, animalId, tradeUp: false, holo })
  const recent = Array.from({ length: FEED_MAX_LINES }, (_, i) => ev(now - (i + 1) * 1000, 'fennec_fox'))
  const lines = zooFeed({ mine: [...recent, ev(now - 40 * DAY, 'okapi', true), ev(now - 40 * DAY, 'orca')], myName: 'Me', myUserId: 'me', people: [], known: () => true, now })
  assert.equal(lines.length, FEED_MAX_LINES + 1)
  assert.equal(lines.at(-1).event.animalId, 'okapi')
})
