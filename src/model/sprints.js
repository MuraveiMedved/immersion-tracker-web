// Weekly/Monthly challenges (internally "sprints") - this person's own immersion targets, not
// tied to any race, mirroring the phone's data/race/RaceSprints.kt exactly. Weekly runs every week
// (Monday to Sunday), Monthly every calendar month, each from 4 AM. Progress is this person's
// immersion (rules.js counts - listening and reading in a language, as Momentum) from their own
// sessions. A reward is collectable the moment it's reached: a Weekly pays one random blue animal
// at 20h; a Monthly a nametag at 70h and a purple at 100h. An animal collected is a Zoo opening
// stored with its prize key as the rarity ("SPRINT:local:<key>:<RARITY>"), a nametag a Zoo nametag
// row with it as its id ("...:NAMETAG"). They used to run inside each race ("SPRINT:<race id>:...")
// - a reward collected that way counts for the same week or month now (isTaken).
import { RACE_DAY_START_HOUR } from './race.js'
import { ymdOf, ymdToEpochDay, epochDayToYmd, isValidYmd } from './time.js'
import { counts } from './rules.js'

const HOUR = 3_600_000
export const PRIZE_PREFIX = 'SPRINT:'
export const SPRINT_KINDS = [
  { id: 'WEEKLY', prefix: 'W', capHours: 20, milestones: [[1, 'BLUE']] },
  // null = a nametag rather than an animal.
  { id: 'MONTHLY', prefix: 'M', capHours: 100, milestones: [[0.7, null], [1, 'PURPLE']] },
]
export const NAMETAG = 'NAMETAG'
export const prizeKey = (eventId, key, rarity) => `${PRIZE_PREFIX}${eventId}:${key}:${rarity || NAMETAG}`

/** This browser's race day (yyyymmdd) for `ms` - a day starts at 4am (RaceMath.raceDayKey). */
export function raceDayKeyLocal(ms) {
  const d = new Date(ms)
  if (d.getHours() < RACE_DAY_START_HOUR) d.setDate(d.getDate() - 1)
  return ymdOf(d.getTime())
}

const ed = (ymd) => ymdToEpochDay(ymd)
const ymd = (n) => epochDayToYmd(n)
function monthEnd(n) {
  const y = Math.floor(ymd(n) / 10000), m = Math.floor(ymd(n) / 100) % 100
  return ed(m === 12 ? (y + 1) * 10000 + 101 : y * 10000 + (m + 1) * 100 + 1) - 1
}

/** What stands in a prize key's race slot now that challenges are this person's own. */
export const LOCAL_ID = 'local'
/** The first week (a Monday) and month challenges run as this person's own (RaceSprints.LOCAL_FIRST_*). */
const FIRST_WEEK = 20261019
const FIRST_MONTH = 20261001

/** The 4 AM that starts race day `ymd` (yyyymmdd), in this browser's time. */
const dayStartMs = (k) => new Date(Math.floor(k / 10000), Math.floor(k / 100) % 100 - 1, k % 100, RACE_DAY_START_HOUR).getTime()

/** This person's sprints that have begun - the running ones first (the week, then the month), then
 *  the rest newest first - as of `now`, from their sessions `entries` (RaceSprints.sprints). A
 *  session still running counts up to now; one crossing 4 AM is split between its days. */
export function localSprints(entries, now) {
  const todayKey = raceDayKeyLocal(now)
  if (!isValidYmd(todayKey)) return []
  const today = ed(todayKey)
  const countFrom = dayStartMs(FIRST_MONTH) - RACE_DAY_START_HOUR * HOUR
  const byDay = new Map()
  for (const e of entries) {
    if (!counts(e.contentType, e.languageProfileId)) continue
    const until = Math.min(e.endTimeMillis ?? now, now)
    if (until <= countFrom) continue
    let cursor = e.startTimeMillis
    while (cursor < until) {
      const day = raceDayKeyLocal(cursor)
      const next = dayStartMs(ymd(ed(day) + 1))
      const sliceEnd = Math.min(until, next)
      byDay.set(day, (byDay.get(day) || 0) + (sliceEnd - cursor))
      cursor = sliceEnd
    }
  }

  const out = []
  for (const kind of SPRINT_KINDS) {
    let start = ed(kind.id === 'WEEKLY' ? FIRST_WEEK : FIRST_MONTH)
    while (start <= today) {
      const end = kind.id === 'WEEKLY' ? start + 6 : monthEnd(start)
      const firstKey = ymd(start), lastKey = ymd(end)
      let mine = 0
      for (const [k, v] of byDay) if (k >= firstKey && k <= lastKey) mine += Math.max(0, v)
      const key = kind.prefix + (kind.id === 'WEEKLY' ? String(ymd(start)) : String(Math.floor(ymd(start) / 100)))
      const capMillis = kind.capHours * HOUR
      const milestones = kind.milestones.map(([share, rarity]) => {
        // Rounded - 0.7 of 100h is a hair under 70h in floating point.
        const millis = Math.round(capMillis * share)
        return { rarity, millis, reached: mine >= millis, sprintKey: key, prizeKey: prizeKey(LOCAL_ID, key, rarity) }
      })
      out.push({
        eventId: LOCAL_ID, kind: kind.id, key, capHours: kind.capHours, capMillis,
        firstDay: firstKey, lastDay: lastKey, myMillis: mine, ended: today > end,
        current: today >= start && today <= end,
        // Collectable as soon as reached - no waiting for the period to end.
        milestones, earned: milestones.filter((m) => m.reached),
      })
      start = end + 1
    }
  }
  // The running ones first (the week, then the month), then the rest newest first.
  const rank = (sp) => (sp.kind === 'WEEKLY' ? 0 : 1)
  return out.sort((a, b) => (b.current - a.current) || ((b.current ? 0 : b.lastDay) - (a.current ? 0 : a.lastDay)) || rank(a) - rank(b))
}

/** Collected - under this key, or under any race's key for the same week or month and reward. */
export function isTaken(m, taken) {
  if (taken.has(m.prizeKey)) return true
  const suffix = `:${m.sprintKey}:${m.rarity || NAMETAG}`
  for (const k of taken) if (k.startsWith(PRIZE_PREFIX) && k.endsWith(suffix)) return true
  return false
}

/** A sprint's rewards reached and not collected yet. */
export const waitingIn = (sp, taken) => sp.earned.filter((m) => !isTaken(m, taken))

/** Rewards reached and not collected yet, oldest sprint first. */
export const prizesWaiting = (sprints, taken) => [...sprints].sort((a, b) => a.lastDay - b.lastDay).flatMap((sp) => waitingIn(sp, taken))

/** When a sprint opens and closes: 4 AM on its first day, and 4 AM the day after its last. */
export const sprintStartMillis = (sprint) => dayStartMs(sprint.firstDay)
export const sprintEndMillis = (sprint) => dayStartMs(ymd(ed(sprint.lastDay) + 1))
