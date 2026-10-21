// Race Weekly/Monthly (internally "sprints") - personal immersion targets inside every race,
// mirroring the phone's data/race/RaceSprints.kt exactly. Weekly runs every week (Monday to
// Sunday), Monthly every calendar month, both cut to the race's days. Individual: only this
// person's own progress counts or shows. When one ends: a Weekly pays one random blue animal for
// reaching its 20h; a Monthly a blue at 70h and a purple at 100h (both stack).
// Nothing is stored on the race
// server; a reward collected is a Zoo opening stored with its prize key as the rarity
// ("SPRINT:<race id>:<key>:<RARITY>").
import { RACE_DAY_START_HOUR } from './race.js'
import { ymdOf, ymdToEpochDay, epochDayToYmd, isValidYmd } from './time.js'

const HOUR = 3_600_000
export const PRIZE_PREFIX = 'SPRINT:'
export const SPRINT_KINDS = [
  { id: 'WEEKLY', prefix: 'W', capHours: 20, milestones: [[1, 'BLUE']] },
  { id: 'MONTHLY', prefix: 'M', capHours: 100, milestones: [[0.7, 'BLUE'], [1, 'PURPLE']] },
]
export const prizeKey = (eventId, key, rarity) => `${PRIZE_PREFIX}${eventId}:${key}:${rarity}`

/** This browser's race day (yyyymmdd) for `ms` - a day starts at 4am (RaceMath.raceDayKey). */
export function raceDayKeyLocal(ms) {
  const d = new Date(ms)
  if (d.getHours() < RACE_DAY_START_HOUR) d.setDate(d.getDate() - 1)
  return ymdOf(d.getTime())
}

const ed = (ymd) => ymdToEpochDay(ymd)
const ymd = (n) => epochDayToYmd(n)
/** Monday of the week holding epoch day n (1970-01-01 was a Thursday). */
const mondayOf = (n) => n - ((((n + 3) % 7) + 7) % 7)
const monthStart = (n) => ed(Math.floor(ymd(n) / 100) * 100 + 1)
function monthEnd(n) {
  const y = Math.floor(ymd(n) / 10000), m = Math.floor(ymd(n) / 100) % 100
  return ed(m === 12 ? (y + 1) * 10000 + 101 : y * 10000 + (m + 1) * 100 + 1) - 1
}

/** `userId`'s sprints in `event` that have begun - the running ones first (the week, then the
 *  month), then the rest newest first - as of `now` (RaceSprints.sprints). */
export function sprintsFor(event, userId, now) {
  const me = (event.standings || []).find((s) => s.userId === userId)
  if (!me) return []
  const todayKey = raceDayKeyLocal(now)
  const raceFirstKey = raceDayKeyLocal(event.startMillis)
  if (!isValidYmd(todayKey) || !isValidYmd(raceFirstKey)) return []
  const today = ed(todayKey)
  const raceFirst = ed(raceFirstKey)
  const raceLast = event.endMillis != null ? ed(raceDayKeyLocal(event.endMillis - 1)) : null
  const lastShown = raceLast != null && raceLast < today ? raceLast : today
  if (lastShown < raceFirst) return []
  const raceOver = event.endMillis != null && now >= event.endMillis

  const out = []
  for (const kind of SPRINT_KINDS) {
    let start = kind.id === 'WEEKLY' ? mondayOf(raceFirst) : monthStart(raceFirst)
    while (start <= lastShown) {
      const end = kind.id === 'WEEKLY' ? start + 6 : monthEnd(start)
      const first = Math.max(start, raceFirst)
      const last = raceLast != null && raceLast < end ? raceLast : end
      const firstKey = ymd(first), lastKey = ymd(last)
      let mine = 0
      for (const [k, v] of Object.entries(me.daily || {})) if (+k >= firstKey && +k <= lastKey) mine += Math.max(0, Number(v) || 0)
      const key = kind.prefix + (kind.id === 'WEEKLY' ? String(ymd(start)) : String(Math.floor(ymd(start) / 100)))
      const capMillis = kind.capHours * HOUR
      const ended = today > last || (raceOver && raceLast != null && last === raceLast)
      const milestones = kind.milestones.map(([share, rarity]) => {
        // Rounded - 0.7 of 100h is a hair under 70h in floating point.
        const millis = Math.round(capMillis * share)
        return { rarity, millis, reached: mine >= millis, prizeKey: prizeKey(event.id, key, rarity) }
      })
      out.push({
        eventId: event.id, kind: kind.id, key, capHours: kind.capHours, capMillis,
        firstDay: firstKey, lastDay: lastKey, myMillis: mine, ended,
        current: today >= first && today <= last && !raceOver,
        milestones, earned: ended ? milestones.filter((m) => m.reached) : [],
      })
      start = end + 1
    }
  }
  // The running ones first (the week, then the month), then the rest newest first.
  const rank = (sp) => (sp.kind === 'WEEKLY' ? 0 : 1)
  return out.sort((a, b) => (b.current - a.current) || ((b.current ? 0 : b.lastDay) - (a.current ? 0 : a.lastDay)) || rank(a) - rank(b))
}

/** Rewards earned in sprints that are over and not collected yet, oldest first. */
export const prizesWaiting = (sprints, taken) => [...sprints].sort((a, b) => a.lastDay - b.lastDay).flatMap((sp) => sp.earned).filter((m) => !taken.has(m.prizeKey))

/** When a sprint opens: 4am on its first day (or the race's start, if later). */
export function sprintStartMillis(event, sprint) {
  const k = sprint.firstDay
  const ms = new Date(Math.floor(k / 10000), Math.floor(k / 100) % 100 - 1, k % 100, RACE_DAY_START_HOUR).getTime()
  return Math.max(event.startMillis, ms)
}

/** When a running sprint closes: 4am after its last day (or the race's end, if sooner). */
export function sprintEndMillis(event, sprint) {
  const n = ed(sprint.lastDay) + 1
  const y = Math.floor(ymd(n) / 10000), m = Math.floor(ymd(n) / 100) % 100, d = ymd(n) % 100
  const ms = new Date(y, m - 1, d, RACE_DAY_START_HOUR).getTime()
  return event.endMillis != null ? Math.min(event.endMillis, ms) : ms
}
