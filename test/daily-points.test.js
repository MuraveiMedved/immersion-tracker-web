// Mirrors the phone's DailyPointsTest.
import test from 'node:test'
import assert from 'node:assert/strict'
import { dailyPoints } from '../src/model/race.js'

const HOUR = 3_600_000
const days = [20261108, 20261109, 20261110]
// 20:00 UTC on Nov 9: 05:00 Nov 10 in Tokyo, 14:00 Nov 9 in Chicago.
const now = Date.UTC(2026, 10, 9, 20)
const st = (timeZone, daily) => ({ timeZone, dayStartHour: 4, daily })

test('day by day: someone still on today ends on today', () => {
  assert.deepEqual(dailyPoints(st('America/Chicago', { 20261108: HOUR, 20261109: 2 * HOUR }), days, now), [HOUR, 2 * HOUR])
})

test('day by day: someone ahead reaches the new day', () => {
  assert.deepEqual(dailyPoints(st('Asia/Tokyo', { 20261109: HOUR, 20261110: HOUR / 2 }), days, now), [0, HOUR, HOUR / 2])
})

test('day by day: before the day start hour it is still yesterday', () => {
  assert.deepEqual(dailyPoints(st('Asia/Tokyo', { 20261109: HOUR }), days, now - 4 * HOUR), [0, HOUR])
})
