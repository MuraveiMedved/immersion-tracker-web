// What counts as immersion, goal streaks and Momentum (the golden streak) - ported one-to-one
// from the phone's Immersion.kt and StreakCalculator.kt so both give the same numbers.
import { epochDay, epochDayStart, dayStart, HOUR } from './time.js'

export const LISTENING = 'LISTENING' // music
export const PODCAST = 'PODCAST' // spoken listening - "Listening" in the UI
export const READING = 'READING'
export const ANKI = 'ANKI'

export const GOLDEN_DAYS = 10
export const GOLDEN_DAILY_MILLIS = HOUR
const MAX_GOLDEN_LOOKBACK_DAYS = 400

export const durationOf = (e, now = Date.now()) => Math.max(0, (e.endTimeMillis ?? now) - e.startTimeMillis)

/** Immersion is spoken listening or reading, with a language - not music, not Anki. */
export const counts = (type, languageProfileId) => languageProfileId != null && (type === PODCAST || type === READING)

/** Immersion per epoch day for the last [days] days up to [now] - a running session counts up to
 *  now, and one crossing midnight is split between its days. */
export function dailyMillis(entries, now, days = GOLDEN_DAYS + 1) {
  const today = epochDay(now)
  const firstDay = today - (days - 1)
  const windowStart = epochDayStart(firstDay)
  const totals = new Map()
  for (const e of entries) {
    if (!counts(e.contentType, e.languageProfileId)) continue
    const end = Math.min(e.endTimeMillis ?? now, now)
    if (end <= windowStart) continue
    let start = e.startTimeMillis
    while (start < end) {
      const day = epochDay(start)
      const partEnd = Math.min(end, epochDayStart(day + 1))
      if (day >= firstDay && day <= today) totals.set(day, (totals.get(day) || 0) + (partEnd - start))
      start = partEnd
    }
  }
  return totals
}

/** Days in a row with 1+ hour - today counts once it reaches that, otherwise up to yesterday. */
export function goldenStreakDays(entries, now = Date.now()) {
  const daily = dailyMillis(entries, now, MAX_GOLDEN_LOOKBACK_DAYS)
  const today = epochDay(now)
  const met = (d) => (daily.get(d) || 0) >= GOLDEN_DAILY_MILLIS
  let day = met(today) ? today : today - 1
  let run = 0
  while (run < MAX_GOLDEN_LOOKBACK_DAYS - 1 && met(day)) { run++; day-- }
  return run
}

export const isGolden = (entries, now = Date.now()) => goldenStreakDays(entries, now) >= GOLDEN_DAYS

export function goldenTodayMillis(entries, now = Date.now()) {
  return dailyMillis(entries, now, 1).get(epochDay(now)) || 0
}

/** Goal streak from per-day totals keyed by local midnight. Any missed day breaks it; today not
 *  being met yet doesn't. */
export function computeStreak(dailyTotals, goalMillis, now = Date.now()) {
  if (goalMillis <= 0) return { current: 0, record: 0 }
  const metDays = []
  for (const [dayMs, total] of dailyTotals) if (total >= goalMillis) metDays.push(epochDay(dayMs))
  if (!metDays.length) return { current: 0, record: 0 }
  metDays.sort((a, b) => a - b)
  const set = new Set(metDays)
  let record = 0, run = 0, prev = null
  for (const d of metDays) {
    if (d === prev) continue
    run = prev != null && d === prev + 1 ? run + 1 : 1
    record = Math.max(record, run)
    prev = d
  }
  let current = 0
  let cursor = epochDay(now)
  if (!set.has(cursor)) cursor--
  while (set.has(cursor)) { current++; cursor-- }
  return { current, record }
}

/** Per-day totals (keyed by local midnight of the start day, like the phone) for one language and
 *  content type. */
export function dailyTotalsFor(entries, profileId, type, now = Date.now()) {
  const totals = new Map()
  for (const e of entries) {
    if (e.languageProfileId !== profileId || e.contentType !== type) continue
    const d = dayStart(e.startTimeMillis)
    totals.set(d, (totals.get(d) || 0) + durationOf(e, now))
  }
  return totals
}

/** All-time immersion, a running session counting up to now. */
export function immersionTotal(entries, now = Date.now()) {
  let t = 0
  for (const e of entries) if (counts(e.contentType, e.languageProfileId)) t += durationOf(e, now)
  return t
}

export const typeLabel = (t) => ({ [PODCAST]: 'Listening', [READING]: 'Reading', [ANKI]: 'Anki', [LISTENING]: 'Music' }[t] || t)
