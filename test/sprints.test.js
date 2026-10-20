// Run with: TZ=America/Chicago npm test - mirrors the phone's RaceSprintsTest.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fnv1a, mulberry32, sprintChoices, sprintsFor } from '../src/model/sprints.js'

const HOUR = 3_600_000
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime()
const pool = Array.from({ length: 40 }, (_, i) => 'animal_' + String(i).padStart(2, '0'))
const standing = (id, daily, final = false) => ({ userId: id, name: id, daily: Object.fromEntries(Object.entries(daily).map(([k, v]) => [k, v])), final })
const event = (standings, endMillis = null) => ({ id: 'race-1', startMillis: at(2026, 10, 7, 9), endMillis, standings })

test('sprint choices match the phone', () => {
  assert.equal(fnv1a('race-123:W20261019'), 689044659)
  const r = mulberry32(42)
  assert.deepEqual([r(), r(), r()], [2581720956, 1925393290, 3661312704])
  assert.deepEqual(sprintChoices('race-123:W20261019', pool), ['animal_34', 'animal_16', 'animal_35', 'animal_15', 'animal_28'])
  assert.deepEqual(sprintChoices('abc:M202610', [...pool].reverse()), ['animal_31', 'animal_29', 'animal_07', 'animal_10', 'animal_24'])
})

test('sprints: weeks and months cut to the race', () => {
  const sprints = sprintsFor(event([standing('a', {}), standing('b', {})]), at(2026, 10, 20), () => pool)
  assert.deepEqual(sprints.map((s) => s.key), ['W20261019', 'M202610', 'W20261012', 'W20261005'])
  const first = sprints.find((s) => s.key === 'W20261005')
  assert.equal(first.firstDay, 20261007)
  assert.equal(first.lastDay, 20261011)
  assert.equal(sprints[0].current, true)
})

test('sprints: most immersion wins once the grace day passes', () => {
  const e = event([standing('a', { 20261012: 3 * HOUR, 20261018: HOUR, 20261019: 9 * HOUR }), standing('b', { 20261013: 2 * HOUR, 20261014: 3 * HOUR })])
  assert.equal(sprintsFor(e, at(2026, 10, 19), () => pool).find((s) => s.key === 'W20261012').decided, false)
  const s = sprintsFor(e, at(2026, 10, 20), () => pool).find((x) => x.key === 'W20261012')
  assert.equal(s.decided, true)
  assert.deepEqual(s.winners, ['b'])
  assert.equal(s.prizeKey, 'SPRINT:race-1:W20261012')
})

test('sprints: alone has no winner, ties share, finished race decides when final', () => {
  assert.ok(sprintsFor(event([standing('a', { 20261008: HOUR })]), at(2026, 10, 20), () => pool).every((s) => !s.winners.length))
  const tie = sprintsFor(event([standing('a', { 20261008: HOUR }), standing('b', { 20261009: HOUR })]), at(2026, 10, 20), () => pool)
  assert.deepEqual(tie.find((s) => s.key === 'W20261005').winners.sort(), ['a', 'b'])
  const done = sprintsFor(event([standing('a', { 20261008: HOUR }, true), standing('b', {}, true)], at(2026, 10, 9, 18)), at(2026, 10, 10), () => pool)
  assert.deepEqual(done.map((s) => s.key), ['W20261005', 'M202610'])
  assert.ok(done.every((s) => s.decided && s.winners.join() === 'a' && s.lastDay === 20261009))
})
