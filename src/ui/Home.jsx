import { useMemo, useState } from 'preact/hooks'
import {
  useStore, useNow, startManualEntry, stopRunningEntry, pauseRunningEntry, resumePaused, dismissPaused, deleteRunningEntry,
  editRunningElapsed, logCompletedManualEntry, upsertProfile, profileById, PODCAST, READING, ANKI, LISTENING,
} from '../store.js'
import { computeStreak, dailyTotalsFor, durationOf, goldenStreakDays, goldenTodayMillis, GOLDEN_DAYS, GOLDEN_DAILY_MILLIS, typeIcon, typeLabel } from '../model/rules.js'
import { dayStart, formatClock, formatHm, formatDate, addDays, HOUR } from '../model/time.js'
import { languageFill, withAlpha, gradientStops, deepened, isDarkFor, luminance } from '../model/theme.js'
import { Ring } from './Ring.jsx'
import { Dialog, Confirm, ColorPicker, DurationInput, hmToMillis, LanguageChip, Flame, toast } from './common.jsx'
import { EntryRow, EntryDetails, UncategorizedFolder } from './Entries.jsx'
import { FOIL_CHANCE_PERCENT } from '../model/zoo.js'

const RUNNING_ORDER = [PODCAST, READING, ANKI, LISTENING]

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

  const cards = s.profiles
    .filter((p) => (p.isAnki ? s.settings.showAnkiOnHome : p.podcastGoalMinutes > 0 || p.readingGoalMinutes > 0))
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const languages = s.profiles.filter((p) => !p.isAnki)
  const sorted = useMemo(() => [...s.entries].sort((a, b) => b.startTimeMillis - a.startTimeMillis), [s.entries])
  const recent = sorted.filter((e) => e.languageProfileId != null).slice(0, 5)
  const uncategorized = s.settings.logUncategorized ? sorted.filter((e) => e.languageProfileId == null) : []
  const activeProfile = running.map((e) => profileById(e.languageProfileId)).find((p) => p && !p.isAnki)

  return (
    <>
      {activeProfile && <div class="backdrop-wash" style={{ background: `linear-gradient(${withAlpha(activeProfile.colorHex, light ? 0.18 : 0.28)}, transparent)` }} />}
      <div class="home-head">
        <Title mode={s.settings.titleStyleMode} active={activeProfile} />
        <span class="version">web</span>
      </div>

      <div style="margin-top:12px">
        {running.map((e) => <NowTrackingBanner key={e.id} entry={e} now={now} />)}
        {Object.entries(s.paused).filter(([t]) => !running.some((e) => e.contentType === t)).map(([t, p]) => (
          <div class="banner" key={'p' + t}>
            <span style="font-size:18px">⏸</span>
            <div class="grow">
              <div style="font-weight:600">Paused · {typeLabel(t)}</div>
              <div class="muted small ellipsis">{[profileById(p.languageProfileId)?.name, p.title].filter(Boolean).join(' · ') || 'Manual session'}</div>
            </div>
            <button class="btn small" onClick={() => resumePaused(t)}>Resume</button>
            <button class="icon-btn" title="Dismiss" onClick={() => dismissPaused(t)}>✕</button>
          </div>
        ))}
        {!running.length && !Object.keys(s.paused).length && (
          <div class="banner clickable" onClick={() => setManual({})}>
            <span style="font-size:18px">▶</span>
            <div class="grow muted">Not tracking · tap to start a session</div>
          </div>
        )}
      </div>

      <div class="today-row">
        <h2>Today</h2>
        <button class={`momentum ${goldenDays >= GOLDEN_DAYS ? 'gold' : ''}`} onClick={() => setGolden(true)} title="Momentum">
          <Flame gold={goldenDays >= GOLDEN_DAYS} muted={goldenDays < GOLDEN_DAYS} /> {goldenDays}d
        </button>
        <span class="spacer" />
        <span class="today-total">Today: {formatHm(todayTotal)}</span>
      </div>

      {!languages.length ? (
        <div class="card center">
          <div style="font-size:34px">🌏</div>
          <h2 style="margin:8px 0 4px">Add your first language</h2>
          <p class="muted small" style="margin:0 0 14px">Pick a name, a colour and a daily goal - its rings show up here.</p>
          <button class="btn" onClick={() => nav('settings', { addLanguage: true })}>Add language</button>
        </div>
      ) : !cards.length ? (
        <div class="card muted small">No daily goals yet - set one on a language in Settings to get its rings here.</div>
      ) : (
        <div class="goal-grid">
          {cards.map((p) => <GoalCard key={p.id} profile={p} now={now} running={running} light={light} onOpen={() => setGoalCard(p.id)} onStart={(type) => setManual({ type, profileId: p.id })} />)}
        </div>
      )}

      {uncategorized.length > 0 && <div class="section"><UncategorizedFolder entries={uncategorized} now={now} onOpen={setDetails} /></div>}

      <div class="section">
        <div class="section-title"><h2>Recent</h2><button class="btn text small" onClick={() => nav('entries')}>See all</button></div>
        {recent.length ? (
          <div class="list">{recent.map((e) => <EntryRow key={e.id} entry={e} now={now} onClick={() => setDetails(e.id)} />)}</div>
        ) : (
          <div class="card muted small">Nothing tracked yet. Start a session with the button below and it'll show up here.</div>
        )}
      </div>

      <button class="fab" onClick={() => setManual({})}>＋ Add a session</button>

      {manual && <ManualSessionDialog initialType={manual.type} initialProfileId={manual.profileId} onClose={() => setManual(null)} />}
      {goalCard != null && profileById(goalCard) && <GoalEditDialog profile={profileById(goalCard)} onClose={() => setGoalCard(null)}
        onAdd={(type) => { setGoalCard(null); setManual({ type, profileId: goalCard }) }} onSettings={() => { setGoalCard(null); nav('settings', { language: goalCard }) }} />}
      {golden && <GoldenStreakDialog days={goldenDays} todayMillis={goldenToday} immersing={running.some((e) => e.contentType === PODCAST || e.contentType === READING)} onClose={() => setGolden(false)} />}
      {details != null && <EntryDetails id={details} onClose={() => setDetails(null)} />}
    </>
  )
}

function Title({ mode, active }) {
  if (mode === 'GRADIENT') return <h1 class="app-title gradient">Immersion Tracker</h1>
  if (mode === 'THEME_COLOR') return <h1 class="app-title" style="color:var(--primary)">Immersion Tracker</h1>
  if (mode === 'CURRENT_LANGUAGE' && active) {
    const stops = gradientStops(active)
    return stops && stops.length > 1
      ? <h1 class="app-title gradient" style={{ backgroundImage: `linear-gradient(90deg, ${stops.join(', ')})` }}>Immersion Tracker</h1>
      : <h1 class="app-title" style={{ color: active.colorHex }}>Immersion Tracker</h1>
  }
  return <h1 class="app-title">Immersion Tracker</h1>
}

function NowTrackingBanner({ entry, now }) {
  const profile = profileById(entry.languageProfileId)
  const [edit, setEdit] = useState(false)
  const [discard, setDiscard] = useState(false)
  const color = profile?.colorHex || '#888'
  return (
    <div class="banner" style={{ borderColor: withAlpha(color, 0.5), background: `linear-gradient(90deg, ${withAlpha(color, 0.22)}, var(--c-low))` }}>
      <span class="live-dot" />
      <div class="grow">
        <div style="font-weight:650" class="ellipsis">{[profile?.name || 'Uncategorized', typeLabel(entry.contentType), entry.mediaTitle].filter(Boolean).join(' · ')}</div>
        <button class="btn text small" style="padding:0;min-height:0;height:auto" onClick={() => setEdit(true)}>
          <span class="timer">{formatClock(durationOf(entry, now))}</span><span class="muted small" style="margin-left:8px">Manual · tap to edit time</span>
        </button>
      </div>
      <button class="icon-btn filled" title="Pause" onClick={() => pauseRunningEntry(entry.contentType)}>⏸</button>
      <button class="icon-btn filled" title="Stop" onClick={() => { stopRunningEntry(entry.contentType); toast(`${formatHm(durationOf(entry))} saved`) }}>⏹</button>
      <button class="icon-btn" title="Discard this session without counting its time" onClick={() => setDiscard(true)}>✕</button>
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

function goalCardStyle(profile, mode, light) {
  if (mode === 'GREY_TINT' || profile.isAnki && mode === 'GREY_TINT') return { background: 'var(--c-high)' }
  const stops = gradientStops(profile) || [profile.colorHex]
  const a = light ? 0.16 : 0.34, b = light ? 0.07 : 0.12
  const bg = stops.length > 1
    ? `linear-gradient(135deg, ${stops.map((c, i) => withAlpha(c, i === 0 ? a : b)).join(', ')}), var(--surface)`
    : `linear-gradient(135deg, ${withAlpha(profile.colorHex, a)}, ${withAlpha(profile.colorHex, b)}), var(--surface)`
  return { background: bg, borderColor: withAlpha(profile.colorHex, light ? 0.45 : 0.35) }
}

function GoalCard({ profile, now, running, light, onOpen, onStart }) {
  const s = useStore()
  const nameColor = light ? deepened(profile.colorHex, 0.42) : '#fff'
  const todayStart = dayStart(now)
  const todayOf = (type) => s.entries.reduce((t, e) => (e.languageProfileId === profile.id && e.contentType === type && e.startTimeMillis >= todayStart ? t + durationOf(e, now) : t), 0)
  const isActive = (type) => running.some((e) => e.languageProfileId === profile.id && e.contentType === type)
  const stops = gradientStops(profile)
  const ringColor = profile.colorHex
  const iconColor = light ? '#000' : '#fff'

  if (profile.isAnki) {
    const today = todayOf(ANKI)
    return (
      <div class="goal-card" style={goalCardStyle(profile, s.settings.goalCardStyleMode, light)}>
        <div class="row"><span class="name grow" style={{ color: nameColor }}>Anki</span></div>
        <div class="rings">
          <button class="ring-stat" onClick={() => onStart(ANKI)}>
            <Ring progress={0} color={ringColor} ringStyle={s.settings.ringStyle} icon={<span style={{ color: iconColor }}>🗂️</span>} active={isActive(ANKI)} light={light} />
            <span class="val">{formatHm(today)}</span>
            <span class="lbl">Today · no goal</span>
          </button>
        </div>
      </div>
    )
  }

  const rings = [[PODCAST, profile.podcastGoalMinutes, 'Listening'], [READING, profile.readingGoalMinutes, 'Reading']].filter(([, g]) => g > 0)
  return (
    <div class="goal-card" style={goalCardStyle(profile, s.settings.goalCardStyleMode, light)}>
      <div class="row">
        <span class="name grow ellipsis clickable" style={{ color: nameColor }} onClick={onOpen}>{profile.name}</span>
        <button class="icon-btn" title={`${profile.name} goals`} onClick={onOpen} style={{ color: nameColor }}>⋯</button>
      </div>
      <div class="rings">
        {rings.map(([type, goal, label]) => {
          const ms = todayOf(type)
          const goalMs = goal * 60000
          const streak = computeStreak(dailyTotalsFor(s.entries, profile.id, type, now), goalMs, now)
          return (
            <button key={type} class="ring-stat" onClick={() => onStart(type)} title={`Add ${label.toLowerCase()}`}>
              <Ring progress={ms / goalMs} color={ringColor} stops={stops} ringStyle={s.settings.ringStyle} icon={<span style={{ color: iconColor }}>{typeIcon(type)}</span>} active={isActive(type)} light={light} />
              <span class="val">{formatHm(ms)} / {formatHm(goalMs)}</span>
              <span class="lbl row" style="gap:6px">{label}
                {streak.current > 0 && <span class="streak"><Flame />{streak.current}</span>}
                {streak.record > 0 && <span class="streak muted" title="Personal best streak">🏆{streak.record}</span>}
              </span>
            </button>
          )
        })}
      </div>
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
          <button class="btn tonal grow" onClick={() => onAdd(PODCAST)}>🎧 Add listening</button>
          <button class="btn tonal grow" onClick={() => onAdd(READING)}>📖 Add reading</button>
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
                  <span>{typeIcon(p.type)}</span>
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
            {[[PODCAST, '🎧 Listening'], [READING, '📖 Reading'], [ANKI, '🗂️ Anki']].map(([t, l]) => (
              <button key={t} class={`chip ${type === t ? 'on' : ''}`} onClick={() => setType(t)}>{l}</button>
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
