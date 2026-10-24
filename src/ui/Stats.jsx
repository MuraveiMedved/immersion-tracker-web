import { useMemo, useState, useRef, useEffect } from 'preact/hooks'
import { useStore, useNow } from '../store.js'
import { RANGES, RANGE_LABEL, STATS_TYPES, windowFor, barsFor, quickStats, heatmap, timeOfDay } from '../model/stats.js'
import { epochDayStart, formatDate, formatHm } from '../model/time.js'
import { withAlpha, mix, deepened, isDarkFor, gradientStops } from '../model/theme.js'
import { LanguageFilterChip, Icon, TypeIcon } from './common.jsx'

// The phone's chart measures (EntriesStatsSection.kt).
const CHART_HEIGHT = 140
const BAR_ALPHA = 0.85
const ZOOM_IN = { YEAR: 'MONTH', MONTH: 'DAY', WEEK: 'DAY', ALL: 'YEAR' }

/** Stats, drawn like the phone's: period pills, language chips, a navigator, four stat tiles, then
 *  the history chart (one overlapping bar per language in each column, a 0 / half / max scale, swipe
 *  for the span before or after), By language, the heatmap and the time-of-day chart. */
export function Stats() {
  const s = useStore()
  const now = useNow(30000)
  const [range, setRange] = useState('WEEK')
  const [offset, setOffset] = useState(0)
  const [hidden, setHidden] = useState(new Set())
  // Which kind of time: all of it (listening and reading), or just listening, reading or Study.
  const [typeFilter, setTypeFilter] = useState(null)
  const types = typeFilter ? STATS_TYPES[typeFilter] : null
  const light = !isDarkFor(s.settings.uiColorPreset)
  const languages = s.profiles.filter((p) => !p.isAnki).sort((a, b) => a.sortOrder - b.sortOrder)
  const visible = languages.filter((p) => !hidden.has(p.id))
  const langSet = hidden.size ? new Set(visible.map((p) => p.id)) : null
  const firstEntry = useMemo(() => s.entries.reduce((m, e) => Math.min(m, e.startTimeMillis), now), [s.entries])
  const minute = Math.floor(now / 60000)

  const page = (o) => {
    const win = windowFor(range, o, now, firstEntry)
    return { win, bars: barsFor(s.entries, win, langSet, now, types) }
  }
  const current = useMemo(() => page(offset), [range, offset, minute, firstEntry, s.entries, hidden, typeFilter])
  // The scale is shared with the spans either side (as on the phone), so swiping doesn't jump it.
  const scaleMax = useMemo(() => {
    const pages = [current, page(offset + 1), offset > 0 ? page(offset - 1) : null].filter(Boolean)
    return Math.max(1, ...pages.flatMap((p) => p.bars.flatMap((b) => [...b.values()])))
  }, [current])
  const stats = useMemo(() => quickStats(s.entries, current.win, langSet, now, types), [current])
  const heat = useMemo(() => heatmap(s.entries, langSet, visible, now, types), [s.entries, hidden, typeFilter, Math.floor(now / 3600000)])
  const tod = useMemo(() => timeOfDay(s.entries, langSet, now, types), [s.entries, hidden, typeFilter])

  const zoomTo = (i) => {
    const next = ZOOM_IN[range]
    if (!next) return
    const target = current.win.buckets[i][0]
    const find = (r) => { for (let o = 0; o < 4000; o++) { const w = windowFor(r, o, now, firstEntry); if (target >= w.start && target < w.end) return o } return 0 }
    setRange(next)
    setOffset(find(next))
  }
  const canBack = range !== 'ALL' && current.win.start > firstEntry - 1
  const canForward = range !== 'ALL' && offset > 0

  // Swipe the chart sideways: right = the span before, left = the span after.
  const swipe = useRef(null)
  const onDown = (e) => { swipe.current = { x: e.clientX } }
  const onUp = (e) => {
    const sw = swipe.current
    swipe.current = null
    if (!sw) return
    const dx = e.clientX - sw.x
    if (Math.abs(dx) < 50) return
    if (dx > 0 && canBack) setOffset(offset + 1)
    if (dx < 0 && canForward) setOffset(offset - 1)
  }

  const longest = stats.streak > 0 && stats.streak >= stats.longest
  const hasData = current.bars.some((b) => b.size > 0)
  const todTotal = [...tod.values()].reduce((t, hours) => t + hours.reduce((a, b) => a + b, 0), 0)
  const todTallest = Math.max(1, ...[...tod.values()].flatMap((h) => h))
  const hourBuckets = windowFor('DAY', 0, now).buckets

  return (
    <div style="margin-top:4px;padding-top:12px">
      <div class="chips scroll" style="gap:6px">
        {RANGES.map((r) => <button key={r} class={`pill-toggle ${range === r ? 'on' : ''}`} onClick={() => { setRange(r); setOffset(0) }}>{RANGE_LABEL[r]}</button>)}
      </div>
      <div class="chips scroll" style="gap:6px;margin-top:8px">
        <button class={`pill-toggle ${typeFilter == null ? 'on' : ''}`} onClick={() => setTypeFilter(null)}>All</button>
        {[['LISTENING', 'PODCAST', 'Listening'], ['READING', 'READING', 'Reading'], ['STUDY', 'ANKI', 'Study']].map(([key, icon, label]) => (
          <button key={key} class={`pill-toggle row ${typeFilter === key ? 'on' : ''}`} style="gap:6px;display:inline-flex;align-items:center" onClick={() => setTypeFilter(key)}><TypeIcon type={icon} size={16} />{label}</button>
        ))}
      </div>
      {languages.length > 1 && (
        <div class="chips scroll" style="margin-top:12px">
          {languages.map((p) => <LanguageFilterChip key={p.id} profile={p} selected={!hidden.has(p.id)} onClick={() => setHidden((prev) => { const n = new Set(prev); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n })} />)}
        </div>
      )}
      <div class="row" style="margin-top:8px">
        <button class="icon-btn" title="Previous" style={canBack ? '' : 'visibility:hidden'} onClick={() => setOffset(offset + 1)}><Icon name="chevron_right" style={{ transform: 'scaleX(-1)' }} /></button>
        <h2 class="grow center">{current.win.label}</h2>
        <button class="icon-btn" title="Next" style={canForward ? '' : 'visibility:hidden'} onClick={() => setOffset(Math.max(0, offset - 1))}><Icon name="chevron_right" /></button>
      </div>
      <div class="quick-stats">
        <div class="qtile"><b>{formatHm(stats.total)}</b><span>Total</span></div>
        {range !== 'DAY' && <div class="qtile"><b>{formatHm(stats.dailyAvg)}</b><span>Daily avg</span></div>}
        {range !== 'DAY' && <div class="qtile"><b>{stats.best ? formatHm(stats.best.ms) : '0m'}</b><span>Best day</span></div>}
        <div class="qtile"><b>{longest ? stats.longest : stats.streak}d</b><span>{longest ? 'Longest streak' : 'Streak'}</span></div>
      </div>

      {!visible.length ? <div class="empty">No languages selected.</div> : (
        <>
          <div class="row" style="margin-top:20px;align-items:flex-start;gap:0;touch-action:pan-y" onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => { swipe.current = null }}>
            <Axis labels={[formatHm(scaleMax), formatHm(scaleMax / 2), formatHm(0)]} />
            {hasData
              ? <BarColumns buckets={current.win.buckets} languages={visible} value={(i, id) => current.bars[i].get(id) || 0} max={scaleMax} light={light} onBucket={ZOOM_IN[range] ? zoomTo : null} />
              : <div class="grow muted small" style={{ height: CHART_HEIGHT + 22, display: 'grid', placeItems: 'center' }}>Nothing tracked in this window yet.</div>}
          </div>
          {hasData && range !== 'ALL' && <div class="center muted small" style="margin-top:4px">Swipe for more · tap a bar to zoom in</div>}
          <LanguageBreakdown byLang={stats.byLang} languages={visible} />
        </>
      )}

      <Heatmap heat={heat} />

      {todTotal > 0 && (
        <div style="margin-top:24px">
          <h2>Time of day</h2>
          <div class="muted small">When you immerse, across all your history</div>
          <div class="row" style="margin-top:12px;align-items:flex-start;gap:0">
            <Axis labels={[percent(todTallest / todTotal), percent(todTallest / todTotal / 2), '0%']} />
            <BarColumns buckets={hourBuckets} languages={visible} value={(i, id) => tod.get(id)?.[i] || 0} max={todTallest} light={light} />
          </div>
          <div class="muted tiny" style="margin-top:4px">Hours are shown in the time zone each session happened in.</div>
        </div>
      )}
    </div>
  )
}

const percent = (share) => {
  const v = share * 100
  return v > 0 && v < 10 ? `${v.toFixed(1)}%` : `${Math.round(v)}%`
}

/** The scale on the left: max, half, 0 - lined up with the bars' own height. */
function Axis({ labels }) {
  return (
    <div class="chart-axis" style={{ height: CHART_HEIGHT }}>
      {labels.map((l, i) => <span key={i}>{l}</span>)}
    </div>
  )
}

/** The phone's BarColumns: per column, one full-width bar per language (biggest at the back),
 *  a little see-through with a lighter outline; then the column's label (and a tick where the
 *  phone draws one). */
function BarColumns({ buckets, languages, value, max, light, onBucket }) {
  const dense = buckets.length > 12
  const corner = dense ? 3 : 6
  return (
    <div class="bar-columns" style={{ gap: dense ? 2 : 6 }}>
      {buckets.map((b, i) => {
        const bars = languages.map((p) => [p, value(i, p.id)]).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1])
        return (
          <div key={i} class="bar-column" onClick={onBucket ? () => onBucket(i) : undefined} style={onBucket ? 'cursor:pointer' : ''}
            title={bars.length ? bars.map(([p, v]) => `${p.name} ${formatHm(v)}`).join(' · ') : undefined}>
            <div class="bar-stack" style={{ height: CHART_HEIGHT }}>
              {bars.map(([p, v]) => {
                const stops = gradientStops(p) || [p.colorHex]
                const fill = stops.length > 1 ? `linear-gradient(180deg, ${stops.map((c) => withAlpha(c, BAR_ALPHA)).join(', ')})` : withAlpha(stops[0], BAR_ALPHA)
                const edge = (c) => (light ? deepened(c, 0.45) : mix(c, '#FFFFFF', 0.45))
                const h = Math.max(3, Math.min(CHART_HEIGHT, (CHART_HEIGHT * v) / Math.max(1, max)))
                return (
                  <div key={p.id} class="bar-fill" style={{
                    height: h, background: fill, borderRadius: `${corner}px ${corner}px 2px 2px`,
                    border: `${dense ? 0.75 : 1}px solid ${edge(stops[0])}`,
                  }} />
                )
              })}
            </div>
            <div class={`bar-label ${b[3] ? 'tick' : ''}`}>{b[2]}</div>
          </div>
        )
      })}
    </div>
  )
}

/** The phone's LanguageBreakdown: dot, name, time and share, and a thin bar. */
function LanguageBreakdown({ byLang, languages }) {
  const rows = languages.map((p) => [p, byLang.get(p.id)?.total || 0]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  if (!rows.length) return null
  const sum = rows.reduce((t, [, v]) => t + v, 0) || 1
  return (
    <div style="margin-top:20px">
      <h2>By language</h2>
      {rows.map(([p, ms]) => {
        const stops = gradientStops(p)
        const share = ms / sum
        return (
          <div key={p.id} style="margin-top:10px">
            <div class="row" style="gap:0">
              <span class="dot" style={{ background: stops ? `linear-gradient(90deg, ${stops.join(', ')})` : p.colorHex }} />
              <span class="grow ellipsis" style="margin-left:8px">{p.name}</span>
              <span>{formatHm(ms)}</span>
              <span class="label-small muted" style="width:40px;text-align:right">{Math.round(share * 100)}%</span>
            </div>
            <div class="share-track">
              <div style={{ width: `${Math.max(0.5, share * 100)}%`, background: stops ? `linear-gradient(90deg, ${stops.map((c) => withAlpha(c, BAR_ALPHA)).join(', ')})` : withAlpha(p.colorHex, BAR_ALPHA) }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** The phone's YearHeatmap: Mon/Wed/Fri down the side, month labels (the year at January) above
 *  each month's first week with a little gap before it, opening at today; each day in its top
 *  language, stronger the busier it was; a legend of the languages that top a day. */
function Heatmap({ heat }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current) ref.current.scrollLeft = ref.current.scrollWidth }, [heat])
  const weekday = (n) => new Date(2024, 0, n).toLocaleDateString(undefined, { weekday: 'short' }) // Jan 1 2024 was a Monday
  const byId = new Map(heat.legend.map((p) => [p.id, p]))
  return (
    <div style="margin-top:24px">
      <h2>Heatmap</h2>
      <div class="row" style="margin-top:12px;align-items:flex-start;gap:6px">
        <div class="heat-days">{[weekday(1), '', weekday(3), '', weekday(5), '', ''].map((l, i) => <span key={i}>{l}</span>)}</div>
        <div class="heat-scroll" ref={ref}>
          <div class="heat-grid">
            {heat.weeks.map((w, wi) => (
              <div key={wi} class="heat-week" style={wi > 0 && w.monthLabel ? 'margin-left:7px' : ''}>
                <span class={`heat-month ${w.monthLabel?.year ? 'year' : ''}`}>{w.monthLabel?.text || ''}</span>
                {w.days.map((d, di) => {
                  if (!d) return <i key={di} style="visibility:hidden" />
                  const p = d.top != null ? byId.get(d.top) : null
                  const style = d.total > 0 && heat.p95 > 0
                    ? { background: withAlpha(p?.colorHex || '#6FA8C9', 0.22 + Math.min(1, d.total / heat.p95) * 0.78) }
                    : undefined
                  return <i key={di} style={style} title={`${formatDate(epochDayStart(d.day))}: ${formatHm(d.total)}`} />
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      {heat.legend.length > 0 && (
        <div class="row wrap" style="margin-top:10px;gap:6px 14px">
          {heat.legend.map((p) => <span key={p.id} class="row label-medium muted" style="gap:6px"><i class="heat-swatch" style={{ background: p.colorHex }} />{p.name}</span>)}
        </div>
      )}
    </div>
  )
}
