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

/** The [start, end) window and its buckets for [range] shifted back [offset] windows. */
export function windowFor(range, offset, now = Date.now(), firstEntryMs = now) {
  const d = new Date(now)
  const buckets = []
  let label = ''
  if (range === 'DAY') {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset)
    for (let h = 0; h < 24; h++) buckets.push([new Date(day).setHours(h), new Date(day).setHours(h + 1), `${h}`])
    label = offset === 0 ? 'Today' : offset === 1 ? 'Yesterday' : day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  } else if (range === 'WEEK') {
    // Weeks start Monday.
    const dow = (d.getDay() + 6) % 7
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow - offset * 7)
    for (let i = 0; i < 7; i++) {
      const a = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
      buckets.push([a.getTime(), new Date(a.getFullYear(), a.getMonth(), a.getDate() + 1).getTime(), a.toLocaleDateString(undefined, { weekday: 'narrow' })])
    }
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
    label = offset === 0 ? 'This week' : `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
  } else if (range === 'MONTH') {
    const m = new Date(d.getFullYear(), d.getMonth() - offset, 1)
    const days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()
    for (let i = 1; i <= days; i++) buckets.push([new Date(m.getFullYear(), m.getMonth(), i).getTime(), new Date(m.getFullYear(), m.getMonth(), i + 1).getTime(), String(i)])
    label = m.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  } else if (range === 'YEAR') {
    const y = d.getFullYear() - offset
    for (let i = 0; i < 12; i++) buckets.push([new Date(y, i, 1).getTime(), new Date(y, i + 1, 1).getTime(), new Date(y, i, 1).toLocaleDateString(undefined, { month: 'narrow' })])
    label = String(y)
  } else {
    const first = new Date(firstEntryMs)
    const years = d.getFullYear() - first.getFullYear() + 1
    if (years <= 2) {
      const months = (d.getFullYear() - first.getFullYear()) * 12 + d.getMonth() - first.getMonth() + 1
      for (let i = 0; i < months; i++) {
        const a = new Date(first.getFullYear(), first.getMonth() + i, 1)
        buckets.push([a.getTime(), new Date(a.getFullYear(), a.getMonth() + 1, 1).getTime(), a.toLocaleDateString(undefined, { month: 'narrow' })])
      }
    } else {
      for (let y = first.getFullYear(); y <= d.getFullYear(); y++) buckets.push([new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime(), String(y).slice(2)])
    }
    label = `Since ${first.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`
  }
  return { buckets, label, start: buckets[0][0], end: buckets[buckets.length - 1][1] }
}

const included = (e, langSet) => counts(e.contentType, e.languageProfileId) && (!langSet || langSet.has(e.languageProfileId))

/** Bars: per bucket, millis per language (stacked). */
export function barsFor(entries, win, langSet, now = Date.now()) {
  const bars = win.buckets.map(() => new Map())
  for (const e of entries) {
    if (!included(e, langSet)) continue
    if ((e.endTimeMillis ?? now) <= win.start || e.startTimeMillis >= win.end) continue
    spread(e, win.buckets, now, (i, ms) => bars[i].set(e.languageProfileId, (bars[i].get(e.languageProfileId) || 0) + ms))
  }
  return bars
}

/** Per epoch day immersion totals for everything included. */
export function dailyTotals(entries, langSet, now = Date.now()) {
  const totals = new Map()
  for (const e of entries) {
    if (!included(e, langSet)) continue
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

export function quickStats(entries, win, langSet, now = Date.now()) {
  const daily = dailyTotals(entries, langSet, now)
  let total = 0, best = null
  const byLang = new Map()
  const byType = { PODCAST: 0, READING: 0 }
  for (const e of entries) {
    if (!included(e, langSet)) continue
    const from = Math.max(e.startTimeMillis, win.start), to = Math.min(e.endTimeMillis ?? now, win.end, now)
    if (to <= from) continue
    total += to - from
    byLang.set(e.languageProfileId, (byLang.get(e.languageProfileId) || { total: 0, PODCAST: 0, READING: 0 }))
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

/** 53 weeks x 7 days of totals plus the day's top language, ending today (or [endDay]). */
export function heatmap(entries, langSet, profiles, now = Date.now()) {
  const byDayLang = new Map()
  for (const e of entries) {
    if (!included(e, langSet)) continue
    const end = Math.min(e.endTimeMillis ?? now, now)
    let start = e.startTimeMillis
    while (start < end) {
      const day = epochDay(start)
      const partEnd = Math.min(end, epochDayStart(day + 1))
      if (!byDayLang.has(day)) byDayLang.set(day, new Map())
      const m = byDayLang.get(day)
      m.set(e.languageProfileId, (m.get(e.languageProfileId) || 0) + (partEnd - start))
      start = partEnd
    }
  }
  const today = epochDay(now)
  const todayDow = (new Date(now).getDay() + 6) % 7
  const lastCol = today - todayDow // Monday of this week
  const first = lastCol - 52 * 7
  const order = new Map(profiles.map((p, i) => [p.id, p.sortOrder ?? i]))
  const cells = []
  const totals = []
  for (let d = first; d <= today; d++) {
    const m = byDayLang.get(d)
    let total = 0, top = null, topMs = -1
    if (m) for (const [id, ms] of m) {
      total += ms
      if (ms > topMs || (ms === topMs && (order.get(id) ?? 0) < (order.get(top) ?? 0))) { topMs = ms; top = id }
    }
    cells.push({ day: d, total, top })
    if (total > 0) totals.push(total)
  }
  totals.sort((a, b) => a - b)
  const p95 = totals.length ? totals[Math.min(totals.length - 1, Math.floor(totals.length * 0.95))] : HOUR
  return { cells, first, p95 }
}

/** Share of all included time in each hour of the day, read in each session's own time zone. */
export function timeOfDay(entries, langSet, now = Date.now()) {
  const hours = new Array(24).fill(0)
  for (const e of entries) {
    if (!included(e, langSet)) continue
    let s = e.startTimeMillis
    const end = Math.min(e.endTimeMillis ?? now, now)
    while (s < end) {
      const next = Math.min(end, (Math.floor(s / HOUR) + 1) * HOUR)
      hours[hourIn(s, e.timeZone)] += next - s
      s = next
    }
  }
  const total = hours.reduce((a, b) => a + b, 0)
  return hours.map((h) => (total ? h / total : 0))
}

export { durationOf }
