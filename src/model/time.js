// Calendar helpers. Days are local calendar dates (the browser's own time zone), compared as
// epoch-day numbers rather than "midnight + 24h", which lands on the wrong day across a
// daylight-saving change - the same rule the phone app follows.

export const HOUR = 3_600_000
export const MINUTE = 60_000
export const DAY = 24 * HOUR

export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

/** Local midnight of the day [ms] falls in. */
export function dayStart(ms) {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Goal days (rings, goal streaks) run from this local hour to the same hour the next day, so a
 *  late night - immersion between midnight and 4 AM - still counts for the day before, and the
 *  rings don't reset until 4 AM. The phone's StreakCalculator.GOAL_DAY_START_HOUR. */
export const GOAL_DAY_START_HOUR = 4

/** The start (local 4 AM) of the goal day [ms] falls in. */
export function goalDayStart(ms) {
  const d = new Date(ms)
  if (d.getHours() < GOAL_DAY_START_HOUR) d.setDate(d.getDate() - 1)
  d.setHours(GOAL_DAY_START_HOUR, 0, 0, 0)
  return d.getTime()
}

/** The local calendar date of [ms] as an epoch-day number (days since 1970-01-01). */
export function epochDay(ms) {
  const d = new Date(ms)
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY)
}

/** Local midnight of epoch day [n]. */
export function epochDayStart(n) {
  const u = new Date(n * DAY)
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()).getTime()
}

/** yyyymmdd number for a local date. */
export function ymdOf(ms) {
  const d = new Date(ms)
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
}

export function ymdToEpochDay(ymd) {
  return Math.round(Date.UTC(Math.floor(ymd / 10000), Math.floor(ymd / 100) % 100 - 1, ymd % 100) / DAY)
}

export function epochDayToYmd(n) {
  const u = new Date(n * DAY)
  return u.getUTCFullYear() * 10000 + (u.getUTCMonth() + 1) * 100 + u.getUTCDate()
}

export function isValidYmd(ymd) {
  const y = Math.floor(ymd / 10000), m = Math.floor(ymd / 100) % 100, d = ymd % 100
  if (y < 1970 || m < 1 || m > 12 || d < 1) return false
  return new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d
}

/** Adds [days] calendar days to [ms] keeping the clock time. */
export function addDays(ms, days) {
  const d = new Date(ms)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

/** "1h 24m" / "45m" - the phone's formatDurationCompact. [dropZeroMinutes] makes a whole number of
 *  hours "2h" (goals). */
export function formatHm(ms, dropZeroMinutes = false) {
  const total = Math.max(0, Math.floor(ms / MINUTE))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h > 0 && m === 0 && dropZeroMinutes) return `${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

/** "1:02:03" / "2:03" stopwatch style for live timers. */
export function formatClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

/** Short hours: "12.5h", "3h", "45m". */
export function formatHoursShort(ms) {
  if (ms < HOUR) return `${Math.round(ms / MINUTE)}m`
  const h = ms / HOUR
  return `${h >= 100 ? Math.round(h) : Math.round(h * 10) / 10}h`
}

export function formatTime(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function formatDate(ms, opts = { month: 'short', day: 'numeric' }) {
  return new Date(ms).toLocaleDateString(undefined, opts)
}

export function formatDateTime(ms) {
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function formatYmd(ymd, opts = { month: 'short', day: 'numeric' }) {
  return new Date(Math.floor(ymd / 10000), Math.floor(ymd / 100) % 100 - 1, ymd % 100).toLocaleDateString(undefined, opts)
}

/** "Today", "Yesterday" or a date, for list headers. */
export function dayLabel(ms, now = Date.now()) {
  const diff = epochDay(now) - epochDay(ms)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear()
  return formatDate(ms, sameYear ? { weekday: 'short', month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' })
}

export function agoText(ms, now = Date.now()) {
  const diff = Math.max(0, now - ms)
  if (diff < MINUTE) return 'just now'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`
  return `${Math.floor(diff / DAY)}d ago`
}

/** Calendar parts of [ms] in IANA zone [zone] - null when the zone is unknown here. */
export function zonedParts(ms, zone) {
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23' })
    const parts = {}
    for (const p of f.formatToParts(new Date(ms))) parts[p.type] = p.value
    return { year: +parts.year, month: +parts.month, day: +parts.day, hour: +parts.hour % 24 }
  } catch {
    return null
  }
}

/** Hour of day (0-23) of [ms] in [zone], falling back to local time. */
export function hourIn(ms, zone) {
  if (!zone || zone === localZone()) return new Date(ms).getHours()
  const p = zonedParts(ms, zone)
  return p ? p.hour : new Date(ms).getHours()
}
