// Run with: TZ=America/Chicago npm test - mirrors the phone's RaceSprintsTest.
import test from 'node:test'
import assert from 'node:assert/strict'
import { sprintsFor } from '../src/model/sprints.js'

const HOUR = 3_600_000
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime()
const standing = (id, daily, final = false) => ({ userId: id, name: id, daily, final })
const event = (standings, endMillis = null) => ({ id: 'race-1', startMillis: at(2026, 10, 7, 9), endMillis, standings })

test('weekly/monthly: every week and month, cut to the race', () => {
  const sprints = sprintsFor(event([standing('me', {})]), 'me', at(2026, 10, 20))
  assert.deepEqual(sprints.map((s) => s.key), ['W20261019', 'M202610', 'W20261012', 'W20261005'])
  const first = sprints.find((s) => s.key === 'W20261005')
  assert.equal(first.firstDay, 20261007)
  assert.equal(first.lastDay, 20261011)
  assert.ok(sprints[0].current && sprints[1].current && first.ended)
})

test('weekly pays one blue at 20h, collectable as soon as reached', () => {
  const me = standing('me', { 20261012: 12 * HOUR, 20261013: 9 * HOUR, 20261019: 26 * HOUR })
  const sprints = sprintsFor(event([me, standing('other', { 20261012: 99 * HOUR })]), 'me', at(2026, 10, 20))
  const last = sprints.find((s) => s.key === 'W20261012')
  assert.equal(last.myMillis, 21 * HOUR)
  assert.deepEqual(last.earned.map((m) => m.rarity), ['BLUE'])
  assert.equal(last.earned[0].prizeKey, 'SPRINT:race-1:W20261012:BLUE')
  const now = sprints.find((s) => s.key === 'W20261019')
  assert.ok(now.current && now.milestones.every((m) => m.reached))
  assert.deepEqual(now.earned.map((m) => m.rarity), ['BLUE'])
  assert.deepEqual(now.milestones.map((m) => m.millis), [20 * HOUR])
})

test('monthly pays a nametag at 70h and purple at 100h; not in the race = none; race end cuts', () => {
  const daily = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [String(20261001 + i), 4 * HOUR]))
  const oct = sprintsFor(event([standing('me', daily)]), 'me', at(2026, 11, 2)).find((s) => s.key === 'M202610')
  assert.deepEqual(oct.earned.map((m) => m.rarity), [null, 'PURPLE'])
  assert.equal(oct.earned[0].prizeKey, 'SPRINT:race-1:M202610:NAMETAG')
  // Mid-month, 70h in (the race began on the 7th): the nametag is collectable already.
  const midDaily = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [String(20261007 + i), 5 * HOUR]))
  const mid = sprintsFor(event([standing('me', midDaily)]), 'me', at(2026, 10, 20)).find((s) => s.key === 'M202610')
  assert.ok(mid.current)
  assert.deepEqual(mid.earned.map((m) => m.rarity), [null])
  assert.deepEqual(oct.milestones.map((m) => m.millis), [70 * HOUR, 100 * HOUR])
  assert.equal(sprintsFor(event([standing('a', {})]), 'me', at(2026, 10, 20)).length, 0)
  const done = sprintsFor(event([standing('me', { 20261008: 20 * HOUR })], at(2026, 10, 9, 18)), 'me', at(2026, 10, 9, 20))
  assert.deepEqual(done.map((s) => s.key), ['W20261005', 'M202610'])
  assert.ok(done.every((s) => s.ended && !s.current && s.lastDay === 20261009))
  assert.deepEqual(done[0].earned.map((m) => m.rarity), ['BLUE'])
})
