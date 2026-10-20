// Race sprints - a weekly (Monday to Sunday) and a monthly contest inside every race, shared by
// everyone in it. Mirrors the phone's data/race/RaceSprints.kt exactly: worked out from each
// racer's per-day totals (nothing stored on the race server), the five prize animals picked by a
// fixed generator seeded from the race id and the sprint's key - so phone and web show the same
// five. A week wins a Rare (blue), a month an Epic (purple); the winner picks one. A prize taken is
// a Zoo opening stored with its prize key as the rarity ("SPRINT:<race id>:<key>").
import { RACE_DAY_START_HOUR } from './race.js'
import { ymdOf, ymdToEpochDay, epochDayToYmd, isValidYmd } from './time.js'

export const SPRINT_CHOICES = 5
export const PRIZE_PREFIX = 'SPRINT:'
export const SPRINT_KINDS = [
  { id: 'WEEKLY', prefix: 'W', rarity: 'BLUE' },
  { id: 'MONTHLY', prefix: 'M', rarity: 'PURPLE' },
]
export const prizeKey = (eventId, key) => `${PRIZE_PREFIX}${eventId}:${key}`

/** 32-bit FNV-1a over UTF-16 units (RaceSprints.fnv1a). */
export function fnv1a(text) {
  let hash = 0x811c9dc5 | 0
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193)
  return hash | 0
}

/** mulberry32 - next() gives 0 until 2^32 (RaceSprints.Mulberry32). */
export function mulberry32(seed) {
  let state = seed | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (t ^ (t >>> 14)) >>> 0
  }
}

/** `count` different ids from `pool`, the same as the phone picks for the same seed. */
export function sprintChoices(seed, pool, count = SPRINT_CHOICES) {
  // Sorted by UTF-16 code units, like Kotlin's String.compareTo.
  const ids = [...new Set(pool)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const next = mulberry32(fnv1a(seed))
  const n = Math.min(count, ids.length)
  for (let i = 0; i < n; i++) {
    const j = i + (next() % (ids.length - i))
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
  }
  return ids.slice(0, n)
}

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

/** Every sprint of `event` that has begun - the running ones first, then newest first - as of `now` (RaceSprints.sprints).
 *  `pool(rarity)` gives the catalog's animal ids of that rarity. */
export function sprintsFor(event, now, pool) {
  const todayKey = raceDayKeyLocal(now)
  const raceFirstKey = raceDayKeyLocal(event.startMillis)
  if (!isValidYmd(todayKey) || !isValidYmd(raceFirstKey)) return []
  const today = ed(todayKey)
  const raceFirst = ed(raceFirstKey)
  const raceLast = event.endMillis != null ? ed(raceDayKeyLocal(event.endMillis - 1)) : null
  const lastShown = raceLast != null && raceLast < today ? raceLast : today
  if (lastShown < raceFirst) return []
  const standings = event.standings || []
  const allFinal = event.endMillis != null && now >= event.endMillis && standings.every((s) => s.final)

  const out = []
  for (const kind of SPRINT_KINDS) {
    let start = kind.id === 'WEEKLY' ? mondayOf(raceFirst) : monthStart(raceFirst)
    while (start <= lastShown) {
      const end = kind.id === 'WEEKLY' ? start + 6 : monthEnd(start)
      const first = Math.max(start, raceFirst)
      const last = raceLast != null && raceLast < end ? raceLast : end
      const firstKey = ymd(first), lastKey = ymd(last)
      const totals = standings.map((s) => {
        let millis = 0
        for (const [k, v] of Object.entries(s.daily || {})) if (+k >= firstKey && +k <= lastKey) millis += Math.max(0, Number(v) || 0)
        return { standing: s, millis }
      }).sort((a, b) => b.millis - a.millis)
      const top = totals[0]?.millis || 0
      const winners = standings.length >= 2 && top > 0 ? totals.filter((t) => t.millis === top).map((t) => t.standing.userId) : []
      const key = kind.prefix + (kind.id === 'WEEKLY' ? String(ymd(start)) : String(Math.floor(ymd(start) / 100)))
      out.push({
        eventId: event.id,
        kind: kind.id,
        rarity: kind.rarity,
        key,
        prizeKey: prizeKey(event.id, key),
        firstDay: firstKey,
        lastDay: lastKey,
        totals,
        decided: today > last + 1 || (allFinal && today > last),
        current: today >= first && today <= last,
        winners,
        choices: sprintChoices(`${event.id}:${key}`, pool(kind.rarity)),
      })
      start = end + 1
    }
  }
  // The running ones first (the week, then the month), then the rest newest first.
  const rank = (sp) => (sp.kind === 'WEEKLY' ? 0 : 1)
  return out.sort((a, b) => (b.current - a.current) || ((b.current ? 0 : b.lastDay) - (a.current ? 0 : a.lastDay)) || rank(a) - rank(b))
}

/** Sprints `userId` won whose prize hasn't been taken. */
export const prizesWaiting = (sprints, userId, taken) => sprints.filter((sp) => sp.decided && sp.winners.includes(userId) && !taken.has(sp.prizeKey))

/** When a running sprint closes: 4am after its last day (or the race's end, if sooner). */
export function sprintEndMillis(event, sprint) {
  const n = ed(sprint.lastDay) + 1
  const y = Math.floor(ymd(n) / 10000), m = Math.floor(ymd(n) / 100) % 100, d = ymd(n) % 100
  const ms = new Date(y, m - 1, d, RACE_DAY_START_HOUR).getTime()
  return event.endMillis != null ? Math.min(event.endMillis, ms) : ms
}
