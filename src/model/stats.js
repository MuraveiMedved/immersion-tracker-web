// Stats-screen maths: bars for a window (day/week/month/year/all), quick stats, the 12-month
// heatmap and the time-of-day chart - immersion only (spoken listening + reading with a language),
// optionally narrowed to some languages.
import { counts, durationOf } from './rules.js'
import { epochDay, epochDayStart, HOUR, hourIn } from './time.js'

export const RANGES = ['DAY', 'WEEK', 'MONTH', 'YEAR', 'ALL']
export const RANGE_LABEL = { DAY: 'Day', WEEK: 'Week', MONTH: 'Month', YEAR: 'Year', ALL: 'All time' }

/** Splits [entry] across [buckets] (sorted [start, end) pairs), calling add(index, millis). */
function spread(entry, buckets, now, add) {
  const s = entry.startTimeMillis
  const e = Math.min(entry.endTimeMillis ?? now, now)
  if (e <= s) return
  let lo = 0, hi = buckets.length - 1
  // first bucket whose end is after s
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (buckets[mid][1] <= s) lo = mid + 1
    else hi = mid
  }
  for (let i = lo; i < buckets.length && buckets[i][0] < e; i++) {
    const from = Math.max(s, buckets[i][0]), to = Math.min(e, buckets[i][1])
    if (to > from) add(i, to - from)
  }
}

/** The [start, end) window and its buckets for [range] shifted back [offset] windows. A bucket is
 *  [start, end, label | null, tick] - labels and ticks as sparse as the phone's chart: a day labels
 *  every 6 hours (ticks every 3), a month its 1st and every 5th day, all time is one bar a year. */
export function windowFor(range, offset, now = Date.now(), firstEntryMs = now) {
  const d = new Date(now)
  const buckets = []
  let label = ''
  if (range === 'DAY') {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset)
    for (let h = 0; h < 24; h++) {
      const start = new Date(day).setHours(h)
      const lbl = h % 6 === 0 ? new Date(start).toLocaleTimeString(undefined, { hour: 'numeric' }).replace(':00', '') : null
      buckets.push([start, new Date(day).setHours(h + 1), lbl, h % 3 === 0])
    }
    label = offset === 0 ? 'Today' : offset === 1 ? 'Yesterday' : day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  } else if (range === 'WEEK') {
    // Weeks start Monday.
    const dow = (d.getDay() + 6) % 7
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow - offset * 7)
    for (let i = 0; i < 7; i++) {
      const a = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
      buckets.push([a.getTime(), new Date(a.getFullYear(), a.getMonth(), a.getDate() + 1).getTime(), a.toLocaleDateString(undefined, { weekday: 'short' }), false])
    }
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
    label = offset === 0 ? 'This week' : `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
  } else if (range === 'MONTH') {
    const m = new Date(d.getFullYear(), d.getMonth() - offset, 1)
    const days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()
    for (let i = 1; i <= days; i++) buckets.push([new Date(m.getFullYear(), m.getMonth(), i).getTime(), new Date(m.getFullYear(), m.getMonth(), i + 1).getTime(), i === 1 || i % 5 === 0 ? String(i) : null, false])
    label = m.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  } else if (range === 'YEAR') {
    const y = d.getFullYear() - offset
    for (let i = 0; i < 12; i++) buckets.push([new Date(y, i, 1).getTime(), new Date(y, i + 1, 1).getTime(), new Date(y, i, 1).toLocaleDateString(undefined, { month: 'narrow' }), false])
    label = String(y)
  } else {
    const first = new Date(firstEntryMs).getFullYear()
    const years = Math.max(1, d.getFullYear() - first + 1)
    for (let y = first; y < first + years; y++) buckets.push([new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime(), years <= 6 ? String(y) : `'${String(y).slice(2)}`, false])
    label = `Since ${new Date(firstEntryMs).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`
  }
  return { buckets, label, start: buckets[0][0], end: buckets[buckets.length - 1][1] }
}

/** [types]: the stats screen's type filter (STATS_TYPES) - only those kinds of entry, Study
 *  included when picked; null = immersion as everywhere else (listening and reading). */
const included = (e, langSet, types = null) =>
  (types ? e.languageProfileId != null && types.includes(e.contentType) : counts(e.contentType, e.languageProfileId)) &&
  (!langSet || langSet.has(e.languageProfileId))

/** The stats screen's type filter, as on the phone (EntriesStatsSection's StatsTypeFilter). */
export const STATS_TYPES = { LISTENING: ['PODCAST', 'LISTENING'], READING: ['READING'], STUDY: ['ANKI'] }

/** Bars: per bucket, millis per language (stacked). */
export function barsFor(entries, win, langSet, now = Date.now(), types = null) {
  const bars = win.buckets.map(() => new Map())
  for (const e of entries) {
    if (!included(e, langSet, types)) continue
    if ((e.endTimeMillis ?? now) <= win.start || e.startTimeMillis >= win.end) continue
    spread(e, win.buckets, now, (i, ms) => bars[i].set(e.languageProfileId, (bars[i].get(e.languageProfileId) || 0) + ms))
  }
  return bars
}

/** Per epoch day immersion totals for everything included. */
export function dailyTotals(entries, langSet, now = Date.now(), types = null) {
  const totals = new Map()
  for (const e of entries) {
    if (!included(e, langSet, types)) continue
    const end = Math.min(e.endTimeMillis ?? now, now)
    let start = e.startTimeMillis
    while (start < end) {
      const day = epochDay(start)
      const partEnd = Math.min(end, epochDayStart(day + 1))
      totals.set(day, (totals.get(day) || 0) + (partEnd - start))
      start = partEnd
    }
  }
  return totals
}

export function quickStats(entries, win, langSet, now = Date.now(), types = null) {
  const daily = dailyTotals(entries, langSet, now, types)
  let total = 0, best = null
  const byLang = new Map()
  const byType = { PODCAST: 0, READING: 0, LISTENING: 0, ANKI: 0 }
  for (const e of entries) {
    if (!included(e, langSet, types)) continue
    const from = Math.max(e.startTimeMillis, win.start), to = Math.min(e.endTimeMillis ?? now, win.end, now)
    if (to <= from) continue
    total += to - from
    byLang.set(e.languageProfileId, (byLang.get(e.languageProfileId) || { total: 0, PODCAST: 0, READING: 0, LISTENING: 0, ANKI: 0 }))
    const l = byLang.get(e.languageProfileId)
    l.total += to - from
    l[e.contentType] += to - from
    byType[e.contentType] += to - from
  }
  const firstDay = epochDay(win.start)
  const lastDay = Math.min(epochDay(win.end - 1), epochDay(now))
  for (let d = firstDay; d <= lastDay; d++) {
    const t = daily.get(d) || 0
    if (t > 0 && (!best || t > best.ms)) best = { day: d, ms: t }
  }
  const daysInWindow = Math.max(1, lastDay - firstDay + 1)
  // Immersion streaks: any immersion at all counts as a day.
  let current = 0, cursor = epochDay(now)
  if (!(daily.get(cursor) > 0)) cursor--
  while (daily.get(cursor) > 0) { current++; cursor-- }
  let longest = 0, run = 0, prev = null
  for (const d of [...daily.keys()].filter((k) => daily.get(k) > 0).sort((a, b) => a - b)) {
    run = prev != null && d === prev + 1 ? run + 1 : 1
    longest = Math.max(longest, run)
    prev = d
  }
  return { total, dailyAvg: total / daysInWindow, best, streak: current, longest, byLang, byType }
}

/** The phone's YearHeatmap: whole weeks (Monday first) back to the first tracked day, at least
 *  53 of them; each day's total and top language; a week carries a month label (the year at
 *  January) when a month starts in it; [p95] is the busy-day mark opacity is scaled against. */
export function heatmap(entries, langSet, profiles, now = Date.now(), types = null) {
  const byDayLang = new Map()
  let firstDay = epochDay(now)
  for (const e of entries) {
    if (!included(e, langSet, types)) continue
    const end = Math.min(e.endTimeMillis ?? now, now)
    let start = e.startTimeMillis
    while (start < end) {
      const day = epochDay(start)
      firstDay = Math.min(firstDay, day)
      const partEnd = Math.min(end, epochDayStart(day + 1))
      if (!byDayLang.has(day)) byDayLang.set(day, new Map())
      const m = byDayLang.get(day)
      m.set(e.languageProfileId, (m.get(e.languageProfileId) || 0) + (partEnd - start))
      start = partEnd
    }
  }
  const today = epochDay(now)
  const monday = today - ((new Date(now).getDay() + 6) % 7)
  const weekCount = Math.max(53, Math.floor((monday - firstDay) / 7) + 1)
  const order = new Map(profiles.map((p, i) => [p.id, p.sortOrder ?? i]))
  const weeks = []
  const totals = []
  for (let w = weekCount - 1; w >= 0; w--) {
    const startDay = monday - w * 7
    let monthLabel = null
    const days = []
    for (let i = 0; i < 7; i++) {
      const day = startDay + i
      const date = new Date(epochDayStart(day))
      if (date.getDate() === 1) monthLabel = date.getMonth() === 0 ? { text: String(date.getFullYear()), year: true } : { text: date.toLocaleDateString(undefined, { month: 'short' }), year: false }
      if (day > today) { days.push(null); continue }
      const m = byDayLang.get(day)
      let total = 0, top = null, topMs = -1
      if (m) for (const [id, ms] of m) {
        total += ms
        if (ms > topMs || (ms === topMs && (order.get(id) ?? 0) < (order.get(top) ?? 0))) { topMs = ms; top = id }
      }
      days.push({ day, total, top })
      if (total > 0) totals.push(total)
    }
    weeks.push({ days, monthLabel })
  }
  totals.sort((a, b) => a - b)
  const p95 = totals.length ? totals[Math.floor((totals.length - 1) * 0.95)] : 0
  const tops = new Set(weeks.flatMap((w) => w.days.filter((d) => d && d.total > 0).map((d) => d.top)))
  return { weeks, p95, legend: profiles.filter((p) => tops.has(p.id)) }
}

/** All of history folded onto the clock, per language: language id -> 24 hourly totals, read in
 *  each session's own time zone. PolyLogger imports are left out - they have no real time of day
 *  (the importer lays each day's sessions from noon), which would show as a false midday peak. */
// The web importer's marker and the phone's (TrackingRepository.POLYLOGGER_APP_PACKAGE), which
// arrives with synced entries and phone backups.
const POLYLOGGER_PACKAGES = new Set(['import:polylogger', 'polylogger-import'])

export function timeOfDay(entries, langSet, now = Date.now(), types = null) {
  const out = new Map()
  for (const e of entries) {
    if (!included(e, langSet, types) || POLYLOGGER_PACKAGES.has(e.appPackage)) continue
    const hours = out.get(e.languageProfileId) || new Array(24).fill(0)
    out.set(e.languageProfileId, hours)
    let s = e.startTimeMillis
    const end = Math.min(e.endTimeMillis ?? now, now)
    while (s < end) {
      const next = Math.min(end, (Math.floor(s / HOUR) + 1) * HOUR)
      hours[hourIn(s, e.timeZone)] += next - s
      s = next
    }
  }
  return out
}

export { durationOf }
