import { useMemo, useRef, useState } from 'preact/hooks'
import {
  useStore, useNow, getState, startManualEntry, stopRunningEntry, deleteRunningEntry,
  editRunningElapsed, logCompletedManualEntry, upsertProfile, profileById, PODCAST, READING, ANKI, LISTENING,
} from '../store.js'
import { counts, computeStreak, dailyTotalsFor, durationOf, goldenStreakDays, goldenTodayMillis, GOLDEN_DAYS, GOLDEN_DAILY_MILLIS, typeLabel } from '../model/rules.js'
import { dayStart, formatClock, formatHm, formatDate, addDays, HOUR } from '../model/time.js'
import { languageFill, withAlpha, gradientStops, deepened, isDarkFor, luminance, dimColor } from '../model/theme.js'
import { Ring } from './Ring.jsx'
import { Dialog, Confirm, ColorPicker, DurationInput, hmToMillis, LanguageChip, Flame, Icon, TypeIcon, TypeLabel, LanguageFilterChip, StreakBadge, MomentumPill, DayPicker, toast } from './common.jsx'
import { EntryRow, EntryDetails, UncategorizedFolder } from './Entries.jsx'
import { FOIL_CHANCE_PERCENT } from '../model/zoo.js'
import { ICONS } from './icons.js'

const RUNNING_ORDER = [LISTENING, PODCAST, READING, ANKI]

/** Home, laid out like the phone's: title and today's total, what's being tracked (or a dashed
 *  "not tracking" box), Today with Momentum, the goal cards, then Recent. */
export function Home({ nav }) {
  const s = useStore()
  const now = useNow(1000)
  const [manual, setManual] = useState(null) // {type, profileId}
  const [goalCard, setGoalCard] = useState(null)
  const [golden, setGolden] = useState(false)
  const [details, setDetails] = useState(null)
  const light = !isDarkFor(s.settings.uiColorPreset)

  const running = RUNNING_ORDER.map((t) => s.entries.find((e) => e.endTimeMillis == null && e.contentType === t)).filter(Boolean)
  const todayStart = dayStart(now)
  const todayTotal = s.entries.reduce((t, e) => {
    if (e.startTimeMillis < todayStart || e.languageProfileId == null) return t
    if (e.contentType === LISTENING || e.contentType === ANKI) return t
    return t + durationOf(e, now)
  }, 0)
  const goldenDays = useMemo(() => goldenStreakDays(s.entries, now), [s.entries, Math.floor(now / 60000)])
  const goldenToday = goldenTodayMillis(s.entries, now)
  const immersing = running.some((e) => (e.contentType === PODCAST || e.contentType === READING) && e.languageProfileId != null)

  const cards = s.profiles
    .filter((p) => (p.isAnki ? s.settings.showAnkiOnHome : p.podcastGoalMinutes > 0 || p.readingGoalMinutes > 0))
    .sort((a, b) => a.sortOrder - b.sortOrder)
  // An odd number of cards: one goes full width - the main language, at the top.
  const oddOne = cards.length % 2 === 1 ? cards.find((p) => p.isMain) || cards[cards.length - 1] : null
  const grid = cards.filter((p) => p !== oddOne)
  const oddLeads = oddOne && (oddOne.isMain || !grid.length)
  const columns = [[], []]
  const weights = [0, 0]
  for (const p of grid) {
    const w = (p.podcastGoalMinutes > 0) + (p.readingGoalMinutes > 0)
    const i = weights[0] <= weights[1] ? 0 : 1
    columns[i].push(p)
    weights[i] += w
  }
  const languages = s.profiles.filter((p) => !p.isAnki)
  const sorted = useMemo(() => [...s.entries].sort((a, b) => b.startTimeMillis - a.startTimeMillis), [s.entries])
  const recent = sorted.filter((e) => e.languageProfileId != null).slice(0, 5)
  const uncategorized = s.settings.logUncategorized ? sorted.filter((e) => e.languageProfileId == null) : []
  const activeProfile = running.map((e) => profileById(e.languageProfileId)).find((p) => p && !p.isAnki)
  const card = (p, wide) => <GoalCard key={p.id} profile={p} now={now} running={running} light={light} wide={wide} onOpen={() => setGoalCard(p.id)} />

  return (
    <>
      {activeProfile && <div class="backdrop-wash" style={{ background: `linear-gradient(${withAlpha(activeProfile.colorHex, light ? 0.18 : 0.28)}, transparent)` }} />}
      <div class="home-head">
        <div class="title-col">
          <Title mode={s.settings.titleStyleMode} active={activeProfile} light={light} />
          <div class="version">web ⚡</div>
        </div>
        <div class="side">
          <button class="icon-btn" title="Start a manual session" onClick={() => setManual({})}><Icon name="add" /></button>
          <div class="today-total">Today: {formatHm(todayTotal)}</div>
        </div>
      </div>

      {running.length
        ? running.map((e) => <NowTrackingBanner key={e.id} entry={e} now={now} light={light} mode={s.settings.goalCardStyleMode} />)
        : <div class="idle-banner" role="button" onClick={() => setManual({})}>Not tracking · tap to start a session</div>}

      <div class="today-row">
        <h2>Today</h2>
        <MomentumPill days={goldenDays} progress={goldenToday / GOLDEN_DAILY_MILLIS} onClick={() => setGolden(true)} />
        <button class="icon-btn" title="Entries" onClick={() => nav('entries', { tab: 'entries' })}><Icon name="list" /></button>
      </div>

      {!languages.length ? (
        <div class="card center" style="margin-top:8px">
          <h2 style="margin-bottom:4px">Add a language you're studying</h2>
          <p class="muted" style="margin:0 0 14px">Pick a name, a colour and a daily goal - its rings show up here.</p>
          <button class="btn" onClick={() => nav('settings', { addLanguage: true })}>Add language</button>
        </div>
      ) : (
        <>
          {oddOne && oddLeads && card(oddOne, true)}
          {grid.length > 0 && <div class="goal-cols">{columns.map((col, i) => <div key={i}>{col.map((p) => card(p, false))}</div>)}</div>}
          {oddOne && !oddLeads && card(oddOne, true)}
        </>
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
  return <h1 class="app-title">Immersion Tracker</h1>
}

/** The phone's NowTrackingBanner: the language's colour taken down to a background, its outline,
 *  "Listening · Japanese · 12:34" in the language colour, the title, and stop / discard. */
function NowTrackingBanner({ entry, now, light, mode }) {
  const profile = profileById(entry.languageProfileId)
  const [edit, setEdit] = useState(false)
  const [discard, setDiscard] = useState(false)
  const color = profile?.colorHex || '#6FA8C9'
  const grey = mode === 'GREY_TINT'
  const stops = !grey && gradientStops(profile)
  const bg = grey ? 'var(--surface)' : stops && stops.length > 1
    ? `linear-gradient(90deg, ${stops.map((c) => dimColor(c, 0.9, 0.32, light)).join(', ')})`
    : dimColor(color, 0.9, 0.32, light)
  const ink = light ? deepened(color, 0.42) : color
  return (
    <div class="now-banner" style={{ background: bg, borderColor: grey ? 'var(--block-line)' : withAlpha(color, 0.6) }} onClick={() => setEdit(true)}>
      <span class="dot8" style={{ background: profile ? languageFill(profile, 135) : color }} />
      <div class="grow">
        <div class="label-large" style={{ color: ink }}>{typeLabel(entry.contentType)} · {profile?.name || 'Uncategorized'} · {formatClock(durationOf(entry, now))}</div>
        {entry.mediaTitle && <div class="small ellipsis">{entry.mediaTitle}</div>}
        <div class="small" style={{ color: withAlpha(ink.startsWith('#') ? ink : '#888888', 0.7) }}>Manual · tap to edit time</div>
      </div>
      <button class="stop" style={{ color: ink }} title="Stop" onClick={(ev) => { ev.stopPropagation(); stopRunningEntry(entry.contentType); toast(`${formatHm(durationOf(entry))} saved`) }}><span /></button>
      <button class="stop" style={{ color: ink }} title="Discard this session without counting its time" onClick={(ev) => { ev.stopPropagation(); setDiscard(true) }}><Icon name="close" size={18} /></button>
      {edit && <EditElapsedDialog entry={entry} onClose={() => setEdit(false)} />}
      {discard && <Confirm title="Discard this session?" text={`This ${typeLabel(entry.contentType).toLowerCase()} session won't be counted toward any goal.`} confirmLabel="Discard" danger onConfirm={() => deleteRunningEntry(entry.contentType)} onClose={() => setDiscard(false)} />}
    </div>
  )
}

function EditElapsedDialog({ entry, onClose }) {
  const ms = durationOf(entry)
  const [h, setH] = useState(String(Math.floor(ms / HOUR)))
  const [m, setM] = useState(String(Math.floor((ms % HOUR) / 60000)))
  return (
    <Dialog title="Edit elapsed time" onClose={onClose} sheet={false} actions={<>
      <button class="btn text" onClick={onClose}>Cancel</button>
      <button class="btn" onClick={() => { editRunningElapsed(entry.contentType, hmToMillis(h, m)); onClose() }}>Save</button>
    </>}>
      <DurationInput hours={h} minutes={m} onHours={setH} onMinutes={setM} autoFocus />
    </Dialog>
  )
}

/** A goal card as on the phone: the language's colour taken down to a dark (or, on light themes,
 *  pale) card, brighter with an outline while something in it is being tracked; its name in the
 *  language colour; one ring per goal. [wide] puts the rings beside the name. */
function GoalCard({ profile, now, running, light, wide, onOpen }) {
  const s = useStore()
  const todayStart = dayStart(now)
  const todayOf = (type) => s.entries.reduce((t, e) => (e.languageProfileId === profile.id && e.contentType === type && e.startTimeMillis >= todayStart ? t + durationOf(e, now) : t), 0)
  const isActive = (type) => running.some((e) => e.languageProfileId === profile.id && e.contentType === type)
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
  const rings = profile.isAnki
    ? [[ANKI, 0]]
    : [[PODCAST, profile.podcastGoalMinutes], [READING, profile.readingGoalMinutes]].filter(([, g]) => g > 0)
  return (
    <div class={`goal-card ${wide ? 'wide' : ''}`} style={{ background: bg, borderColor: outline }} onClick={onOpen} role="button">
      <div class="name" style={nameStyle}>{profile.name}</div>
      {rings.map(([type, goal]) => {
        const ms = todayOf(type)
        if (!goal) {
          return (
            <div key={type} class="ring-stat">
              <div style="width:64px;height:64px;display:grid;place-items:center"><TypeIcon type={type} size={40} color={profile.colorHex} style={active ? { animation: 'pulse-a .9s ease-in-out infinite alternate' } : undefined} /></div>
              <span class="val">{formatHm(ms)}</span>
            </div>
          )
        }
        const goalMs = goal * 60000
        return (
          <div key={type} class="ring-stat">
            <Ring size={64} progress={ms / goalMs} color={profile.colorHex} stops={stops} ringStyle={s.settings.ringStyle} iconType={type} iconColor={iconColor} active={isActive(type)} light={light} />
            <span class="val">{formatHm(ms)} / {formatHm(goalMs, true)}</span>
            <StreakBadge streak={computeStreak(dailyTotalsFor(s.entries, profile.id, type, now), goalMs, now)} />
          </div>
        )
      })}
    </div>
  )
}

function GoalEditDialog({ profile, onClose, onAdd, onSettings }) {
  const [listen, setListen] = useState(String(profile.podcastGoalMinutes))
  const [read, setRead] = useState(String(profile.readingGoalMinutes))
  const [color, setColor] = useState({ colorHex: profile.colorHex, gradientColors: profile.gradientColors })
  const save = () => {
    upsertProfile({ ...profile, podcastGoalMinutes: Number(listen) || 0, readingGoalMinutes: Number(read) || 0, ...color })
    onClose()
  }
  return (
    <Dialog title={`${profile.name} goals`} onClose={onClose} actions={<>
      <button class="btn text" onClick={onSettings}>Language settings</button>
      <span class="spacer" />
      <button class="btn text" onClick={onClose}>Cancel</button>
      <button class="btn" onClick={save}>Save</button>
    </>}>
      <div class="col" style="gap:14px">
        <div class="row">
          <button class="btn tonal grow" onClick={() => onAdd(PODCAST)}><TypeLabel type={PODCAST}>Add listening</TypeLabel></button>
          <button class="btn tonal grow" onClick={() => onAdd(READING)}><TypeLabel type={READING}>Add reading</TypeLabel></button>
        </div>
        <div class="row">
          <label class="field grow">Listening (minutes)<input class="input" inputMode="numeric" value={listen} onInput={(e) => setListen(e.currentTarget.value.replace(/\D/g, ''))} /></label>
          <label class="field grow">Reading (minutes)<input class="input" inputMode="numeric" value={read} onInput={(e) => setRead(e.currentTarget.value.replace(/\D/g, ''))} /></label>
        </div>
        <div class="muted small">Set either to 0 to hide that ring.</div>
        <div style="font-weight:600">Ring color</div>
        <ColorPicker colorHex={color.colorHex} gradientColors={color.gradientColors} onChange={(c, g) => setColor({ colorHex: c, gradientColors: g })} />
      </div>
    </Dialog>
  )
}

function GoldenStreakDialog({ days, todayMillis, immersing, onClose }) {
  const gold = days >= GOLDEN_DAYS
  const pct = Math.min(1, todayMillis / GOLDEN_DAILY_MILLIS)
  return (
    <Dialog title={`Momentum · ${days}d`} onClose={onClose} sheet={false} actions={<button class="btn" onClick={onClose}>OK</button>}>
      <div class="center" style="font-size:54px;margin:4px 0 10px"><Flame gold={gold} muted={!gold} /></div>
      <p style="margin:0 0 12px;font-weight:650;text-align:center">
        {gold ? 'Your flame is gold' : `${GOLDEN_DAYS - Math.min(days, GOLDEN_DAYS)} more day${GOLDEN_DAYS - days === 1 ? '' : 's'} to gold`}
      </p>
      <div class="small muted" style="margin-bottom:6px">Today: {formatHm(todayMillis)} of {formatHm(GOLDEN_DAILY_MILLIS)}{immersing ? ' · counting now' : ''}</div>
      <div class="progress" style="height:12px"><div style={{ width: `${pct * 100}%`, background: 'linear-gradient(90deg, #c99a2e, #ffd76a)' }} /></div>
      <p class="muted small" style="margin:14px 0 4px">1+ hour a day, {GOLDEN_DAYS} days in a row → gold. Every language counts together; music and Anki don't.</p>
      <p class="muted small" style="margin:0">Gold = {FOIL_CHANCE_PERCENT}% foil chance on eggs earned.</p>
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
  const anki = s.profiles.find((p) => p.isAnki)
  const languages = s.profiles.filter((p) => !p.isAnki).sort((a, b) => a.sortOrder - b.sortOrder)
  const allowUncategorized = s.settings.logUncategorized
  const [type, setType] = useState(initialProfileId != null && initialProfileId === anki?.id ? ANKI : initialType || PODCAST)
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
  const presets = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const e of [...s.entries].sort((a, b) => b.startTimeMillis - a.startTimeMillis)) {
      if (!e.isManual) continue
      const key = `${e.mediaTitle}|${e.contentType}|${e.languageProfileId}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ key, title: e.mediaTitle, type: e.contentType, profileId: e.languageProfileId })
      if (out.length >= MAX_RECENT_MANUAL_SESSIONS) break
    }
    return out
  }, [s.entries])

  const langFor = (t) => (t === ANKI ? anki?.id ?? null : profileId)
  const canSubmit = millis > 0 || !isPast
  const submit = () => {
    if (!canSubmit) return
    const name = s.profiles.find((p) => p.id === profileId)?.name ?? 'Uncategorized'
    const t = title.trim() || `Manual ${name} session`
    if (millis > 0) {
      logCompletedManualEntry(type, langFor(type), t, millis, day)
      toast(`${formatHm(millis)} logged`)
    } else {
      startManualEntry(type, langFor(type), t)
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
    <Dialog title="Add a session" sheet={false} onClose={onClose} actions={<>
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
                  onPlay={() => { startManualEntry(p.type, p.profileId, p.title); onClose() }} />
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
          <div class="type-lang-row">
            <TypeButton type={PODCAST} label="Listening" selected={type === PODCAST} onClick={() => pickType(PODCAST)} />
            <TypeButton type={READING} label="Reading" selected={type === READING} onClick={() => pickType(READING)} />
            {anki && <TypeButton type={ANKI} label="Anki" selected={type === ANKI} onClick={() => pickType(ANKI)} />}
            {type !== ANKI && <span class="vdivider" />}
            {type !== ANKI && languages.map((p) => (
              <LanguageFilterChip key={p.id} profile={p} selected={profileId === p.id} onClick={() => pickLang(p.id)} />
            ))}
            {type !== ANKI && (allowUncategorized || languages.length === 0) && (
              <button class={`chip ${profileId == null ? 'on' : ''}`} onClick={() => pickLang(null)}>{profileId == null && <Icon name="check" size={18} />}Uncategorized</button>
            )}
          </div>
          <label class="field">Title (optional)<input class="input" value={title} onInput={(e) => { setTitle(e.currentTarget.value); setPicked(null) }} onKeyDown={(e) => e.key === 'Enter' && submit()} /></label>
        </div>
        <div class="section-band secondary">
          {picked && <SelectedSessionBanner preset={picked} profile={profileById(picked.profileId)} onChange={() => scrollTo(false)} />}
          <div class="label-large">When</div>
          <DayChips today={today} selected={day} onSelect={setDay} />
          <div class="label-large" style="padding-top:8px">How long</div>
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
    </Dialog>
  )
}

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
function TypeButton({ type, label, selected, onClick }) {
  return <button class={`type-btn ${selected ? 'on' : ''}`} title={label} aria-label={label} aria-pressed={selected} onClick={onClick}><TypeIcon type={type} size={22} /></button>
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
