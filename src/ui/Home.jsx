import { useMemo, useState } from 'preact/hooks'
import {
  useStore, useNow, startManualEntry, stopRunningEntry, deleteRunningEntry,
  editRunningElapsed, logCompletedManualEntry, upsertProfile, profileById, PODCAST, READING, ANKI, LISTENING,
} from '../store.js'
import { computeStreak, dailyTotalsFor, durationOf, goldenStreakDays, goldenTodayMillis, GOLDEN_DAYS, GOLDEN_DAILY_MILLIS, typeLabel } from '../model/rules.js'
import { dayStart, formatClock, formatHm, formatDate, addDays, HOUR } from '../model/time.js'
import { languageFill, withAlpha, gradientStops, deepened, isDarkFor, luminance, dimColor } from '../model/theme.js'
import { Ring } from './Ring.jsx'
import { Dialog, Confirm, ColorPicker, DurationInput, hmToMillis, LanguageChip, Flame, Icon, TypeIcon, TypeLabel, StreakBadge, MomentumPill, toast } from './common.jsx'
import { EntryRow, EntryDetails, UncategorizedFolder } from './Entries.jsx'
import { FOIL_CHANCE_PERCENT } from '../model/zoo.js'

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
          <div class="version">web 🌐</div>
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
          <h2 style="margin-bottom:4px">Add your first language</h2>
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
            <Ring size={64} progress={ms / goalMs} color={profile.colorHex} stops={stops} ringStyle={s.settings.ringStyle} icon={<TypeIcon type={type} size={22} color={iconColor} />} active={isActive(type)} light={light} />
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
      <p class="muted small" style="margin:14px 0 4px">2+ hours a day, {GOLDEN_DAYS} days in a row → gold. Every language counts together; music and Anki don't.</p>
      <p class="muted small" style="margin:0">Gold = {FOIL_CHANCE_PERCENT}% foil chance on eggs earned.</p>
    </Dialog>
  )
}

/** "Add a session": copy a recent one, or pick type/language/title, then either log a length that
 *  already happened or (blank length) start a live timer. */
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
  const [showAll, setShowAll] = useState(false)
  const today = dayStart(Date.now())
  const yesterday = dayStart(addDays(Date.now(), -1))
  const millis = hmToMillis(h, m)
  const isPast = day < today

  const presets = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const e of [...s.entries].sort((a, b) => b.startTimeMillis - a.startTimeMillis)) {
      if (!e.isManual) continue
      const key = `${e.mediaTitle}|${e.contentType}|${e.languageProfileId}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ title: e.mediaTitle, type: e.contentType, profileId: e.languageProfileId })
      if (out.length >= 8) break
    }
    return out
  }, [s.entries])

  const langFor = (t) => (t === ANKI ? anki?.id ?? null : profileId)
  const canSubmit = (type === ANKI || profileId != null || allowUncategorized) && (!isPast || millis > 0)
  const submit = () => {
    if (!canSubmit) return
    if (millis > 0) {
      logCompletedManualEntry(type, langFor(type), title.trim(), millis, day)
      toast(`${formatHm(millis)} logged`)
    } else {
      startManualEntry(type, langFor(type), title.trim())
    }
    onClose()
  }
  const usePreset = (p) => {
    setPicked(p)
    setType(p.type)
    if (p.type !== ANKI) setProfileId(p.profileId)
    setTitle(p.title)
  }

  return (
    <Dialog title="Add a session" onClose={onClose} actions={<>
      <button class="btn text" onClick={onClose}>Cancel</button>
      <button class="btn" disabled={!canSubmit} onClick={submit}>{millis > 0 ? 'Save' : 'Start'}</button>
    </>}>
      <div class="col" style="gap:16px">
        {presets.length > 0 && !picked && (
          <div class="col" style="gap:6px">
            <div style="font-weight:600">Recent sessions</div>
            <div class="muted small">Tap a session to copy it into the form below, or ▶ to start it right away.</div>
            {(showAll ? presets : presets.slice(0, 3)).map((p, i) => {
              const prof = p.type === ANKI ? anki : profileById(p.profileId)
              return (
                <div key={i} class="entry" onClick={() => usePreset(p)} style={{ borderColor: prof ? withAlpha(prof.colorHex, 0.5) : undefined, background: prof ? withAlpha(prof.colorHex, 0.12) : undefined }}>
                  <TypeIcon type={p.type} size={20} color={prof?.colorHex} />
                  <div class="grow">
                    <div class="title ellipsis">{p.title || `Manual ${typeLabel(p.type).toLowerCase()} session`}</div>
                    {p.type !== ANKI && <LanguageChip profile={prof} />}
                  </div>
                  <button class="icon-btn filled" title="Start now" onClick={(ev) => { ev.stopPropagation(); startManualEntry(p.type, p.type === ANKI ? anki?.id : p.profileId, p.title); onClose() }}>▶</button>
                </div>
              )
            })}
            {presets.length > 3 && <button class="btn text small" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show less' : `Show ${presets.length - 3} more`}</button>}
          </div>
        )}
        {picked && (
          <div class="notice row">
            <span class="grow">Selected session: <b>{picked.title || typeLabel(picked.type)}</b></span>
            <button class="btn text small" onClick={() => setPicked(null)}>Change</button>
          </div>
        )}
        <div class="col">
          <div style="font-weight:600">Type</div>
          <div class="chips">
            {[[PODCAST, 'Listening'], [READING, 'Reading'], [ANKI, 'Anki']].map(([t, l]) => (
              <button key={t} class={`chip ${type === t ? 'on' : ''}`} onClick={() => setType(t)}><TypeIcon type={t} size={16} />{l}</button>
            ))}
          </div>
        </div>
        {type !== ANKI && (
          <div class="col">
            <div style="font-weight:600">Language</div>
            <div class="chips">
              {languages.map((p) => {
                const on = profileId === p.id
                return (
                  <button key={p.id} class="chip" onClick={() => setProfileId(p.id)}
                    style={on ? { background: languageFill(p), color: luminance(p.colorHex) > 0.45 ? '#111' : '#fff', borderColor: 'transparent' } : { borderColor: withAlpha(p.colorHex, 0.7) }}>
                    {p.name}
                  </button>
                )
              })}
              {allowUncategorized && <button class={`chip ${profileId == null ? 'on' : ''}`} onClick={() => setProfileId(null)}>Uncategorized</button>}
            </div>
          </div>
        )}
        <label class="field">Title (optional)<input class="input" value={title} onInput={(e) => setTitle(e.currentTarget.value)} placeholder="What are you reading or watching?" onKeyDown={(e) => e.key === 'Enter' && submit()} /></label>
        <div class="col">
          <div style="font-weight:600">When</div>
          <div class="chips">
            <button class={`chip ${day === today ? 'on' : ''}`} onClick={() => setDay(today)}>Today</button>
            <button class={`chip ${day === yesterday ? 'on' : ''}`} onClick={() => setDay(yesterday)}>Yesterday</button>
            <label class={`chip ${day < yesterday ? 'on' : ''}`} style="position:relative">
              {day < yesterday ? formatDate(day) : '📅 Other day'}
              <input type="date" style="position:absolute;inset:0;opacity:0" max={new Date(today).toISOString().slice(0, 10)}
                onChange={(e) => { const [y, mo, d] = e.currentTarget.value.split('-').map(Number); if (y) setDay(new Date(y, mo - 1, d).getTime()) }} />
            </label>
          </div>
        </div>
        <div class="col">
          <div style="font-weight:600">How long</div>
          <DurationInput hours={h} minutes={m} onHours={setH} onMinutes={setM} />
          <div class={`small ${isPast && millis <= 0 ? 'err' : 'muted'}`}>
            {isPast && millis <= 0 ? 'Enter how long to log a past day' : millis > 0 ? `= ${formatHm(millis)}` : 'Leave blank to start a live timer instead'}
          </div>
        </div>
      </div>
    </Dialog>
  )
}
