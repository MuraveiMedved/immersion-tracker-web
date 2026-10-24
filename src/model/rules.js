// What counts as immersion, goal streaks and Momentum (the golden streak) - ported one-to-one
// from the phone's Immersion.kt and StreakCalculator.kt so both give the same numbers.
import { epochDay, epochDayStart, goalDayStart, HOUR } from './time.js'

export const LISTENING = 'LISTENING' // music
export const PODCAST = 'PODCAST' // spoken listening - "Listening" in the UI
export const READING = 'READING'
export const ANKI = 'ANKI'
/** Not an entry type: the General goal's ring - listening and reading together (∞ icon). */
export const GENERAL = 'GENERAL'

/** A language's goals in effect (LanguageProfile.listeningGoal / readingGoal / generalGoalOrZero):
 *  with [generalGoal] on, one General goal replaces the separate listening and reading ones. */
export const listeningGoalOf = (p) => (p.generalGoal ? 0 : p.podcastGoalMinutes || 0)
export const readingGoalOf = (p) => (p.generalGoal ? 0 : p.readingGoalMinutes || 0)
export const generalGoalOf = (p) => (p.generalGoal ? p.generalGoalMinutes || 0 : 0)
/** The language's daily Anki goal (LanguageProfile.ankiGoal) - Anki is a third mode of each
 *  language, never part of the General goal; the retired Anki profile has none. */
export const ankiGoalOf = (p) => (p.isAnki ? 0 : p.ankiGoalMinutes || 0)
export const hasGoal = (p) => listeningGoalOf(p) > 0 || readingGoalOf(p) > 0 || generalGoalOf(p) > 0 || ankiGoalOf(p) > 0
/** Whether an entry type fills a goal ring of [goalType] - GENERAL takes listening and reading. */
export const fillsGoal = (goalType, type) => (goalType === GENERAL ? type === PODCAST || type === READING : type === goalType)

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

/** Momentum's tiers (MomentumTier.kt): days in a row of an hour each, and the holo chance eggs
 *  earned at that tier get. Bronze starts at GOLDEN_DAYS. */
export const MOMENTUM_TIERS = [
  { id: 'bronze', name: 'Bronze', minDays: 10, holoPercent: 10 },
  { id: 'silver', name: 'Silver', minDays: 30, holoPercent: 20 },
  { id: 'gold', name: 'Gold', minDays: 60, holoPercent: 25 },
  { id: 'diamond', name: 'Diamond', minDays: 100, holoPercent: 30 },
]

/** The tier a run of `days` has reached - null below Bronze. */
export function momentumTier(days) {
  let tier = null
  for (const t of MOMENTUM_TIERS) if (days >= t.minDays) tier = t
  return tier
}

/** The tier after `tier` (Bronze after none), or null at Diamond. */
export const nextMomentumTier = (tier) => (tier ? MOMENTUM_TIERS[MOMENTUM_TIERS.indexOf(tier) + 1] || null : MOMENTUM_TIERS[0])

export function goldenTodayMillis(entries, now = Date.now()) {
  return dailyMillis(entries, now, 1).get(epochDay(now)) || 0
}

/** Goal streak from per-day totals keyed by goal day (see dailyTotalsFor). Any missed day breaks
 *  it; today (the goal day, from 4 AM) not being met yet doesn't. */
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
  let cursor = epochDay(goalDayStart(now))
  if (!set.has(cursor)) cursor--
  while (set.has(cursor)) { current++; cursor-- }
  return { current, record }
}

/** Per-goal-day totals (keyed by the 4 AM start of the goal day a session started in, like the
 *  phone) for one language and content type (or GENERAL: listening and reading together). */
export function dailyTotalsFor(entries, profileId, type, now = Date.now()) {
  const totals = new Map()
  for (const e of entries) {
    if (e.languageProfileId !== profileId || !fillsGoal(type, e.contentType)) continue
    const d = goalDayStart(e.startTimeMillis)
    totals.set(d, (totals.get(d) || 0) + durationOf(e, now))
  }
  return totals
}

/** All-time immersion, a running session counting up to now. */
/**
 * [entries] as this browser can vouch for them: a session from another device (the phone, a
 * computer) that still looks running here is left out until its stop syncs. That device reports
 * its own live time; counted here up to "now", it grew without limit whenever the stop never
 * arrived (the phone offline, the app killed) - and the race report and profile sent from here
 * then showed friends hours that were never done. Used for everything sent or credited from here
 * (race scores, the profile, Zoo eggs, challenges), not for what's shown on screen.
 */
export const vouchedEntries = (entries) => entries.filter((e) => e.endTimeMillis != null || e.appPackage === 'web')

export function immersionTotal(entries, now = Date.now()) {
  let t = 0
  for (const e of entries) if (counts(e.contentType, e.languageProfileId)) t += durationOf(e, now)
  return t
}

export const typeLabel = (t) => ({ [PODCAST]: 'Listening', [READING]: 'Reading', [ANKI]: 'Anki', [LISTENING]: 'Music' }[t] || t)
