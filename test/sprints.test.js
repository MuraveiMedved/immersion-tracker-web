// Run with: TZ=America/Chicago npm test - mirrors the phone's RaceSprintsTest.
import test from 'node:test'
import assert from 'node:assert/strict'
import { localSprints, isTaken, waitingIn, LOCAL_ID } from '../src/model/sprints.js'

const HOUR = 3_600_000
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime()
const session = (start, hours, { type = 'PODCAST', language = 1, running = false } = {}) => ({
  startTimeMillis: start, endTimeMillis: running ? null : start + hours * HOUR, contentType: type, languageProfileId: language,
})

test('challenges: weeks and months from when they became local', () => {
  const sprints = localSprints([], at(2026, 11, 4))
  assert.deepEqual(sprints.map((s) => s.key), ['W20261102', 'M202611', 'W20261026', 'M202610', 'W20261019'])
  assert.ok(sprints[0].current && sprints[1].current)
  assert.ok(sprints.slice(2).every((s) => s.ended && !s.current))
  assert.ok(sprints.every((s) => s.eventId === LOCAL_ID))
  assert.equal(sprints[0].firstDay, 20261102)
  assert.equal(sprints[0].lastDay, 20261108)
})

test('challenges: a week counts own immersion and pays one blue', () => {
  const entries = [
    session(at(2026, 10, 20), 12),
    session(at(2026, 10, 21), 9, { type: 'READING' }),
    session(at(2026, 10, 22), 30, { language: null }),
    session(at(2026, 10, 22), 30, { type: 'LISTENING' }),
    session(at(2026, 10, 18), 10),
  ]
  const week = localSprints(entries, at(2026, 10, 23)).find((s) => s.key === 'W20261019')
  assert.equal(week.myMillis, 21 * HOUR)
  assert.deepEqual(week.earned.map((m) => m.rarity), ['BLUE'])
  assert.equal(week.earned[0].prizeKey, 'SPRINT:local:W20261019:BLUE')
})

test('challenges: a running session counts to now; one across 4 AM is split', () => {
  const sprints = localSprints([session(at(2026, 10, 25, 23), 8), session(at(2026, 10, 28, 9), 0, { running: true })], at(2026, 10, 28, 12))
  assert.equal(sprints.find((s) => s.key === 'W20261019').myMillis, 5 * HOUR)
  assert.equal(sprints.find((s) => s.key === 'W20261026').myMillis, 6 * HOUR)
})

test('challenges: a month pays a nametag at 70h and an epic at 100h', () => {
  const entries = Array.from({ length: 25 }, (_, i) => session(at(2026, 10, i + 1), 4))
  const oct = localSprints(entries, at(2026, 11, 2)).find((s) => s.key === 'M202610')
  assert.deepEqual(oct.earned.map((m) => m.rarity), [null, 'PURPLE'])
  assert.equal(oct.earned[0].prizeKey, 'SPRINT:local:M202610:NAMETAG')
})

test('challenges: a reward collected in a race counts for the same week', () => {
  const week = localSprints([session(at(2026, 10, 20), 25)], at(2026, 10, 23)).find((s) => s.key === 'W20261019')
  const blue = week.earned[0]
  assert.equal(isTaken(blue, new Set()), false)
  assert.equal(isTaken(blue, new Set(['SPRINT:race-1:W20261019:BLUE'])), true)
  assert.equal(isTaken(blue, new Set(['SPRINT:race-1:W20261012:BLUE'])), false)
  assert.equal(waitingIn(week, new Set(['SPRINT:local:W20261019:BLUE'])).length, 0)
})
