import { useMemo, useState, useRef, useEffect } from 'preact/hooks'
import { useStore, useNow, profileById } from '../store.js'
import { RANGES, RANGE_LABEL, windowFor, barsFor, quickStats, heatmap, timeOfDay } from '../model/stats.js'
import { epochDayStart, formatDate, formatHm, formatHoursShort } from '../model/time.js'
import { withAlpha, languageFill } from '../model/theme.js'
import { LanguageDot, LanguageFilterChip, TypeLabel, Icon } from './common.jsx'

const ZOOM_IN = { YEAR: 'MONTH', MONTH: 'DAY', WEEK: 'DAY', ALL: 'YEAR' }

export function Stats() {
  const s = useStore()
  const now = useNow(30000)
  const [range, setRange] = useState('WEEK')
  const [offset, setOffset] = useState(0)
  const [hidden, setHidden] = useState(new Set())
  const [hover, setHover] = useState(null)
  const languages = s.profiles.filter((p) => !p.isAnki).sort((a, b) => a.sortOrder - b.sortOrder)
  const langSet = hidden.size ? new Set(languages.filter((p) => !hidden.has(p.id)).map((p) => p.id)) : null
  const firstEntry = useMemo(() => s.entries.reduce((m, e) => Math.min(m, e.startTimeMillis), now), [s.entries])

  const win = useMemo(() => windowFor(range, offset, now, firstEntry), [range, offset, Math.floor(now / 60000), firstEntry])
  const bars = useMemo(() => barsFor(s.entries, win, langSet, now), [s.entries, win, hidden])
  const stats = useMemo(() => quickStats(s.entries, win, langSet, now), [s.entries, win, hidden])
  const heat = useMemo(() => heatmap(s.entries, langSet, s.profiles, now), [s.entries, hidden, Math.floor(now / 3600000)])
  const tod = useMemo(() => timeOfDay(s.entries, langSet, now), [s.entries, hidden])
  const max = Math.max(1, ...bars.map((b) => [...b.values()].reduce((a, c) => a + c, 0)))
  const order = languages.map((p) => p.id)
  const heatRef = useRef(null)
  useEffect(() => { if (heatRef.current) heatRef.current.scrollLeft = heatRef.current.scrollWidth }, [heat])

  const zoomTo = (i) => {
    const next = ZOOM_IN[range]
    if (!next) return
    const target = win.buckets[i][0]
    const fresh = (r) => { for (let o = 0; o < 4000; o++) { const w = windowFor(r, o, now, firstEntry); if (target >= w.start && target < w.end) return o } return 0 }
    setRange(next)
    setOffset(fresh(next))
  }

  const longest = stats.streak > 0 && stats.streak >= stats.longest
  return (
    <div style="margin-top:4px;padding-top:12px">
      <div class="chips scroll" style="gap:6px">
        {RANGES.map((r) => <button key={r} class={`pill-toggle ${range === r ? 'on' : ''}`} onClick={() => { setRange(r); setOffset(0) }}>{RANGE_LABEL[r]}</button>)}
      </div>
      {languages.length > 1 && (
        <div class="chips scroll" style="margin-top:12px">
          {languages.map((p) => <LanguageFilterChip key={p.id} profile={p} selected={!hidden.has(p.id)} onClick={() => setHidden((prev) => { const n = new Set(prev); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n })} />)}
        </div>
      )}
      <div class="row" style="margin-top:8px">
        <button class="icon-btn" title="Previous" style={range === 'ALL' ? 'visibility:hidden' : ''} onClick={() => setOffset(offset + 1)}><Icon name="chevron_right" style={{ transform: 'scaleX(-1)' }} /></button>
        <h2 class="grow center">{win.label}</h2>
        <button class="icon-btn" title="Next" style={range === 'ALL' || offset === 0 ? 'visibility:hidden' : ''} onClick={() => setOffset(Math.max(0, offset - 1))}><Icon name="chevron_right" /></button>
      </div>
      <div class="quick-stats">
        <div class="qtile"><b>{formatHm(stats.total)}</b><span>Total</span></div>
        {range !== 'DAY' && <div class="qtile"><b>{formatHm(stats.dailyAvg)}</b><span>Daily avg</span></div>}
        {range !== 'DAY' && <div class="qtile"><b>{stats.best ? formatHm(stats.best.ms) : '0m'}</b><span>Best day</span></div>}
        <div class="qtile"><b>{longest ? stats.longest : stats.streak}d</b><span>{longest ? 'Longest streak' : 'Streak'}</span></div>
      </div>
      {hidden.size === languages.length && languages.length ? <div class="empty">No languages selected.</div> : (
        <div style="margin-top:20px">
          <div class="muted small center">{hover != null ? `${win.buckets[hover][2]}: ${formatHm([...bars[hover].values()].reduce((a, c) => a + c, 0))}` : '\u00a0'}</div>
          <div class="chart" onMouseLeave={() => setHover(null)}>
            {bars.map((b, i) => (
              <div key={i} class="bar-col" title={`${win.buckets[i][2]}: ${formatHm([...b.values()].reduce((a, c) => a + c, 0))}`} onMouseEnter={() => setHover(i)} onClick={() => zoomTo(i)}>
                {order.filter((id) => b.get(id)).map((id) => {
                  const p = profileById(id)
                  return <div key={id} class="seg-part" style={{ height: `${(b.get(id) / max) * 100}%`, background: languageFill(p, 0), border: `1px solid ${withAlpha(p.colorHex, 0.9)}` }} />
                })}
              </div>
            ))}
          </div>
          <div class="chart-labels">{win.buckets.map((b, i) => <span key={i}>{range === 'MONTH' ? (i % 5 === 0 || i === win.buckets.length - 1 ? b[2] : '') : range === 'DAY' ? (i % 3 === 0 ? b[2] : '') : b[2]}</span>)}</div>
          {stats.total === 0
            ? <div class="center muted" style="margin-top:6px">Nothing tracked in this window yet.</div>
            : ZOOM_IN[range] && <div class="center muted small" style="margin-top:4px">Tap a bar to zoom in</div>}
        </div>
      )}

      {stats.byLang.size > 0 && (
        <div style="margin-top:20px">
          <h2 style="margin-bottom:10px">By language</h2>
          <div class="col" style="gap:12px">
            {[...stats.byLang].sort((a, b) => b[1].total - a[1].total).map(([id, v]) => {
              const p = profileById(id)
              return (
                <div key={id}>
                  <div class="row"><LanguageDot profile={p} /><span class="grow label-large">{p?.name || '?'}</span><span class="label-large muted">{formatHm(v.total)} · {Math.round((v.total / stats.total) * 100)}%</span></div>
                  <div class="progress" style="margin-top:6px;height:8px">
                    <div style={{ width: `${(v.PODCAST / stats.total) * 100}%`, background: p?.colorHex }} />
                    <div style={{ width: `${(v.READING / stats.total) * 100}%`, background: withAlpha(p?.colorHex || '#888', 0.55) }} />
                  </div>
                  <div class="muted small row" style="margin-top:4px;gap:10px"><TypeLabel type="PODCAST" size={13}>{formatHm(v.PODCAST)}</TypeLabel><TypeLabel type="READING" size={13}>{formatHm(v.READING)}</TypeLabel></div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div style="margin-top:24px">
        <h2>Heatmap</h2>
        <div class="muted small" style="margin-bottom:10px">12 months to {formatDate(now)}</div>
        <div class="heat" ref={heatRef}>
          {heat.cells.map((c) => {
            const p = c.top != null ? profileById(c.top) : null
            const a = c.total ? Math.min(1, 0.25 + 0.75 * (c.total / heat.p95)) : 0
            return <div key={c.day} title={`${formatDate(epochDayStart(c.day))}: ${formatHm(c.total)}`} style={c.total ? { background: withAlpha(p?.colorHex || '#6FA8C9', a) } : undefined} />
          })}
        </div>
      </div>

      <div style="margin-top:24px">
        <h2>Time of day</h2>
        <div class="muted small" style="margin-bottom:10px">When you immerse, across all your history. Hours are shown in the time zone each session happened in.</div>
        <div class="tod">{tod.map((v, h) => <div key={h} title={`${h}:00 · ${Math.round(v * 100)}%`} style={{ height: `${(v / Math.max(0.0001, ...tod)) * 100}%` }} />)}</div>
        <div class="chart-labels">{tod.map((_, h) => <span key={h}>{h % 6 === 0 ? `${h}` : ''}</span>)}</div>
      </div>
    </div>
  )
}
