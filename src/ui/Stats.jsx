import { useMemo, useState, useRef, useEffect } from 'preact/hooks'
import { useStore, useNow, profileById } from '../store.js'
import { RANGES, RANGE_LABEL, windowFor, barsFor, quickStats, heatmap, timeOfDay } from '../model/stats.js'
import { epochDayStart, formatDate, formatHm, formatHoursShort } from '../model/time.js'
import { withAlpha, languageFill } from '../model/theme.js'
import { LanguageDot } from './common.jsx'

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

  return (
    <div style="margin-top:14px">
      <div class="chips scroll">
        {RANGES.map((r) => <button key={r} class={`chip ${range === r ? 'on' : ''}`} onClick={() => { setRange(r); setOffset(0) }}>{RANGE_LABEL[r]}</button>)}
      </div>
      {languages.length > 1 && (
        <div class="chips scroll" style="margin-top:8px">
          {languages.map((p) => (
            <button key={p.id} class={`chip ${hidden.has(p.id) ? '' : 'on'}`} onClick={() => setHidden((prev) => { const n = new Set(prev); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n })}>
              <LanguageDot profile={p} />{p.name}
            </button>
          ))}
        </div>
      )}

      <div class="card section">
        <div class="row">
          {range !== 'ALL' && <button class="icon-btn" title="Previous" onClick={() => setOffset(offset + 1)}>‹</button>}
          <div class="grow center" style="font-weight:650">{win.label}</div>
          {range !== 'ALL' && <button class="icon-btn" title="Next" disabled={offset === 0} style={offset === 0 ? 'opacity:.3' : ''} onClick={() => setOffset(Math.max(0, offset - 1))}>›</button>}
        </div>
        <div class="center muted small">Total: {formatHm(stats.total)}{hover != null ? ` · ${win.buckets[hover][2]}: ${formatHm([...bars[hover].values()].reduce((a, c) => a + c, 0))}` : ''}</div>
        {hidden.size === languages.length && languages.length ? <div class="empty">No languages selected.</div> : (
          <>
            <div class="chart" onMouseLeave={() => setHover(null)}>
              {bars.map((b, i) => {
                const total = [...b.values()].reduce((a, c) => a + c, 0)
                return (
                  <div key={i} class="bar" title={`${win.buckets[i][2]}: ${formatHm(total)}`} onMouseEnter={() => setHover(i)} onClick={() => zoomTo(i)}>
                    {order.filter((id) => b.get(id)).map((id) => {
                      const p = profileById(id)
                      return <div key={id} class="seg-part" style={{ height: `${(b.get(id) / max) * 100}%`, background: languageFill(p, 0), border: `1px solid ${withAlpha(p.colorHex, 0.9)}` }} />
                    })}
                  </div>
                )
              })}
            </div>
            <div class="chart-labels">{win.buckets.map((b, i) => <span key={i}>{range === 'MONTH' ? (i % 5 === 0 || i === win.buckets.length - 1 ? b[2] : '') : range === 'DAY' ? (i % 3 === 0 ? b[2] : '') : b[2]}</span>)}</div>
            {stats.total === 0 && <div class="center muted small" style="margin-top:6px">Nothing tracked in this window yet.</div>}
            {ZOOM_IN[range] && <div class="center muted tiny" style="margin-top:6px">Tap a bar to zoom in</div>}
          </>
        )}
      </div>

      <div class="stat-tiles section">
        <div class="tile"><div class="k">Total</div><div class="v">{formatHoursShort(stats.total)}</div></div>
        <div class="tile"><div class="k">Daily avg</div><div class="v">{formatHm(stats.dailyAvg)}</div></div>
        <div class="tile"><div class="k">Best day</div><div class="v">{stats.best ? formatHm(stats.best.ms) : '–'}</div>{stats.best && <div class="k">{formatDate(epochDayStart(stats.best.day))}</div>}</div>
        <div class="tile"><div class="k">Streak</div><div class="v">🔥 {stats.streak}d</div></div>
        <div class="tile"><div class="k">Longest streak</div><div class="v">{stats.longest}d</div></div>
      </div>

      {stats.byLang.size > 0 && (
        <div class="card section">
          <h3 style="margin-bottom:10px">By language</h3>
          <div class="col" style="gap:12px">
            {[...stats.byLang].sort((a, b) => b[1].total - a[1].total).map(([id, v]) => {
              const p = profileById(id)
              return (
                <div key={id}>
                  <div class="row small"><LanguageDot profile={p} /><b class="grow">{p?.name || '?'}</b><span>{formatHm(v.total)} · {Math.round((v.total / stats.total) * 100)}%</span></div>
                  <div class="progress" style="margin-top:6px">
                    <div style={{ width: `${(v.PODCAST / stats.total) * 100}%`, background: p?.colorHex }} title={`Listening ${formatHm(v.PODCAST)}`} />
                    <div style={{ width: `${(v.READING / stats.total) * 100}%`, background: withAlpha(p?.colorHex || '#888', 0.55) }} title={`Reading ${formatHm(v.READING)}`} />
                  </div>
                  <div class="muted tiny" style="margin-top:3px">🎧 {formatHm(v.PODCAST)} · 📖 {formatHm(v.READING)}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div class="card section">
        <h3>Heatmap</h3>
        <div class="muted tiny" style="margin-bottom:10px">12 months to {formatDate(now)} · each day in its top language</div>
        <div class="heat" ref={heatRef}>
          {heat.cells.map((c) => {
            const p = c.top != null ? profileById(c.top) : null
            const a = c.total ? Math.min(1, 0.25 + 0.75 * (c.total / heat.p95)) : 0
            return <div key={c.day} title={`${formatDate(epochDayStart(c.day))}: ${formatHm(c.total)}`} style={c.total ? { background: withAlpha(p?.colorHex || '#6FA8C9', a) } : undefined} />
          })}
        </div>
      </div>

      <div class="card section">
        <h3>Time of day</h3>
        <div class="muted tiny" style="margin-bottom:10px">When you immerse, across all your history. Hours are shown in the time zone each session happened in.</div>
        <div class="tod">{tod.map((v, h) => <div key={h} title={`${h}:00 · ${Math.round(v * 100)}%`} style={{ height: `${(v / Math.max(0.0001, ...tod)) * 100}%` }} />)}</div>
        <div class="chart-labels">{tod.map((_, h) => <span key={h}>{h % 6 === 0 ? `${h}` : ''}</span>)}</div>
      </div>
    </div>
  )
}
