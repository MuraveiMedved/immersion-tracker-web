import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  useStore, useNow, getState, startManualEntry, stopRunningEntry, deleteRunningEntry,
  editRunningElapsed, editRunningTitle, logCompletedManualEntry, upsertProfile, saveGoalCardLayout, profileById, PODCAST, READING, ANKI, LISTENING, pausedEntry
} from '../store.js'
import { GENERAL, listeningGoalOf, readingGoalOf, generalGoalOf, ankiGoalOf, hasGoal, fillsGoal, counts, computeStreak, dailyTotalsFor, durationOf, goldenStreakDays, goldenTodayMillis, GOLDEN_DAILY_MILLIS, momentumTier, nextMomentumTier, typeLabel } from '../model/rules.js'
import { dayStart, goalDayStart, formatClock, formatHm, formatDate, addDays, HOUR } from '../model/time.js'
import { languageFill, withAlpha, gradientStops, deepened, isDarkFor, luminance, dimColor } from '../model/theme.js'
import { Ring } from './Ring.jsx'
import { Dialog, Confirm, DurationInput, hmToMillis, LanguageChip, Bolt, MomentumTierTable, Icon, TypeIcon, TypeLabel, LanguageFilterChip, GoalModeChoice, StreakBadge, MomentumPill, DayPicker, toast } from './common.jsx'
import { EntryRow, EntryDetails, UncategorizedFolder } from './Entries.jsx'
import { startTimer, stopTimer, discardTimer, toggleTimer, lastSession, sessionName, recentSessions, fromPhone, pauseTimer, resumeTimer, stopPausedTimer, discardPausedTimer } from './timers.js'
import { ICONS } from './icons.js'

const RUNNING_ORDER = [LISTENING, PODCAST, READING, ANKI]

/** Home, laid out like the phone's: title and today's total, what's being tracked (or a dashed
 *  "not tracking" box), Today with Momentum, the goal cards, then Recent. */
export function Home({ nav }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const s = useStore()
  const now = useNow(1000)
  const [manual, setManual] = useState(null) // {type, profileId}
  const [goalCard, setGoalCard] = useState(null)
  const [golden, setGolden] = useState(false)
  const [details, setDetails] = useState(null)
  const light = !isDarkFor(s.settings.uiColorPreset)

  const running = RUNNING_ORDER.map((t) => s.entries.find((e) => e.endTimeMillis == null && e.contentType === t)).filter(Boolean)
  const todayStart = goalDayStart(now) // goal days run from 4 AM
  const todayTotal = s.entries.reduce((t, e) => {
    if (e.startTimeMillis < todayStart || e.languageProfileId == null) return t
    if (e.contentType === LISTENING || e.contentType === ANKI) return t
    return t + durationOf(e, now)
  }, 0)
  const goldenDays = useMemo(() => goldenStreakDays(s.entries, now), [s.entries, Math.floor(now / 60000)])
  const goldenToday = goldenTodayMillis(s.entries, now)
  const immersing = running.some((e) => (e.contentType === PODCAST || e.contentType === READING) && e.languageProfileId != null)

  const sortedCards = s.profiles
    .filter((p) => !p.isAnki && hasGoal(p))
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const drag = useGoalCardDrag(sortedCards, saveGoalCardLayout)
  const cards = drag.order
    ? drag.order.map((id) => sortedCards.find((p) => p.id === id)).filter(Boolean).concat(sortedCards.filter((p) => !drag.order.includes(p.id)))
    : sortedCards
  // A card's width follows its rings (the phone's GoalCardsGrid): side by side = full width,
  // stacked = half. Unpicked cards are half width, except an odd one out: when the half-width cards
  // add up to an odd number, one unpicked card goes full width - the main language (placed first),
  // else the last unpicked one (left where it is). A card picked as stacked is never widened.
  const halves = cards.filter((p) => drag.stackedOf(p) !== false)
  const unpicked = halves.filter((p) => drag.stackedOf(p) == null)
  const oddOne = halves.length % 2 === 1 ? unpicked.find((p) => p.isMain) || unpicked[unpicked.length - 1] || null : null
  const isWide = (p) => drag.stackedOf(p) === false || p === oddOne
  const laidOut = oddOne?.isMain ? [oddOne, ...cards.filter((p) => p !== oddOne)] : cards
  // Full-width cards keep their place and split the half-width ones into separate two-column runs.
  const blocks = []
  for (const p of laidOut) {
    if (isWide(p)) { blocks.push({ wide: p }); continue }
    let run = blocks[blocks.length - 1]
    if (!run || run.wide) blocks.push(run = { columns: [[], []], weights: [0, 0] })
    // Roughly the card's height: the name row plus each ring (about twice as tall), Anki's too.
    const w = 1 + 2 * ((listeningGoalOf(p) > 0) + (readingGoalOf(p) > 0) + (generalGoalOf(p) > 0) + (ankiGoalOf(p) > 0))
    const i = run.weights[0] <= run.weights[1] ? 0 : 1
    run.columns[i].push(p)
    run.weights[i] += w
  }
  const languages = s.profiles.filter((p) => !p.isAnki)
  const sorted = useMemo(() => [...s.entries].sort((a, b) => b.startTimeMillis - a.startTimeMillis), [s.entries])
  const recent = sorted.filter((e) => e.languageProfileId != null).slice(0, 5)
  // Anki without a language (from before Anki was a mode of each language) is always listed.
  const uncategorized = sorted.filter((e) => e.languageProfileId == null && (s.settings.logUncategorized || e.contentType === ANKI))
  const paused = running.length ? null : pausedEntry()
  const activeProfile = running.map((e) => profileById(e.languageProfileId)).find((p) => p && !p.isAnki)
  // Desktop: Space stops what's running (the newest one), or resumes the last session.
  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.target.closest?.('input, textarea, select, button, [contenteditable], a') || document.querySelector('.scrim')) return
      e.preventDefault()
      const live = RUNNING_ORDER.map((t) => getState().entries.find((x) => x.endTimeMillis == null && x.contentType === t)).filter(Boolean)
      if (live.length) stopTimer(live.reduce((a, b) => (b.startTimeMillis > a.startTimeMillis ? b : a)))
      else if (pausedEntry()) resumeTimer(pausedEntry())
      else {
        const last = lastSession()
        if (last) startTimer(last.contentType, last.languageProfileId, last.mediaTitle)
        else setManual({})
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const card = (p, wide) => <GoalCard key={p.id} profile={p} now={now} running={running} light={light} wide={wide}
    lifted={drag.id === p.id} selected={drag.selected === p.id} stacked={drag.stackedOf(p) === true}
    onToggleStacked={drag.selected === p.id ? () => drag.toggleStacked(p, wide) : null} onOpen={() => setGoalCard(p.id)} />

  return (
    <>
      {activeProfile && <div class="backdrop-wash" style={{ background: `linear-gradient(${withAlpha(activeProfile.colorHex, light ? 0.18 : 0.28)}, transparent)` }} />}
      {menuOpen && <HomeMenu nav={nav} active={activeProfile} onClose={() => setMenuOpen(false)} />}
      <div class="home-head">
        <div class="title-col">
          <Title mode={s.settings.titleStyleMode} active={activeProfile} light={light} />
          <div class="version">web ⚡</div>
        </div>
        <div class="side">
          <div class="row" style="gap:0">
            <button class="icon-btn" title="Start a manual session" onClick={() => setManual({})}><Icon name="add" /></button>
            {/* Home's menu - Stats and All entries - with the other header button, not before the title. */}
            <button class="icon-btn" title="Menu: stats and all entries" onClick={() => setMenuOpen(true)}><Icon name="menu" /></button>
          </div>
          <div class="today-total">Today: {formatHm(todayTotal)}</div>
        </div>
      </div>

      {running.length
        ? running.map((e) => <NowTrackingBanner key={e.id} entry={e} now={now} light={light} mode={s.settings.goalCardStyleMode} />)
        : paused
          ? <NowTrackingBanner entry={paused} now={now} light={light} mode={s.settings.goalCardStyleMode} paused onOpen={() => paused.id != null && setDetails(paused.id)} />
          : <IdleBanner now={now} onOther={() => setManual({})} />}

      <div class="today-row">
        <h2>Today</h2>
        <MomentumPill days={goldenDays} progress={goldenToday / GOLDEN_DAILY_MILLIS} onClick={() => setGolden(true)} />
        {/* Rearranging the goal cards (a long press on one starts it): the checkmark saves. */}
        {drag.editing && <button class="icon-btn reorder-done" title="Done rearranging" onClick={drag.confirm}><Icon name="check" /></button>}
      </div>

      {!languages.length ? (
        <div class="card center" style="margin-top:8px">
          <h2 style="margin-bottom:4px">Add a language you're studying</h2>
          <p class="muted" style="margin:0 0 14px">Pick a name, a colour and a daily goal - its rings show up here.</p>
          <button class="btn" onClick={() => nav('settings', { addLanguage: true })}>Add language</button>
        </div>
      ) : (
        <div {...drag.handlers}>
          {blocks.map((b, n) => (b.wide
            ? card(b.wide, true)
            : <div class="goal-cols" key={`run${n}`}>{b.columns.map((col, i) => <div key={i}>{col.map((p) => card(p, false))}</div>)}</div>))}
        </div>
      )}

      <div class="divider" />
      <div class="row" style="margin-right:-12px">
        <h2 class="grow">Recent</h2>
        <button class="btn text" onClick={() => nav('entries', { tab: 'entries' })}>See all</button>
      </div>
      {uncategorized.length > 0 && <UncategorizedFolder entries={uncategorized} now={now} onOpen={setDetails} />}
      {!recent.length && !uncategorized.length
        ? <p class="muted" style="margin:12px 0">Nothing tracked yet. Start a session and it'll show up here.</p>
        : <div class="list">{recent.map((e) => <EntryRow key={e.id} entry={e} now={now} onClick={() => setDetails(e.id)} />)}</div>}

      <StartAgain now={now} running={running} light={light} />

      {manual && <ManualSessionDialog initialType={manual.type} initialProfileId={manual.profileId} onClose={() => setManual(null)} />}
      {goalCard != null && profileById(goalCard) && <GoalEditDialog profile={profileById(goalCard)} onClose={() => setGoalCard(null)}
        onAdd={(type) => { setGoalCard(null); setManual({ type, profileId: goalCard }) }} onSettings={() => { setGoalCard(null); nav('settings', { language: goalCard }) }} />}
      {golden && <GoldenStreakDialog days={goldenDays} todayMillis={goldenToday} immersing={immersing} onClose={() => setGolden(false)} />}
      {details != null && <EntryDetails id={details} onClose={() => setDetails(null)} />}
    </>
  )
}

function Title({ mode, active, light }) {
  if (mode === 'GRADIENT') return <h1 class="app-title gradient">Immersion Tracker</h1>
  if (mode === 'THEME_COLOR') return <h1 class="app-title" style="color:var(--primary);font-weight:900">Immersion Tracker</h1>
  if (mode === 'CURRENT_LANGUAGE' && active) {
    const stops = gradientStops(active)
    return stops && stops.length > 1
      ? <h1 class="app-title gradient" style={{ backgroundImage: `linear-gradient(90deg, ${stops.map((c) => (light ? deepened(c, 0.5) : c)).join(', ')})`, fontWeight: 900 }}>Immersion Tracker</h1>
      : <h1 class="app-title" style={{ color: light ? deepened(active.colorHex, 0.5) : active.colorHex, fontWeight: 900 }}>Immersion Tracker</h1>
  }
  // The current-language title is always this bold, coloured or not: the bolder text is wider, and
  // switching weight as a session gained or lost its language could wrap it to two lines and back.
  if (mode === 'CURRENT_LANGUAGE') return <h1 class="app-title" style="font-weight:900">Immersion Tracker</h1>
  return <h1 class="app-title">Immersion Tracker</h1>
}

/** The phone's NowTrackingBanner: the language's colour taken down to a background, its outline,
 *  "Listening · Japanese · 12:34" in the language colour, the title, and pause / stop / discard. A
 *  session the phone is tracking just says so ("On your phone") - it plays there, so there's
 *  nothing to carry on with in a browser. [paused]: a paused timer - play resumes it, and a tap opens it like any saved entry. */
function NowTrackingBanner({ entry, now, light, mode, paused = false, onOpen }) {
  const profile = profileById(entry.languageProfileId)
  const [edit, setEdit] = useState(false)
  const color = profile?.colorHex || '#6FA8C9'
  const grey = mode === 'GREY_TINT'
  const stops = !grey && gradientStops(profile)
  const bg = grey ? 'var(--surface)' : stops && stops.length > 1
    ? `linear-gradient(90deg, ${stops.map((c) => dimColor(c, 0.9, 0.32, light)).join(', ')})`
    : dimColor(color, 0.9, 0.32, light)
  const ink = light ? deepened(color, 0.42) : color
  const phone = fromPhone(entry)
  return (
    <div class="now-banner" style={{ background: bg, borderColor: grey ? 'var(--block-line)' : withAlpha(color, 0.6) }} onClick={() => (paused ? onOpen?.() : setEdit(true))}>
      <span class="dot8" style={{ background: profile ? languageFill(profile, 135) : color }} />
      <div class="grow">
        <div class="label-large" style={{ color: ink }}>{typeLabel(entry.contentType)} · {profile?.name || 'Uncategorized'} · {formatClock(durationOf(entry, now))}</div>
        {entry.mediaTitle && <div class="small ellipsis">{entry.mediaTitle}</div>}
        <div class="small" style={{ color: withAlpha(ink.startsWith('#') ? ink : '#888888', 0.7) }}>
          {paused ? 'Paused · tap to edit' : phone ? 'On your phone' : 'Manual · tap to edit title or time'}
        </div>
      </div>
      {paused
        ? <button class="stop" style={{ color: ink }} title="Resume (Space)" onClick={(ev) => { ev.stopPropagation(); resumeTimer(entry) }}><Icon name="play_arrow" size={24} /></button>
        : !phone && <button class="stop" style={{ color: ink }} title="Pause" onClick={(ev) => { ev.stopPropagation(); pauseTimer(entry) }}><Icon name="pause" size={22} /></button>}
      <button class="stop" style={{ color: ink }} title={paused ? 'Stop and save' : 'Stop and save (Space)'} onClick={(ev) => { ev.stopPropagation(); paused ? stopPausedTimer(entry) : stopTimer(entry) }}><span /></button>
      <button class="stop" style={{ color: ink }} title="Discard without counting its time" onClick={(ev) => { ev.stopPropagation(); paused ? discardPausedTimer(entry) : discardTimer(entry) }}><Icon name="close" size={18} /></button>
      {edit && <EditElapsedDialog entry={entry} onClose={() => setEdit(false)} />}
    </div>
  )
}

/** Not tracking: your last session, one tap from running again (until the Resume button
 *  setting's time since it ended passes), and the way to start anything else. (With nothing to resume, the whole banner opens Add a session.) */
function IdleBanner({ now, onOther }) {
  useStore()
  const last = lastSession(now)
  if (!last) return <div class="idle-banner" role="button" onClick={onOther}>Not tracking · tap to start a session</div>
  const profile = profileById(last.languageProfileId)
  const color = profile?.colorHex || '#6FA8C9'
  return (
    <div class="idle-banner resume">
      <button class="resume-btn" title="Resume (Space)" onClick={() => startTimer(last.contentType, last.languageProfileId, last.mediaTitle)}>
        <span class="resume-play" style={{ background: withAlpha(color, 0.22), color }}><TypeIcon type={last.contentType} size={24} /></span>
        <span class="grow" style="min-width:0;text-align:left">
          <span class="resume-label">Resume · {sessionName(last.contentType, last.languageProfileId)}</span>
          {last.mediaTitle && <span class="resume-title ellipsis">{last.mediaTitle}</span>}
        </span>
      </button>
      <button class="btn text" onClick={onOther}><Icon name="add" size={18} />Other</button>
    </div>
  )
}

/** "Start again", in the empty column to the right of Home on wide screens: the last four
 *  different listening and reading sessions, each one click from running again with the same
 *  title and language - the web can't log anything by itself, so repeating a session should cost
 *  nothing. The one running now is marked, and a click on it stops it. */
function StartAgain({ now, running, light }) {
  const s = useStore()
  const groups = useMemo(() => [[PODCAST, 'Listening'], [READING, 'Reading']]
    .map(([type, label]) => ({ type, label, items: recentSessions(type) }))
    .filter((g) => g.items.length), [s.entries])
  if (!groups.length) return null
  const ago = (ms) => {
    const d = Math.floor((dayStart(now) - dayStart(ms)) / 86400000)
    return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : d < 7 ? `${d} days ago` : formatDate(ms)
  }
  return (
    <aside class="start-again" aria-label="Start again">
      <div class="sa-head">
        <Icon name="restore" size={20} />
        <span>Start again</span>
      </div>
      {groups.map((g) => (
        <section key={g.type} class="sa-group">
          <div class="sa-group-title"><TypeIcon type={g.type} size={18} />{g.label}</div>
          {g.items.map((e) => {
            const profile = profileById(e.languageProfileId)
            const color = profile?.colorHex || UNRESOLVED_GRAY
            const ink = light ? deepened(color, 0.42) : color
            const live = running.find((r) => r.contentType === g.type && r.languageProfileId === e.languageProfileId && r.mediaTitle === e.mediaTitle)
            return (
              <button key={e.id} class={`sa-item ${live ? 'live' : ''}`}
                style={{ '--sa-color': color, '--sa-fill': profile ? languageFill(profile, 180) : color }}
                title={live ? 'Running now - click to stop' : `Start "${e.mediaTitle}" again`}
                onClick={() => (live ? stopTimer(live) : startTimer(g.type, e.languageProfileId, e.mediaTitle))}>
                <span class="sa-bar" />
                <span class="grow" style="min-width:0">
                  <span class="sa-title">{e.mediaTitle}</span>
                  <span class="sa-meta"><b style={{ color: ink }}>{profile?.name || 'Uncategorized'}</b> · {live ? `running ${formatClock(durationOf(live, now))}` : ago(e.startTimeMillis)}</span>
                </span>
                <span class="sa-go"><Icon name={live ? 'stop' : 'play_arrow'} size={20} /></span>
              </button>
            )
          })}
        </section>
      ))}
      <p class="sa-tip"><Icon name="info" size={16} />Click any session to start a new timer with the same title and language. Press Space to resume the last one.</p>
    </aside>
  )
}

/** The running timer in the browser tab's title, so it can be seen from any other tab. */
export function TabTitle() {
  const s = useStore()
  const now = useNow(1000)
  const live = RUNNING_ORDER.map((t) => s.entries.find((e) => e.endTimeMillis == null && e.contentType === t)).filter(Boolean)
  const label = live.length ? `${formatClock(durationOf(live[0], now))} · ${sessionName(live[0].contentType, live[0].languageProfileId)}` : 'Immersion Tracker'
  useEffect(() => { document.title = label }, [label])
  return null
}

function EditElapsedDialog({ entry, onClose }) {
  const ms = durationOf(entry)
  const [title, setTitle] = useState(entry.mediaTitle || '')
  const titleInput = useRef(null)
  // Title selected on open, so a quick start's "Manual Japanese session" is replaced by just typing.
  useEffect(() => { titleInput.current?.focus(); titleInput.current?.select() }, [])
  const [h, setH] = useState(String(Math.floor(ms / HOUR)))
  const [m, setM] = useState(String(Math.floor((ms % HOUR) / 60000)))
  const save = () => {
    const t = title.trim()
    if (t && t !== entry.mediaTitle) editRunningTitle(entry.contentType, t)
    const next = hmToMillis(h, m)
    // Only when the time was actually changed - otherwise saving a new title would knock off the
    // seconds that have ticked by since the dialog opened.
    if (next !== Math.floor(ms / 60000) * 60000) editRunningElapsed(entry.contentType, next)
    onClose()
  }
  return (
    <Dialog title="Edit session" onClose={onClose} sheet={false} actions={<>
      <button class="btn text" onClick={onClose}>Cancel</button>
      <button class="btn" onClick={save}>Save</button>
    </>}>
      <label class="field" style="margin-bottom:14px">Title
        <input ref={titleInput} class="input" value={title} onInput={(e) => setTitle(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
      </label>
      <div class="muted small" style="margin-bottom:6px">Time so far</div>
      <DurationInput hours={h} minutes={m} onHours={setH} onMinutes={setM} />
      {/* Started late? Add the minutes you forgot in one tap. */}
      <div class="muted small" style="margin:14px 0 6px">Forgot to start it? Add time</div>
      <div class="chips">
        {[5, 10, 15, 30, 60].map((min) => (
          <button key={min} class="chip" onClick={() => {
            const total = hmToMillis(h, m) + min * 60000
            setH(String(Math.floor(total / HOUR)))
            setM(String(Math.floor((total % HOUR) / 60000)))
          }}>+{formatHm(min * 60000, true)}</button>
        ))}
      </div>
    </Dialog>
  )
}

const LONG_PRESS_MS = 500
const PRESS_SLOP = 8

/** Rearranging the goal cards, like the phone's GoalCardsGrid / GoalCardsReorderState. Outside it
 *  the cards are left alone (a drag scrolls as usual); only a long press on a card starts it.
 *  While it's on, the selected card is highlighted, a card is picked up (and selected) as soon as
 *  it's touched and dragged over another to take that one's place, taps don't open cards, and the
 *  selected card can switch between half width (rings stacked) and full width (rings beside the
 *  name). Nothing is saved
 *  until confirm() (the checkmark) hands [onSave] the new order (ids, first to last - null if
 *  unchanged) and the switched rings ({ id: stacked }); Escape drops it all. The lifted card
 *  follows the finger by a transform worked out from wherever it's laid out now, since it can
 *  change column or go full-width as others move. */
function useGoalCardDrag(cards, onSave) {
  const ids = cards.map((p) => p.id)
  const [state, setState] = useState(null) // { order, id (lifted), selected, stacked: { id: bool } }
  const live = useRef(null) // { id, order, x, y, grabX, grabY, lastSwap }
  const suppressClickUntil = useRef(0)
  const editing = !!state
  useEffect(() => {
    if (!editing) return
    const onKey = (e) => { if (e.key === 'Escape') setState(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing])

  const cardEl = (id) => document.querySelector(`.goal-area [data-goal-id="${id}"]`)
  const follow = () => {
    const d = live.current
    const el = d && cardEl(d.id)
    if (!el) return
    el.style.transform = ''
    const r = el.getBoundingClientRect()
    el.style.transform = `translate(${d.x - d.grabX - r.left}px, ${d.y - d.grabY - r.top}px) scale(1.04)`
  }
  useLayoutEffect(follow)

  const onPointerDown = (e) => {
    if (e.button !== 0 || live.current || e.target.closest('.rings-toggle')) return
    const el = e.target.closest('[data-goal-id]')
    if (!el) return
    const id = Number(el.dataset.goalId)
    const startX = e.clientX, startY = e.clientY
    let x = startX, y = startY
    const preventScroll = (ev) => ev.preventDefault()
    const begin = () => {
      timer = null
      const r = el.getBoundingClientRect()
      const order = state?.order ?? ids
      live.current = { id, order, x, y, grabX: x - r.left, grabY: y - r.top, lastSwap: null }
      if (!editing) navigator.vibrate?.(10)
      document.addEventListener('touchmove', preventScroll, { passive: false })
      setState((st) => ({ stacked: {}, ...st, order, id, selected: id }))
    }
    // Already rearranging: picked up straight away. Otherwise only a long press starts it.
    let timer = editing ? null : setTimeout(begin, LONG_PRESS_MS)
    const onMove = (ev) => {
      x = ev.clientX
      y = ev.clientY
      const d = live.current
      if (!d) {
        if (timer && Math.hypot(x - startX, y - startY) > PRESS_SLOP) end()
        return
      }
      d.x = x
      d.y = y
      follow()
      const over = document.elementsFromPoint(x, y).map((n) => n.closest?.('.goal-area [data-goal-id]')).find((n) => n && Number(n.dataset.goalId) !== id)
      const overId = over ? Number(over.dataset.goalId) : null
      // Not swapped back with the card it just traded places with until the finger has left it,
      // or cards of different heights would trade back and forth under it.
      if (overId == null) d.lastSwap = null
      else if (overId !== d.lastSwap) {
        d.lastSwap = overId
        const order = d.order.filter((o) => o !== id)
        order.splice(order.indexOf(overId), 0, id)
        d.order = order
        setState((st) => ({ ...st, order }))
      }
    }
    const end = () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      document.removeEventListener('touchmove', preventScroll)
      const d = live.current
      if (!d) return
      const el = cardEl(id)
      if (el) el.style.transform = ''
      live.current = null
      suppressClickUntil.current = Date.now() + 400
      setState((st) => st && { ...st, order: d.order, id: null })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    if (editing) {
      e.preventDefault()
      begin()
    }
  }

  /** Stacked as switched here, else the language's saved choice; null = not picked. */
  const stackedOf = (p) => state?.stacked?.[p.id] ?? p.ringsStacked ?? null

  return {
    order: state?.order ?? null,
    id: state?.id ?? null,
    selected: state?.selected ?? null,
    editing,
    stackedOf,
    /** Flips the card between full width, rings side by side ([wide] now), and half, stacked. */
    toggleStacked: (p, wide) => setState((st) => st && { ...st, stacked: { ...st.stacked, [p.id]: wide } }),
    confirm: () => {
      const order = state?.order && state.order.join(',') !== ids.join(',') ? state.order : null
      const stacked = Object.fromEntries(Object.entries(state?.stacked ?? {})
        .filter(([id, v]) => cards.find((p) => p.id === Number(id))?.ringsStacked !== v))
      if (order || Object.keys(stacked).length) onSave(order, stacked)
      setState(null)
    },
    handlers: {
      class: `goal-area ${editing ? 'editing' : ''}`,
      onPointerDown,
      // A long press (or anything but the rings button while rearranging) doesn't also open the
      // card or start a ring's timer when it's let go.
      onClickCapture: (e) => {
        if (e.target.closest('.rings-toggle')) return
        if (editing || Date.now() < suppressClickUntil.current) { e.stopPropagation(); e.preventDefault() }
      },
      onContextMenu: (e) => { if (e.target.closest('[data-goal-id]')) e.preventDefault() },
    },
  }
}

/** Home's side menu (the phone's HomeDrawerScaffold): the app's title in Home's own style, then
 *  Stats and All entries (each its own page) with the app's icon badges - [current] marks the one
 *  it's open over, [active] is the playing language for that title style. A tap outside or Escape
 *  closes it. */
export function HomeMenu({ nav, onClose, current = null, active = null }) {
  const s = useStore()
  const light = !isDarkFor(s.settings.uiColorPreset)
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const go = (tab) => { onClose(); if (tab !== current) nav('entries', { tab }) }
  return (
    <div class="side-menu-scrim" onClick={onClose}>
      <nav class="side-menu" onClick={(e) => e.stopPropagation()}>
        <div class="side-menu-head">
          <Title mode={s.settings.titleStyleMode} active={active} light={light} />
          <div class="version">web ⚡</div>
        </div>
        <button class={`side-menu-item ${current === 'stats' ? 'on' : ''}`} onClick={() => go('stats')}><span class="badge-ico"><Icon name="bar_chart" size={22} /></span>Stats</button>
        <button class={`side-menu-item ${current === 'entries' ? 'on' : ''}`} onClick={() => go('entries')}><span class="badge-ico"><Icon name="list" size={22} /></span>All entries</button>
      </nav>
    </div>
  )
}

function GoalCard({ profile, now, running, light, wide, lifted, selected, stacked, onToggleStacked, onOpen }) {
  const s = useStore()
  const todayStart = goalDayStart(now) // goal days run from 4 AM
  const todayOf = (type) => s.entries.reduce((t, e) => (e.languageProfileId === profile.id && fillsGoal(type, e.contentType) && e.startTimeMillis >= todayStart ? t + durationOf(e, now) : t), 0)
  const isActive = (type) => running.some((e) => e.languageProfileId === profile.id && fillsGoal(type, e.contentType))
  const active = isActive(PODCAST) || isActive(READING) || isActive(ANKI)
  const stops = gradientStops(profile)
  const multi = stops && stops.length > 1
  const grey = s.settings.goalCardStyleMode === 'GREY_TINT'
  const [sat, val] = active ? [0.9, 0.32] : [0.6, 0.18]
  const bg = grey ? 'var(--surface)' : multi
    ? `linear-gradient(135deg, ${stops.map((c) => dimColor(c, sat, val, light)).join(', ')})`
    : dimColor(profile.colorHex, sat, val, light)
  const outline = active ? (grey ? 'var(--block-line)' : withAlpha(profile.colorHex, 0.6)) : 'transparent'
  const nameStyle = multi
    ? { backgroundImage: `linear-gradient(90deg, ${stops.map((c) => (light ? deepened(c, 0.42) : c)).join(', ')})`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }
    : { color: light ? deepened(profile.colorHex, 0.42) : profile.colorHex }
  const iconColor = light ? '#000' : '#fff'
  // Anki is a third mode, with its own goal - never part of the General one (it isn't immersion).
  const rings = [[PODCAST, listeningGoalOf(profile)], [READING, readingGoalOf(profile)], [GENERAL, generalGoalOf(profile)], [ANKI, ankiGoalOf(profile)]]
    .filter(([, g]) => g > 0)
  return (
    <div class={`goal-card ${wide ? 'wide' : ''} ${lifted ? 'lifted' : ''} ${selected ? 'selected' : ''} ${stacked ? 'stacked' : ''}`}
      data-goal-id={profile.id} style={{ background: bg, borderColor: outline }} onClick={onOpen} role="button">
      {onToggleStacked && (
        <button class="rings-toggle" title={wide ? 'Rings stacked' : 'Rings side by side'} onClick={(ev) => { ev.stopPropagation(); onToggleStacked() }}>
          <Icon name="screen_rotation" size={20} />
        </button>
      )}
      <div class="name" style={nameStyle}>{profile.name}</div>
      <div class="rings">
      {rings.map(([type, goal]) => {
        const ms = todayOf(type)
        const on = isActive(type)
        // The General ring stands for two kinds of session, so a tap on it opens the card's dialog
        // (pick what to add there) rather than guessing which timer to start.
        const tap = type === GENERAL ? {} : { role: 'button', tabIndex: 0, title: on ? `Stop ${sessionName(type, profile.id)}` : `Start ${sessionName(type, profile.id)}`,
          onClick: (ev) => { ev.stopPropagation(); toggleTimer(type, profile.id) },
          onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.stopPropagation(); toggleTimer(type, profile.id) } } }
        if (!goal) {
          return (
            <div key={type} class={`ring-stat tap ${on ? 'on' : ''}`} {...tap}>
              <div style="width:64px;height:64px;display:grid;place-items:center"><TypeIcon type={type} size={40} color={profile.colorHex} style={active ? { animation: 'pulse-a .9s ease-in-out infinite alternate' } : undefined} /></div>
              <span class="val">{formatHm(ms)}</span>
              <span class="tap-hint"><Icon name={on ? 'stop' : 'play_arrow'} size={16} /></span>
            </div>
          )
        }
        const goalMs = goal * 60000
        return (
          <div key={type} class={`ring-stat ${type === GENERAL ? '' : 'tap'} ${on ? 'on' : ''}`} {...tap}>
            <Ring size={64} progress={ms / goalMs} color={profile.colorHex} stops={stops} ringStyle={s.settings.ringStyle} iconType={type} iconColor={iconColor} active={isActive(type)} light={light} />
            <span class="val">{formatHm(ms)} / {formatHm(goalMs, true)}</span>
            <StreakBadge streak={computeStreak(dailyTotalsFor(s.entries, profile.id, type, now), goalMs, now)} />
            {type !== GENERAL && <span class="tap-hint"><Icon name={on ? 'stop' : 'play_arrow'} size={16} /></span>}
          </div>
        )
      })}
      </div>
    </div>
  )
}

function GoalEditDialog({ profile, onClose, onAdd, onSettings }) {
  const [listen, setListen] = useState(String(profile.podcastGoalMinutes))
  const [read, setRead] = useState(String(profile.readingGoalMinutes))
  const [anki, setAnki] = useState(String(profile.ankiGoalMinutes || 0))
  const [general, setGeneral] = useState(!!profile.generalGoal)
  // Switching to General the first time starts it at the two separate goals added together.
  const [gen, setGen] = useState(String(profile.generalGoalMinutes || (profile.podcastGoalMinutes || 0) + (profile.readingGoalMinutes || 0)))
  const save = () => {
    upsertProfile({
      ...profile, podcastGoalMinutes: Number(listen) || 0, readingGoalMinutes: Number(read) || 0,
      generalGoal: general, generalGoalMinutes: general ? Number(gen) || 0 : profile.generalGoalMinutes || 0,
      ankiGoalMinutes: Number(anki) || 0,
    })
    onClose()
  }
  const minutes = (value, set) => <input class="input" inputMode="numeric" value={value} onInput={(e) => set(e.currentTarget.value.replace(/\D/g, ''))} />
  // Like the phone's GoalEditDialog: the language and its settings, logging time, then its daily
  // goal, split by a line. Its colour is set in the language's settings (the gear).
  return (
    <Dialog title={<span class="goal-dialog-title"><span class="grow">{profile.name}</span>
      <button class="icon-btn" title="Language settings" onClick={onSettings}><Icon name="settings" /></button></span>}
    onClose={onClose} actions={<>
      <button class="btn text" onClick={onClose}>Cancel</button>
      <button class="btn" onClick={save}>Save</button>
    </>}>
      <div class="col" style="gap:14px">
        <div class="row">
          <button class="btn tonal grow" onClick={() => onAdd(PODCAST)}><TypeLabel type={PODCAST}>Add listening</TypeLabel></button>
          <button class="btn tonal grow" onClick={() => onAdd(READING)}><TypeLabel type={READING}>Add reading</TypeLabel></button>
        </div>
        <>
          <div class="divider goal-dialog-divider" />
          <div class="goal-dialog-section">Daily goal</div>
          <GoalModeChoice general={general} onChange={setGeneral} />
          {general
            ? <label class="field"><TypeLabel type={GENERAL}>General · min</TypeLabel>{minutes(gen, setGen)}</label>
            : <div class="row">
                <label class="field grow"><TypeLabel type={PODCAST}>Listening · min</TypeLabel>{minutes(listen, setListen)}</label>
                <label class="field grow"><TypeLabel type={READING}>Reading · min</TypeLabel>{minutes(read, setRead)}</label>
              </div>}
          {/* Anki's own goal, beside either mode - review isn't immersion. */}
          <label class="field"><TypeLabel type={ANKI}>Study · min</TypeLabel>{minutes(anki, setAnki)}</label>
        </>
      </div>
    </Dialog>
  )
}

/** What Momentum is and what it's for (HomeScreen.kt GoldenStreakDialog): the tier reached and
 *  how far the next is, today's hour and the days each tier takes. */
function GoldenStreakDialog({ days, todayMillis, immersing, onClose }) {
  const tier = momentumTier(days)
  const next = nextMomentumTier(tier)
  const toGo = next && next.minDays - days
  const pct = Math.min(1, todayMillis / GOLDEN_DAILY_MILLIS)
  return (
    <Dialog title={`Momentum · ${days}d`} onClose={onClose} sheet={false} actions={<button class="btn" onClick={onClose}>OK</button>}>
      <div class={`tier-${tier?.id || 'bronze'}`}>
        <div class="center" style="font-size:54px;margin:4px 0 10px"><Bolt tier={tier?.id} muted={!tier} /></div>
        <p style={{ margin: '0 0 12px', fontWeight: 650, textAlign: 'center', color: tier ? 'var(--tier-ink)' : undefined }}>
          {[tier?.name, next ? `${toGo} more day${toGo === 1 ? '' : 's'} to ${next.name}` : 'The top tier'].filter(Boolean).join(' · ')}
        </p>
        <div class="small muted" style="margin-bottom:6px">Today: {formatHm(todayMillis)} of {formatHm(GOLDEN_DAILY_MILLIS)}{immersing ? ' · counting now' : ''}</div>
        <div class="progress" style="height:12px"><div style={{ width: `${pct * 100}%`, background: 'linear-gradient(90deg, var(--tier), var(--tier-pale))' }} /></div>
        <p class="muted small" style="margin:14px 0 8px">1+ hour of immersion every day keeps it going - longer runs reach higher tiers. Every language counts together; music and Study don't.</p>
        <MomentumTierTable current={tier} topTierFirst showHolo={false} />
      </div>
    </Dialog>
  )
}

/** "Add a session", laid out like the phone's StartManualEntryDialog: recent sessions to copy or
 *  start, a band for type + language + title, a band for when and how long; Save logs a length
 *  that already happened, Start (no length) runs a live timer. */
const RECENT_SESSIONS_PREVIEW_COUNT = 3
const MAX_RECENT_MANUAL_SESSIONS = 8
const QUICK_DURATION_MINUTES = [15, 30, 45, 60, 90, 120]

export function ManualSessionDialog({ initialType, initialProfileId, onClose }) {
  const s = useStore()
  // Anki is a mode of each language, like listening and reading.
  const languages = s.profiles.filter((p) => !p.isAnki).sort((a, b) => a.sortOrder - b.sortOrder)
  const allowUncategorized = s.settings.logUncategorized
  const fixedLanguage = initialProfileId != null ? languages.find((p) => p.id === initialProfileId) || null : null
  const [type, setType] = useState(initialType || PODCAST)
  const [profileId, setProfileId] = useState(() =>
    (initialProfileId != null && languages.some((p) => p.id === initialProfileId) ? initialProfileId : null) ??
    languages.find((p) => p.isMain)?.id ?? (allowUncategorized ? null : languages[0]?.id ?? null))
  const [title, setTitle] = useState('')
  const [h, setH] = useState('')
  const [m, setM] = useState('')
  const [day, setDay] = useState(dayStart(Date.now()))
  const [picked, setPicked] = useState(null)
  const [expanded, setExpanded] = useState(false)
  const scroller = useRef(null)
  const today = dayStart(Date.now())
  const millis = hmToMillis(h, m)
  const isPast = day < today

  // Newest first, one per title + type + language, like HomeViewModel.recentManualSessions.
  // Opened from a language's goal card, only that language's.
  const presets = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const e of [...s.entries].sort((a, b) => b.startTimeMillis - a.startTimeMillis)) {
      if (!e.isManual) continue
      if (initialProfileId != null && e.languageProfileId !== initialProfileId) continue
      const key = `${e.mediaTitle}|${e.contentType}|${e.languageProfileId}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ key, title: e.mediaTitle, type: e.contentType, profileId: e.languageProfileId })
      if (out.length >= MAX_RECENT_MANUAL_SESSIONS) break
    }
    return out
  }, [s.entries, initialProfileId])

  const canSubmit = millis > 0 || !isPast
  const submit = () => {
    if (!canSubmit) return
    const name = s.profiles.find((p) => p.id === profileId)?.name ?? 'Uncategorized'
    const t = title.trim() || `Manual ${name} session`
    if (millis > 0) {
      logCompletedManualEntry(type, profileId, t, millis, day)
      toast(`${formatHm(millis)} logged`)
    } else {
      startTimer(type, profileId, t)
    }
    onClose()
  }
  const scrollTo = (bottom) => requestAnimationFrame(() => {
    const el = scroller.current
    if (el) el.scrollTo({ top: bottom ? el.scrollHeight : 0, behavior: 'smooth' })
  })
  const usePreset = (p) => {
    setPicked(p)
    setType(p.type)
    setProfileId(p.profileId)
    setTitle(p.title)
    scrollTo(true)
  }
  const pickType = (t) => { setType(t); setPicked(null) }
  const pickLang = (id) => { setProfileId(id); setPicked(null) }
  const saving = millis > 0 || isPast
  const visible = expanded ? presets : presets.slice(0, RECENT_SESSIONS_PREVIEW_COUNT)

  return (
    <Dialog title={fixedLanguage ? `Add a session · ${fixedLanguage.name}` : 'Add a session'} sheet={false} onClose={onClose} actions={<>
      <button class="btn text" onClick={onClose}>Cancel</button>
      <button class="btn" disabled={!canSubmit} onClick={submit}><Icon name={saving ? 'check' : 'play_arrow'} size={18} />{saving ? 'Save' : 'Start'}</button>
    </>}>
      <div ref={scroller} class="manual-body">
        {presets.length > 0 && (
          <div class="col" style="gap:4px">
            <div class="label-large">Recent sessions</div>
            <div class="muted small" style="padding-bottom:4px">Tap a session to copy it into the form below, or ▶ to start it right away.</div>
            <div class="col" style="gap:8px">
              {visible.map((p) => (
                <RecentSessionRow key={p.key} preset={p} profile={profileById(p.profileId)} selected={picked?.key === p.key}
                  onClick={() => usePreset(p)}
                  onPlay={() => { startTimer(p.type, p.profileId, p.title); onClose() }} />
              ))}
            </div>
            {presets.length > RECENT_SESSIONS_PREVIEW_COUNT && (
              <button class="btn text show-more" onClick={() => setExpanded(!expanded)}>
                {expanded ? 'Show less' : `Show ${presets.length - RECENT_SESSIONS_PREVIEW_COUNT} more`}
                <Icon name={expanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} size={18} />
              </button>
            )}
          </div>
        )}
        {presets.length > 0 && <div class="hr" />}
        <div class="section-band primary">
          <div class="form-group">
            <div class="form-label">Type</div>
            <div class="type-pills">
              <TypePill type={PODCAST} label="Listening" selected={type === PODCAST} onClick={() => pickType(PODCAST)} />
              <TypePill type={READING} label="Reading" selected={type === READING} onClick={() => pickType(READING)} />
              <TypePill type={ANKI} label="Study" selected={type === ANKI} onClick={() => pickType(ANKI)} />
            </div>
          </div>
          {/* Opened from a language's goal card, it's that language (named in the title): no picker. */}
          {!fixedLanguage && (
            <div class="form-group">
              <div class="form-label">Language</div>
              <div class="chips">
                {languages.map((p) => (
                  <LanguageFilterChip key={p.id} profile={p} selected={profileId === p.id} onClick={() => pickLang(p.id)} />
                ))}
                {(allowUncategorized || languages.length === 0) && (
                  <LanguageFilterChip profile={UNCATEGORIZED_CHIP} selected={profileId == null} onClick={() => pickLang(null)} />
                )}
              </div>
            </div>
          )}
          <div class="title-field">
            <Icon name="edit" size={20} />
            <input placeholder="Title (optional)" aria-label="Title (optional)" value={title} onInput={(e) => { setTitle(e.currentTarget.value); setPicked(null) }} onKeyDown={(e) => e.key === 'Enter' && submit()} />
            {title && <button class="icon-btn" aria-label="Clear title" onClick={() => { setTitle(''); setPicked(null) }}><Icon name="close" size={20} /></button>}
          </div>
        </div>
        <div class="section-band secondary">
          {picked && <SelectedSessionBanner preset={picked} profile={profileById(picked.profileId)} onChange={() => scrollTo(false)} />}
          <div class="form-group">
            <div class="form-label">When</div>
            <DayChips today={today} selected={day} onSelect={setDay} />
          </div>
          <div class="form-group">
            <div class="form-label">How long</div>
            <div class="chips">
              {QUICK_DURATION_MINUTES.map((min) => {
                const ms = min * 60000
                const on = millis === ms
                return (
                  <button key={min} class={`chip ${on ? 'on' : ''}`} onClick={() => {
                    if (on) { setH(''); setM('') } else { setH(min >= 60 ? String(Math.floor(min / 60)) : ''); setM(min % 60 === 0 && min >= 60 ? '' : String(min % 60)) }
                  }}>{on && <Icon name="check" size={18} />}{formatHm(ms, true)}</button>
                )
              })}
            </div>
            <DurationInput hours={h} minutes={m} onHours={setH} onMinutes={setM} />
            {millis > 0 && <div class="muted small">= {formatHm(millis)}</div>}
            {millis === 0 && <div class={`small ${isPast ? 'err' : 'muted'}`}>{isPast ? 'Enter how long to log a past day' : 'Leave blank to start a live timer instead'}</div>}
          </div>
        </div>
      </div>
    </Dialog>
  )
}

/** The "no language" chip: shaped like the languages beside it, in neutral grey (the phone's UNCATEGORIZED_CHIP_HEX). */
const UNCATEGORIZED_CHIP = { name: 'Uncategorized', colorHex: '#9E9EA8' }

const stopsOf = (p) => (p?.gradientColors ? p.gradientColors.split(',').map((x) => x.trim()).filter(Boolean) : null)
const UNRESOLVED_GRAY = '#9E9EA8'

/** A session's colours as the phone's RecentSessionRow draws them: [ink] for icons on this page,
 *  [outline]/[fill] brushes for the row. */
function sessionColors(profile, selected, alphaLight, alphaDark) {
  const light = !isDarkFor(getState().settings.uiColorPreset)
  const base = profile?.colorHex || UNRESOLVED_GRAY
  const stops = stopsOf(profile) || [base, base]
  const fillA = light ? alphaLight : alphaDark
  const grad = (cs) => `linear-gradient(90deg, ${cs.join(', ')})`
  const ink = light ? deepened(base, 0.42) : base
  return {
    light, ink,
    fill: grad(stops.map((c) => withAlpha(c, fillA))),
    outline: grad(stops.map((c) => withAlpha(c, selected || light ? 1 : 0.6))),
    inkFill: grad((stopsOf(profile) || [base, base]).map((c) => (light ? deepened(c, 0.42) : c))),
  }
}

/** One recent session: a pick mark, type icon + title, its language, and a square play button -
 *  outlined and washed in that language's colour (thicker and stronger once picked). */
function RecentSessionRow({ preset, profile, selected, onClick, onPlay }) {
  const c = sessionColors(profile, selected, selected ? 0.3 : 0.14, selected ? 0.2 : 0.08)
  return (
    <div class="recent-session" onClick={onClick}
      style={{ '--rs-fill': c.fill, '--rs-outline': c.outline, '--rs-w': selected ? '2px' : '1px' }}>
      <span class="pick" title="Use this session"><GradientIcon name={selected ? 'check_circle' : 'radio_button_unchecked'} size={24} ink={c.ink} brush={stopsOf(profile) && c.inkFill} /></span>
      <div class="grow" style="min-width:0">
        <div class="row" style="gap:6px"><TypeIcon type={preset.type} size={16} /><span class="ellipsis rs-title">{preset.title}</span></div>
        <div style="padding-top:4px"><LanguageChip profile={profile} filled={false} /></div>
      </div>
      <button class="square-btn" title="Start now" style={{ color: c.ink, background: withAlpha(c.ink, 0.16) }}
        onClick={(ev) => { ev.stopPropagation(); onPlay() }}><Icon name="play_arrow" size={22} /></button>
    </div>
  )
}

/** The picked recent session, at the top of When / How long, with a way back up to pick another. */
function SelectedSessionBanner({ preset, profile, onChange }) {
  const c = sessionColors(profile, true, 0.3, 0.2)
  return (
    <div class="recent-session banner" style={{ '--rs-fill': c.fill, '--rs-outline': c.outline, '--rs-w': '2px' }}>
      <GradientIcon name="check_circle" size={20} ink={c.ink} brush={stopsOf(profile) && c.inkFill} />
      <div class="grow" style="min-width:0;padding-left:12px">
        <div class="muted" style="font-size:11px;font-weight:500;letter-spacing:.5px">Selected session</div>
        <div class="row" style="gap:6px"><TypeIcon type={preset.type} size={16} /><span class="ellipsis rs-title" style="font-weight:600">{preset.title}</span></div>
        <div style="padding-top:4px"><LanguageChip profile={profile} filled={false} /></div>
      </div>
      <button class="btn text" onClick={onChange}>Change</button>
    </div>
  )
}

/** An icon painted with a gradient (the phone's GradientIcon) or a single colour. */
function GradientIcon({ name, size, ink, brush }) {
  if (!brush) return <Icon name={name} size={size} color={ink} />
  return <span style={{ width: size, height: size, flex: 'none', display: 'inline-block', background: brush,
    WebkitMask: `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>${ICONS[name]}</svg>`)}") center / contain no-repeat`,
    mask: `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>${ICONS[name]}</svg>`)}") center / contain no-repeat` }} />
}

/** Icon-only content-type toggle (the phone's ContentTypeIconButton). */
/** A session type in the form: its icon over its name, one of a row sharing the band's width
 *  (the phone's TypePill). */
function TypePill({ type, label, selected, onClick }) {
  return <button class={`type-pill ${selected ? 'on' : ''}`} aria-pressed={selected} onClick={onClick}><TypeIcon type={type} size={22} /><span>{label}</span></button>
}

/** Today, Yesterday, a chip for an older picked day, then a calendar button (the app's own
 *  DayPicker, with the days you've already logged marked). */
function DayChips({ today, selected, onSelect }) {
  const s = useStore()
  const [open, setOpen] = useState(false)
  const recent = [today, dayStart(addDays(today, -1))]
  const days = recent.includes(selected) ? recent : [...recent, selected]
  const label = (d) => (d === today ? 'Today' : d === recent[1] ? 'Yesterday' : new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }))
  const logged = useMemo(() => {
    const set = new Set()
    for (const e of s.entries) if (counts(e.contentType, e.languageProfileId)) set.add(dayStart(e.startTimeMillis))
    return set
  }, [s.entries, open])
  return (
    <div class="chips" style="align-items:center">
      {days.map((d) => <button key={d} class={`chip ${d === selected ? 'on' : ''}`} onClick={() => onSelect(d)}>{d === selected && <Icon name="check" size={18} />}{label(d)}</button>)}
      <button class="icon-btn" style="width:40px;height:40px" title="Pick a date" onClick={() => setOpen(true)}><Icon name="calendar_month" size={24} /></button>
      {open && <DayPicker selected={selected} today={today} logged={logged} onPick={(d) => { onSelect(d); setOpen(false) }} onClose={() => setOpen(false)} />}
    </div>
  )
}
