import { useEffect, useMemo, useState } from 'preact/hooks'
import { useStore, useNow, update, getState } from '../store.js'
import {
  sync, createEvent, joinByCode, leaveEvent, endEvent, editEvent, deleteEventForEveryone, deleteCompleted, visibleEvents, raceOutlook,
  raceStatus, onRaceStatus, errorText, ordinal, localTodayKey, refreshFriends, addFriendByCode, addFriendById, respondFriend, removeFriend,
  readProfile, buildProfileBody, raceConfigured, DEFAULT_RACE_URL,
} from '../model/race.js'
import { HOUR, DAY, formatHm, formatDate, formatDateTime, formatYmd, agoText, ymdToEpochDay, epochDayToYmd, ymdOf } from '../model/time.js'
import { withAlpha, languageFill, LANGUAGE_COLORS_BRIGHT, GRADIENTS, PRESETS, presetLabel, schemeFor, dimColor, deepened, isDarkFor } from '../model/theme.js'
import { Dialog, Confirm, Seg, Switch, SettingRow, toast, copyText, share, Spinner, Flame, TypeIcon, TypeLabel, Icon, StreakBadge, MomentumPill } from './common.jsx'
import { Ring } from './Ring.jsx'
import { useCatalog, AnimalPhoto, AnimalCardView, RarityBadge } from './Zoo.jsx'
import { RARITY_COLOR } from '../model/zoo.js'

const EMOJIS = ['🦊', '🐼', '🐯', '🦁', '🐸', '🐙', '🦉', '🐧', '🐢', '🦄', '🐝', '🦋', '🐳', '🦖', '🐲', '🌸', '⭐', '🔥', '⚡', '🍀', '🍣', '☕', '🎧', '📚']
const BAR_PALETTES = {
  theme: ['var(--primary)', 'var(--tertiary)', 'var(--secondary)'],
  aurora: ['#00C9FF', '#7B2FF7', '#F72585'],
  ocean: ['#0EA5E9', '#48C9B0', '#818CF8'],
  sunset: ['#FF512F', '#F6D365', '#DD2476'],
  forest: ['#389466', '#9BE15D', '#2C9696'],
  neon: ['#CCFF00', '#00F2FE', '#FF5ACD'],
  royal: ['#4568DC', '#F7B733', '#9D4EDD'],
}
const AUTO_LINE = ['#4FA3FF', '#FF7A59', '#3DDC84', '#C084FC', '#FFD43B', '#FF5ACD', '#2DD4BF', '#F97316']

function useRaceStatus() {
  const [, setV] = useState(0)
  useEffect(() => onRaceStatus(() => setV((v) => v + 1)), [])
  return raceStatus
}

export function Social() {
  const s = useStore()
  const [tab, setTab] = useState('race')
  const [setup, setSetup] = useState(false)
  if (!raceConfigured() || setup) return <RaceSetup onDone={() => setSetup(false)} first={!raceConfigured()} />
  return (
    <>
      <h1 class="page-title">Social</h1>
      <Seg options={[['race', 'Race'], ['friends', 'Friends']]} value={tab} onChange={setTab} />
      <div style="margin-top:12px">{tab === 'race' ? <Race onEditName={() => setSetup(true)} /> : <Friends />}</div>
    </>
  )
}

function RaceSetup({ onDone, first }) {
  const s = useStore()
  const [name, setName] = useState(s.race.name)
  const [emoji, setEmoji] = useState(s.race.emoji)
  const [url, setUrl] = useState(s.race.serverUrl)
  const save = () => {
    if (!name.trim()) return
    update((st) => { st.race.name = name.trim().slice(0, 40); st.race.emoji = emoji.trim(); st.race.serverUrl = url.trim() === DEFAULT_RACE_URL ? '' : url.trim() })
    onDone()
    sync()
  }
  return (
    <div class="card col" style="gap:14px;margin-top:8px">
      <h2>{first ? 'Join the race' : 'Name & emoji'}</h2>
      <p class="muted small" style="margin:0">Pick the name your friends will see. Races and friends work with everyone on the Immersion Tracker server - Android and web alike.</p>
      <label class="field">Your name<input class="input" value={name} maxLength={40} onInput={(e) => setName(e.currentTarget.value)} autoFocus /></label>
      <div class="col">
        <div style="font-weight:600">Your emoji</div>
        <div class="muted small">Shown next to your name and on the progress chart, for everyone in your races. Optional.</div>
        <div class="swatches">{EMOJIS.map((e) => <button key={e} class={`swatch ${emoji === e ? 'on' : ''}`} style="background:var(--c-high);font-size:18px" onClick={() => setEmoji(emoji === e ? '' : e)}>{e}</button>)}</div>
        <input class="input" style="max-width:200px" placeholder="Or type any emoji" value={EMOJIS.includes(emoji) ? '' : emoji} onInput={(e) => setEmoji([...e.currentTarget.value].slice(0, 2).join(''))} />
      </div>
      <details><summary class="muted small clickable">Race server link</summary>
        <input class="input" style="margin-top:8px" placeholder={DEFAULT_RACE_URL} value={url} onInput={(e) => setUrl(e.currentTarget.value)} />
        <div class="muted tiny" style="margin-top:4px">Leave blank for the built-in server. Everyone racing together needs the same one.</div>
      </details>
      <div class="row"><span class="spacer" />{!first && <button class="btn text" onClick={onDone}>Cancel</button>}<button class="btn" disabled={!name.trim()} onClick={save}>Save</button></div>
    </div>
  )
}

/* ------------------------------------------------------------------------------------------------
 * Race
 * --------------------------------------------------------------------------------------------- */

function Race({ onEditName }) {
  const s = useStore()
  const [addMenu, setAddMenu] = useState(false)
  const [emptyMenu, setEmptyMenu] = useState(false)
  const status = useRaceStatus()
  const now = useNow(30000)
  const [create, setCreate] = useState(false)
  const [join, setJoin] = useState(false)
  const [settings, setSettings] = useState(false)
  const [showDone, setShowDone] = useState(false)
  useEffect(() => {
    sync()
    const t = setInterval(() => document.visibilityState === 'visible' && sync(), 60000)
    return () => clearInterval(t)
  }, [])
  const { running, done } = visibleEvents(s, now)
  const activityText = { REFRESHING: 'Updating standings…', JOINING: 'Joining race…', SENDING_FINAL: 'Sending your final total…', CREATING: 'Creating race…', LEAVING: 'Leaving race…', ENDING: 'Ending race…', EDITING: 'Saving changes…' }[status.activity]

  return (
    <div style="margin-top:14px">
      {/* The phone's header: who you race as (tap to change), how fresh the standings are, then add / settings. */}
      <div class="row" style="margin-right:-12px">
        <div class="grow clickable" onClick={onEditName}>
          <div class="title-medium">Racing as {s.race.emoji ? `${s.race.emoji} ` : ''}{s.race.name}</div>
          <div class="muted small">{activityText ? <span class="row"><Spinner /> {activityText}</span> : s.race.lastSync ? `Updated ${agoText(s.race.lastSync, now)} · tap to change name` : 'Tap to change name'}</div>
        </div>
        <div style="position:relative">
          <button class="icon-btn" title="Add a race" onClick={() => setAddMenu(!addMenu)}><Icon name="add" /></button>
          {addMenu && (
            <div class="menu" onMouseLeave={() => setAddMenu(false)}>
              <button onClick={() => { setAddMenu(false); setJoin(true) }}><Icon name="flag" size={20} />Join with a code</button>
              <button onClick={() => { setAddMenu(false); setCreate(true) }}><Icon name="add" size={20} />New event</button>
            </div>
          )}
        </div>
        <button class="icon-btn" title="Refresh" onClick={() => sync()}><Icon name="refresh" /></button>
        <button class="icon-btn" title="Race settings" onClick={() => setSettings(true)}><Icon name="settings" /></button>
      </div>
      {status.error && (
        <div class="notice section">
          {errorText(status.error)} {s.race.lastSync ? 'The standings below are from the last successful update.' : ''}
          <button class="btn text small" onClick={() => sync()}>Retry</button>
        </div>
      )}
      {!running.length && (
        <div class="empty-races">
          <span class="flag-circle"><Icon name="flag" size={30} /></span>
          <div class="muted">{done.length ? 'No races running right now. Start one and your friends will see it here.' : "No races yet. Start one and share its code, or join a friend's with theirs."}</div>
          {/* The same choices as the header's +, right where someone with no race is looking. */}
          <div style="position:relative">
            <button class="btn tonal" onClick={() => setEmptyMenu(!emptyMenu)}><Icon name="add" size={18} />Add a race</button>
            {emptyMenu && (
              <div class="menu" style="left:0;right:auto" onMouseLeave={() => setEmptyMenu(false)}>
                <button onClick={() => { setEmptyMenu(false); setJoin(true) }}><Icon name="flag" size={20} />Join with a code</button>
                <button onClick={() => { setEmptyMenu(false); setCreate(true) }}><Icon name="add" size={20} />New event</button>
              </div>
            )}
          </div>
        </div>
      )}
      {running.map((e) => <RaceCard key={e.id} event={e} now={now} />)}
      {done.length > 0 && (
        <div class="section">
          <div class="section-title"><h2>Completed races</h2><button class="btn text small" onClick={() => setShowDone(!showDone)}>{showDone ? 'Hide' : `Show ${done.length}`}</button></div>
          {showDone && done.map((e) => <RaceCard key={e.id} event={e} now={now} completed />)}
        </div>
      )}
      {create && <CreateRaceDialog onClose={() => setCreate(false)} />}
      {join && <JoinDialog onClose={() => setJoin(false)} />}
      {settings && <RaceSettingsDialog onClose={() => setSettings(false)} />}
    </div>
  )
}

function barColors(s) {
  const pal = BAR_PALETTES[s.race.barPalette] || BAR_PALETTES.theme
  const o = s.race.barOrder || [0, 1, 2]
  return { listening: pal[o[0]], reading: pal[o[1]], anki: pal[o[2]] }
}

const picked = (st) => (/^#[0-9A-F]{6}$/i.test(st.color || '') ? st.color.toUpperCase() : null)

/** Each racer's chart colour: their own pick, else the next automatic colour nobody has picked. */
function lineColor(standing, i, standings = []) {
  if (picked(standing)) return picked(standing)
  const taken = new Set(standings.map(picked).filter(Boolean))
  const free = AUTO_LINE.filter((c) => !taken.has(c.toUpperCase()))
  const autoIndex = standings.slice(0, i).filter((x) => !picked(x)).length
  return (free.length ? free : AUTO_LINE)[autoIndex % (free.length || AUTO_LINE.length)]
}

function remaining(ms) {
  const d = Math.floor(ms / DAY), h = Math.floor((ms % DAY) / HOUR), m = Math.floor((ms % HOUR) / 60000)
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
}

function RaceCard({ event, now, completed }) {
  const s = useStore()
  const me = s.race.userId
  const [menu, setMenu] = useState(false)
  const [person, setPerson] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [edit, setEdit] = useState(false)
  const [results, setResults] = useState(!completed)
  const goal = event.goalHours * HOUR
  const started = now >= event.startMillis
  const ended = event.endMillis != null && event.endMillis <= now
  const colors = barColors(s)
  const outlook = raceOutlook(event, me, now)
  const isCreator = event.createdBy === me
  const winner = ended && event.standings[0]
  const reason = { goal: 'goal reached', time: 'time ran out', manual: 'ended early' }[event.endReason] || 'ended'
  const waiting = ended ? event.standings.filter((x) => !x.final).map((x) => x.name) : []

  return (
    <div class="card race-card section">
      <div class="row" style="align-items:flex-start">
        <div class="grow">
          <h2>{event.name}</h2>
          <div class="muted small">
            {ended ? `Ended ${formatDate(event.endMillis)} · ${reason}${winner ? ` · ${winner.name} won` : ''}`
              : !started ? `Starts in ${remaining(event.startMillis - now)}`
                : event.endMillis ? `${remaining(event.endMillis - now)} left` : 'Runs until someone reaches the goal'}
          </div>
        </div>
        {event.code && !ended && <button class="code-pill" style="border:0;color:inherit" title="Share this race's code" onClick={() => share(`Join my race "${event.name}" in Immersion Tracker: Social → Race → Join with a code → ${event.code}`)}>{event.code}</button>}
        <button class="icon-btn" onClick={() => setMenu(!menu)}>⋮</button>
      </div>
      {menu && (
        <div class="chips" style="margin-top:10px">
          {!ended && isCreator && <button class="chip" onClick={() => { setMenu(false); setEdit(true) }}>Edit race</button>}
          {!ended && isCreator && <button class="chip" onClick={() => { setMenu(false); setConfirm('end') }}>End event</button>}
          {!ended && <button class="chip" onClick={() => { setMenu(false); setConfirm('leave') }}>Leave</button>}
          {ended && <button class="chip" onClick={() => { setMenu(false); setConfirm('delete') }}>Delete from my history</button>}
          {!ended && isCreator && <button class="chip" onClick={() => { setMenu(false); setConfirm('deleteAll') }}>Delete for everyone</button>}
        </div>
      )}
      <div class="row small muted wrap" style="gap:14px;margin-top:8px">
        <span>Goal <b>{event.goalHours} h</b></span>
        <span>{started ? 'Started' : 'Starts'} <b>{formatDateTime(event.startMillis)}</b></span>
        {event.endMillis && <span>Ends <b>{formatDateTime(event.endMillis)}</b></span>}
      </div>

      {completed && <button class="btn text small" style="padding:0;margin-top:6px" onClick={() => setResults(!results)}>{results ? 'Hide results' : 'Show results'}</button>}
      {results && (
        <>
          {outlook && <OutlookNote o={outlook} event={event} />}
          <div class="col" style="gap:2px;margin-top:10px">
            {!event.standings.length && <div class="muted small">Nobody has joined yet.</div>}
            {event.standings.map((st, i) => {
              const listening = Math.max(0, st.millis - st.readingMillis - st.ankiMillis)
              const scale = Math.max(goal, event.standings[0]?.millis || 1)
              return (
                <div key={st.userId} class={`standing ${st.userId === me ? 'me' : ''}`} onClick={() => setPerson(st)}>
                  <span class="rank">{i + 1}</span>
                  <Avatar standing={st} />
                  <div class="grow">
                    <div class="row" style="gap:6px">
                      <b class="name ellipsis">{st.name}</b>
                      {st.active && <span class="now-tag row" style="gap:3px;display:inline-flex"><TypeIcon type={st.activeKind === 'reading' ? 'READING' : st.activeKind === 'anki' ? 'ANKI' : 'PODCAST'} size={11} />now</span>}
                      <span class="spacer" />
                      <span class="small" style="font-variant-numeric:tabular-nums;font-weight:650">{formatHm(st.millis)}</span>
                      <span class="muted tiny" style="width:40px;text-align:right">{Math.floor((st.millis / goal) * 100)}%</span>
                    </div>
                    <div class="progress" style="margin-top:4px;height:8px">
                      <div style={{ width: `${(listening / scale) * 100}%`, background: colors.listening }} />
                      <div style={{ width: `${(st.readingMillis / scale) * 100}%`, background: colors.reading }} />
                      <div style={{ width: `${(st.ankiMillis / scale) * 100}%`, background: colors.anki }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <div class="row tiny muted wrap" style="gap:12px;margin-top:8px">
            <span class="row" style="gap:4px"><span class="dot" style={{ background: colors.listening }} />Listening</span>
            <span class="row" style="gap:4px"><span class="dot" style={{ background: colors.reading }} />Reading</span>
            <span class="row" style="gap:4px"><span class="dot" style={{ background: colors.anki }} />Anki (up to 10% of immersion)</span>
          </div>
          {waiting.length > 0 && <div class="muted tiny" style="margin-top:6px">Still waiting for final totals from: {waiting.join(', ')}</div>}
          {started && event.standings.length > 0 && <ProgressChart event={event} now={now} />}
        </>
      )}
      {person && <PersonSheet event={event} standing={person} now={now} onClose={() => setPerson(null)} />}
      {edit && <EditRaceDialog event={event} onClose={() => setEdit(false)} />}
      {confirm === 'leave' && <Confirm title="Leave this race?" text={`You'll be removed from the standings of "${event.name}". You can join again while it's still running.`} confirmLabel="Leave" danger onConfirm={() => leaveEvent(event.id)} onClose={() => setConfirm(null)} />}
      {confirm === 'end' && <Confirm title="End this event?" text={`"${event.name}" will stop counting time for everyone, the standings will be locked, and it will move to Completed races.`} confirmLabel="End event" danger onConfirm={() => endEvent(event.id)} onClose={() => setConfirm(null)} />}
      {confirm === 'delete' && <Confirm title="Delete this race?" text={`"${event.name}" will be removed from your history in this browser. Your friends keep their own copies.`} confirmLabel="Delete" danger onConfirm={() => deleteCompleted(event.id)} onClose={() => setConfirm(null)} />}
      {confirm === 'deleteAll' && <Confirm title="Delete this race for everyone?" text={`"${event.name}" and everyone's scores in it will be removed from the server.`} confirmLabel="Delete" danger onConfirm={() => deleteEventForEveryone(event.id)} onClose={() => setConfirm(null)} />}
    </div>
  )
}

function Avatar({ standing, profile, size = 34 }) {
  const s = getState()
  const catalog = useCatalog()
  const prof = profile || (s.race.profiles?.[standing?.userId] ? readProfile(s.race.profiles[standing.userId]) : null)
  const emoji = (standing?.emoji || prof?.emoji || '').trim()
  const animal = prof && prof.avatar !== 'emoji' && prof.trophy && catalog ? catalog.find((a) => a.id === prof.trophy) : null
  return (
    <div class="avatar" style={{ width: size, height: size, fontSize: size * 0.5, border: animal ? `2px solid ${RARITY_COLOR[animal.rarity]}` : undefined }}>
      {animal ? <AnimalPhoto animal={animal} /> : emoji || (standing?.name || prof?.name || '?').slice(0, 1).toUpperCase()}
    </div>
  )
}

function OutlookNote({ o, event }) {
  const lines = []
  if (o.participants < 2) lines.push('Nobody else has joined yet')
  else {
    lines.push(`You're ${ordinal(o.rank)} of ${o.participants}`)
    if (o.ahead) lines.push(o.gapToAhead === 0 ? `Tied with ${o.ahead.name}` : `${formatHm(o.gapToAhead)} to pass ${o.ahead.name}`)
    else if (o.behind) lines.push(`Leading ${o.behind.name} by ${formatHm(o.leadOverBehind)}`)
    if (o.leader) lines.push(`${formatHm(o.gapToLeader)} behind the leader, ${o.leader.name}`)
    if (o.neededPerDay != null) {
      lines.push(o.neededPerDay > DAY ? `Catching ${event.standings[0].name} at their current pace would take more than 24 hours a day`
        : o.neededReachesGoal ? `To reach ${o.goalHours}h before ${event.standings[0].name}: ${formatHm(o.neededPerDay)} a day, if they keep their pace`
          : `To finish ahead of ${event.standings[0].name}: ${formatHm(o.neededPerDay)} a day, if they keep their pace`)
    }
  }
  if (o.myPerDay != null) {
    lines.push(o.projectedGoal ? `Your pace: ${formatHm(o.myPerDay)} a day, reaching ${o.goalHours}h around ${formatDate(o.projectedGoal)}`
      : o.projectedAtEnd ? `Your pace: ${formatHm(o.myPerDay)} a day, about ${formatHm(o.projectedAtEnd)} by the end` : `Your pace: ${formatHm(o.myPerDay)} a day`)
  }
  return <div class="col small" style="gap:2px;margin-top:10px;padding:10px 12px;border-radius:14px;background:var(--c)">{lines.map((l, i) => <span key={i} class={i ? 'muted' : ''} style={i ? '' : 'font-weight:650'}>{l}</span>)}</div>
}

/** Everyone's running total, day by day, as lines. */
function ProgressChart({ event, now }) {
  const [view, setView] = useState('total')
  const [replay, setReplay] = useState(null)
  const startDay = ymdToEpochDay(ymdOf(event.startMillis - 4 * HOUR))
  const endMs = Math.min(event.endMillis ?? now, now)
  const lastDay = Math.max(startDay, ymdToEpochDay(ymdOf(endMs - 4 * HOUR)))
  const days = []
  for (let d = startDay; d <= lastDay; d++) days.push(epochDayToYmd(d))
  const series = event.standings.map((st, i) => {
    let acc = 0
    const pts = days.map((k) => (acc += st.daily[k] || 0))
    return { st, pts, color: lineColor(st, i, event.standings) }
  })
  const missing = event.standings.filter((st) => !Object.keys(st.daily).length && st.millis > 0)
  const shownDays = replay != null ? Math.min(days.length, replay) : days.length
  useEffect(() => {
    if (replay == null) return
    if (replay >= days.length) { setReplay(null); return }
    const t = setTimeout(() => setReplay(replay + 1), Math.max(60, 2400 / days.length))
    return () => clearTimeout(t)
  }, [replay])

  if (view === 'today') {
    return (
      <div class="section">
        <div class="row"><h3 class="grow">Progress</h3><Seg options={[['total', 'Total'], ['today', 'Today']]} value={view} onChange={setView} /></div>
        <div class="muted tiny" style="margin:6px 0">Each person's own today, where they are.</div>
        <div class="col" style="gap:6px">
          {event.standings.map((st, i) => {
            const today = st.daily[localTodayKey(st, now)] || 0
            const max = Math.max(1, ...event.standings.map((x) => x.daily[localTodayKey(x, now)] || 0))
            return <div key={st.userId} class="row small"><span style="width:90px" class="ellipsis">{st.emoji} {st.name}</span><div class="progress grow"><div style={{ width: `${(today / max) * 100}%`, background: lineColor(st, i, event.standings) }} /></div><span style="width:64px;text-align:right">+{formatHm(today)}</span></div>
          })}
        </div>
      </div>
    )
  }
  const W = 600, H = 200, P = 6
  const goal = event.goalHours * HOUR
  const maxY = Math.max(1, ...series.flatMap((x) => x.pts.slice(0, shownDays)), Math.min(goal, Math.max(...series.map((x) => x.st.millis)) * 1.1))
  const x = (i) => P + (days.length <= 1 ? 0 : (i / (days.length - 1)) * (W - 2 * P))
  const y = (v) => H - P - (v / maxY) * (H - 2 * P)
  return (
    <div class="section">
      <div class="row"><h3 class="grow">Progress</h3><button class="btn text small" onClick={() => setReplay(replay == null ? 1 : null)}>{replay == null ? 'Replay' : 'Stop'}</button><Seg options={[['total', 'Total'], ['today', 'Today']]} value={view} onChange={setView} /></div>
      <svg viewBox={`0 0 ${W} ${H}`} style="width:100%;height:auto;margin-top:8px;overflow:visible">
        {goal <= maxY && <line x1={P} x2={W - P} y1={y(goal)} y2={y(goal)} stroke="var(--outline)" stroke-dasharray="6 6" />}
        {series.map((sr) => (
          <polyline key={sr.st.userId} fill="none" stroke={sr.color} stroke-width="3" stroke-linejoin="round" stroke-linecap="round"
            points={sr.pts.slice(0, shownDays).map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
        ))}
        {series.map((sr) => {
          const i = Math.max(0, shownDays - 1)
          return sr.st.emoji ? <text key={'e' + sr.st.userId} x={x(i)} y={y(sr.pts[i] || 0) - 6} font-size="16" text-anchor="middle">{sr.st.emoji}</text> : null
        })}
      </svg>
      <div class="row tiny muted"><span class="grow">{formatYmd(days[0])}</span>{goal <= maxY && <span>Goal {event.goalHours}h</span>}<span class="grow" style="text-align:right">{formatYmd(days[days.length - 1])}</span></div>
      {missing.length > 0 && <div class="muted tiny">No day-by-day data from {missing.map((m) => m.name).join(', ')} yet.</div>}
    </div>
  )
}

function PersonSheet({ event, standing: st, now, onClose }) {
  const s = useStore()
  const me = s.race.userId
  const mine = event.standings.find((x) => x.userId === me)
  const place = event.standings.findIndex((x) => x.userId === st.userId) + 1
  const goal = event.goalHours * HOUR
  const todayKey = localTodayKey(st, now)
  const dailyKeys = Object.keys(st.daily).map(Number).sort((a, b) => a - b)
  const active = dailyKeys.filter((k) => st.daily[k] > 0).length
  const spanDays = Math.max(1, Math.ceil((Math.min(event.endMillis ?? now, now) - event.startMillis) / DAY))
  const best = dailyKeys.reduce((b, k) => (!b || st.daily[k] > st.daily[b] ? k : b), null)
  const listening = Math.max(0, st.millis - st.readingMillis - st.ankiMillis)
  const pct = (v) => (st.millis ? Math.round((v / st.millis) * 100) : 0)
  const isFriend = s.friends.friends.some((f) => f.userId === st.userId)
  const outgoing = s.friends.outgoing.some((f) => f.userId === st.userId)
  const incoming = s.friends.incoming.some((f) => f.userId === st.userId)
  const profile = s.race.profiles?.[st.userId] ? readProfile(s.race.profiles[st.userId]) : null
  const [viewProfile, setViewProfile] = useState(false)
  const maxDay = Math.max(1, ...dailyKeys.map((k) => st.daily[k]))
  let localTime = ''
  try { if (st.timeZone && st.userId !== me) localTime = new Date(now).toLocaleTimeString(undefined, { timeZone: st.timeZone, hour: 'numeric', minute: '2-digit' }) } catch { /* unknown zone */ }

  const friendAction = async (fn, ok) => {
    try { await fn(); toast(ok) } catch (err) { toast(errorText(err) || 'Couldn\'t send the friend request') }
  }
  return (
    <Dialog onClose={onClose} actions={<>
      {profile && <button class="btn text" onClick={() => setViewProfile(true)}>Profile</button>}
      <span class="spacer" />
      {st.userId !== me && (isFriend ? <span class="muted small">Friends ✓</span>
        : incoming ? <button class="btn tonal" onClick={() => friendAction(() => respondFriend(st.userId, true), `You and ${st.name} are now friends!`)}>Accept friend request</button>
          : outgoing ? <span class="muted small">Friend request sent</span>
            : <button class="btn tonal" onClick={() => friendAction(() => addFriendById(st.userId), `Friend request sent to ${st.name}`)}>Add friend</button>)}
      <button class="btn" onClick={onClose}>Close</button>
    </>}>
      <div class="row" style="margin-bottom:12px"><Avatar standing={st} size={48} /><div class="grow"><h2 style="margin:0">{st.name}</h2><div class="muted small">{ordinal(place)} of {event.standings.length} in {event.name}</div></div></div>
      <div class="stat-tiles">
        <div class="tile"><div class="k">Total</div><div class="v">{formatHm(st.millis)}</div><div class="k">{Math.floor((st.millis / goal) * 100)}% of the {event.goalHours}h goal</div></div>
        <div class="tile"><div class="k">{st.userId === me ? 'Today' : 'Their today'}</div><div class="v">{formatHm(st.daily[todayKey] || 0)}</div>{localTime && <div class="k">{localTime} where they are</div>}</div>
        <div class="tile"><div class="k">Daily average</div><div class="v">{formatHm(st.millis / spanDays)}</div></div>
        <div class="tile"><div class="k">Days active</div><div class="v">{active} of {spanDays}</div></div>
        <div class="tile"><div class="k">Best day</div><div class="v">{best ? formatHm(st.daily[best]) : '–'}</div>{best && <div class="k">{formatYmd(best)}</div>}</div>
      </div>
      <div class="small muted" style="margin-top:12px">
        <span class="row wrap" style="gap:12px">
          <TypeLabel type="PODCAST" size={14}>{formatHm(listening)} · {pct(listening)}%</TypeLabel>
          <TypeLabel type="READING" size={14}>{formatHm(st.readingMillis)} · {pct(st.readingMillis)}%</TypeLabel>
          <TypeLabel type="ANKI" size={14}>{formatHm(st.ankiMillis)} counted{st.ankiBankedMillis > 0 ? ` · ${formatHm(st.ankiBankedMillis)} banked` : ''}</TypeLabel>
        </span>
      </div>
      {mine && st.userId !== me && <div class="small" style="margin-top:6px">{st.millis === mine.millis ? 'Tied with you' : st.millis > mine.millis ? `${formatHm(st.millis - mine.millis)} ahead of you` : `${formatHm(mine.millis - st.millis)} behind you`}</div>}
      <div class="muted tiny" style="margin-top:4px">{st.final ? 'Final total' : `Last reported ${agoText(st.updatedAt, now)}`}</div>
      <h3 style="margin:14px 0 8px">Day by day</h3>
      {!dailyKeys.length ? <div class="muted small">Day-by-day totals appear once this person updates the app.</div> : (
        <div class="col" style="gap:4px">
          {[...dailyKeys].reverse().map((k) => (
            <div key={k} class="row tiny"><span style="width:70px" class="muted">{formatYmd(k)}</span><div class="progress grow" style="height:7px"><div style={{ width: `${(st.daily[k] / maxDay) * 100}%`, background: 'var(--primary)' }} /></div><span style="width:56px;text-align:right">{formatHm(st.daily[k])}</span></div>
          ))}
        </div>
      )}
      {viewProfile && profile && <ProfileDialog profile={profile} onClose={() => setViewProfile(false)} />}
    </Dialog>
  )
}

function toLocalInput(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function CreateRaceDialog({ onClose }) {
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('100')
  const [start, setStart] = useState(null)
  const [end, setEnd] = useState(null)
  const [busy, setBusy] = useState(false)
  const startMs = start ? new Date(start).getTime() : Date.now()
  const endMs = end ? new Date(end).getTime() : null
  const bad = endMs != null && endMs <= startMs
  const go = async () => {
    setBusy(true)
    const ok = await createEvent({ name: name.trim(), startMillis: startMs, endMillis: endMs, goalHours: Math.max(1, Number(goal) || 100) })
    setBusy(false)
    if (ok) onClose()
    else toast(errorText(raceStatus.error))
  }
  return (
    <Dialog title="New event" onClose={onClose} actions={<>
      <button class="btn text" onClick={onClose}>Cancel</button>
      <button class="btn" disabled={!name.trim() || bad || busy} onClick={go}>{busy ? <Spinner /> : 'Create'}</button>
    </>}>
      <div class="col" style="gap:14px">
        <label class="field">Event name<input class="input" value={name} maxLength={60} autoFocus onInput={(e) => setName(e.currentTarget.value)} /></label>
        <label class="field">Goal (hours)<input class="input" inputMode="numeric" value={goal} onInput={(e) => setGoal(e.currentTarget.value.replace(/\D/g, ''))} /></label>
        <label class="field">Starts<div class="row"><input type="datetime-local" class="input grow" value={start || ''} onInput={(e) => setStart(e.currentTarget.value || null)} />{start && <button class="btn text small" onClick={() => setStart(null)}>Now</button>}</div>{!start && <span class="tiny">Now</span>}</label>
        <label class="field">Ends<div class="row"><input type="datetime-local" class="input grow" value={end || ''} onInput={(e) => setEnd(e.currentTarget.value || null)} />{end && <button class="btn text small" onClick={() => setEnd(null)}>Clear</button>}</div>{!end && <span class="tiny">No end date - runs until someone reaches the goal</span>}</label>
        {bad && <div class="err small">The end has to be after the start.</div>}
      </div>
    </Dialog>
  )
}

function EditRaceDialog({ event, onClose }) {
  const [name, setName] = useState(event.name)
  const [end, setEnd] = useState(event.endMillis ? toLocalInput(event.endMillis) : '')
  const endMs = end ? new Date(end).getTime() : null
  const changed = endMs !== (event.endMillis ?? null)
  const bad = endMs != null && endMs <= Date.now()
  return (
    <Dialog title="Edit race" onClose={onClose} actions={<>
      <button class="btn text" onClick={onClose}>Cancel</button>
      <button class="btn" disabled={!name.trim() || bad} onClick={async () => { await editEvent(event.id, name.trim(), changed, endMs); onClose() }}>Save</button>
    </>}>
      <div class="col" style="gap:14px">
        <label class="field">Race name<input class="input" value={name} onInput={(e) => setName(e.currentTarget.value)} /></label>
        <label class="field">Ends<div class="row"><input type="datetime-local" class="input grow" value={end} onInput={(e) => setEnd(e.currentTarget.value)} />{end && <button class="btn text small" onClick={() => setEnd('')}>No end date</button>}</div></label>
        {bad && <div class="err small">The new end has to be in the future.</div>}
        <div class="muted small">To finish the race right now, use End event instead.</div>
      </div>
    </Dialog>
  )
}

function JoinDialog({ onClose }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    const ok = await joinByCode(code)
    setBusy(false)
    if (ok) { toast('Joined!'); onClose() } else toast(errorText(raceStatus.error))
  }
  return (
    <Dialog title="Join with a code" onClose={onClose} sheet={false} actions={<>
      <button class="btn text" onClick={onClose}>Cancel</button>
      <button class="btn" disabled={code.trim().length < 4 || busy} onClick={go}>{busy ? <Spinner /> : 'Join'}</button>
    </>}>
      <p class="muted small" style="margin-top:0">Races are private - ask whoever started it for its code.</p>
      <input class="input" style="text-transform:uppercase;letter-spacing:3px;font-weight:700" placeholder="Race code" value={code} autoFocus onInput={(e) => setCode(e.currentTarget.value.toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && go()} />
    </Dialog>
  )
}

function RaceSettingsDialog({ onClose }) {
  const s = useStore()
  const colors = barColors(s)
  return (
    <Dialog title="Race settings" onClose={onClose} actions={<button class="btn" onClick={onClose}>Done</button>}>
      <div class="muted small" style="margin-bottom:12px">These only change the Race tab.</div>
      <div style="font-weight:600;margin-bottom:8px">Bar colors</div>
      <div class="chips">
        {Object.entries(BAR_PALETTES).map(([id, pal]) => (
          <button key={id} class={`chip ${s.race.barPalette === id ? 'on' : ''}`} onClick={() => update((st) => { st.race.barPalette = id })}>
            {pal.map((c, i) => <span key={i} class="dot" style={{ background: c }} />)}{id === 'theme' ? 'UI theme' : id[0].toUpperCase() + id.slice(1)}
          </button>
        ))}
      </div>
      <div style="font-weight:600;margin:14px 0 8px">Which color is which</div>
      <div class="chips">
        {[[0, 1, 2], [1, 0, 2], [0, 2, 1], [2, 0, 1], [1, 2, 0], [2, 1, 0]].map((o) => {
          const pal = BAR_PALETTES[s.race.barPalette] || BAR_PALETTES.theme
          return <button key={o.join()} class={`chip ${String(s.race.barOrder) === String(o) ? 'on' : ''}`} onClick={() => update((st) => { st.race.barOrder = o })}>
            <span class="dot" style={{ background: pal[o[0]] }} /><TypeIcon type="PODCAST" size={14} /><span class="dot" style={{ background: pal[o[1]] }} /><TypeIcon type="READING" size={14} /><span class="dot" style={{ background: pal[o[2]] }} /><TypeIcon type="ANKI" size={14} />
          </button>
        })}
      </div>
      <div style="font-weight:600;margin:14px 0 4px">Your line on the progress chart</div>
      <div class="muted small" style="margin-bottom:8px">Everyone in your races sees your line in this color.</div>
      <div class="swatches">
        <button class={`chip ${!s.race.chartColor ? 'on' : ''}`} onClick={() => update((st) => { st.race.chartColor = '' })}>Automatic</button>
        {AUTO_LINE.concat(LANGUAGE_COLORS_BRIGHT).map((c) => <button key={c} class={`swatch ${s.race.chartColor === c.toUpperCase() ? 'on' : ''}`} style={{ background: c }} onClick={() => update((st) => { st.race.chartColor = c.toUpperCase() })} />)}
      </div>
      <div class="muted tiny" style="margin-top:12px">Listening is shown in {colors.listening.startsWith('var') ? 'the theme colour' : colors.listening}.</div>
    </Dialog>
  )
}

/* ------------------------------------------------------------------------------------------------
 * Friends
 * --------------------------------------------------------------------------------------------- */

function Friends() {
  const s = useStore()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(null)
  const [mine, setMine] = useState(false)
  const [remove, setRemove] = useState(null)
  const run = async (fn, ok) => {
    setBusy(true)
    try { await fn(); setError(null); if (ok) toast(ok) } catch (err) { setError(errorText(err)) }
    setBusy(false)
  }
  useEffect(() => { run(refreshFriends) }, [])
  const friends = s.friends.friends.map(readProfile)

  return (
    <div style="margin-top:14px">
      <div class="card row">
        <div class="grow clickable" onClick={() => s.friends.code && copyText(s.friends.code, 'Friend code copied')}>
          <div class="muted small">Your friend code · tap to copy</div>
          <div class="code-pill" style="display:inline-block;margin-top:4px;font-size:18px">{s.friends.code || '······'}</div>
        </div>
        <button class="btn tonal small" disabled={!s.friends.code} onClick={() => share(`Add me as a friend in Immersion Tracker (Social → Friends): ${s.friends.code}`)}>Share code</button>
        {busy && <Spinner />}
      </div>
      {error && <div class="notice section">{error} <button class="btn text small" onClick={() => run(refreshFriends)}>Retry</button></div>}

      <div class="card section">
        <h3 style="margin-bottom:8px">Add a friend</h3>
        <div class="row">
          <input class="input grow" style="text-transform:uppercase;letter-spacing:2px" placeholder="Friend's code" value={code} onInput={(e) => setCode(e.currentTarget.value.toUpperCase())} />
          <button class="btn" disabled={code.trim().length < 4 || busy} onClick={() => run(async () => { await addFriendByCode(code); setCode('') }, 'Friend request sent')}>Add</button>
        </div>
      </div>

      {s.friends.incoming.length > 0 && (
        <div class="section">
          <div class="section-title"><h2>Friend requests</h2></div>
          <div class="list">{s.friends.incoming.map(readProfile).map((p) => (
            <div key={p.userId} class="entry" style="cursor:default">
              <Avatar profile={p} />
              <b class="grow">{p.name}</b>
              <button class="btn text small" onClick={() => run(() => respondFriend(p.userId, false))}>Decline</button>
              <button class="btn small" onClick={() => run(() => respondFriend(p.userId, true), `You and ${p.name} are now friends!`)}>Accept</button>
            </div>
          ))}</div>
        </div>
      )}
      {s.friends.outgoing.length > 0 && (
        <div class="section">
          <div class="section-title"><h2>Sent - waiting for them</h2></div>
          <div class="list">{s.friends.outgoing.map(readProfile).map((p) => (
            <div key={p.userId} class="entry" style="cursor:default"><Avatar profile={p} /><b class="grow">{p.name}</b><button class="btn text small" onClick={() => run(() => removeFriend(p.userId))}>Cancel</button></div>
          ))}</div>
        </div>
      )}

      <div class="section">
        <div class="section-title"><h2>Friends · {friends.length}</h2></div>
        {!friends.length ? <div class="card muted small">No friends yet - add someone by their code, or tap them in a race.</div> : (
          <div class="list">{friends.map((p) => (
            <div key={p.userId} class="entry" onClick={() => setOpen(p)} style={p.banner ? { borderLeft: `6px solid ${p.banner.split(',')[0]}` } : undefined}>
              <Avatar profile={p} size={40} />
              <div class="grow">
                <div class="row" style="gap:6px"><b>{p.emoji} {p.name}</b>{p.goldenDays >= 3 && <span class="momentum gold" style="height:22px;padding:0 8px;font-size:11px"><Flame gold /> {p.goldenDays}d</span>}</div>
                <div class="muted tiny">{p.updatedAt ? `Updated ${agoText(p.updatedAt)}` : ''}{p.zooFound != null ? ` · ${p.zooFound} in their zoo` : ''}</div>
              </div>
              <div class="row" style="gap:2px">{p.languages.slice(0, 3).map((l, i) => <Ring key={i} size={30} progress={Math.max(l.listenProgress ?? 0, l.readProgress ?? 0)} color={l.color || '#888'} ringStyle="CLASSIC" />)}</div>
            </div>
          ))}</div>
        )}
      </div>

      <ProfileSettings onPreview={() => setMine(true)} />
      {open && <ProfileDialog profile={open} onClose={() => setOpen(null)} onRemove={() => setRemove(open)} />}
      {mine && <ProfileDialog profile={readProfile({ userId: s.race.userId, name: s.race.name, emoji: s.race.emoji, color: s.race.chartColor, code: s.friends.code, updatedAt: Date.now(), profile: buildProfileBody() })} onClose={() => setMine(false)} />}
      {remove && <Confirm title={`Remove ${remove.name} as a friend?`} confirmLabel="Remove friend" danger onConfirm={() => { setOpen(null); run(() => removeFriend(remove.userId)) }} onClose={() => setRemove(null)} />}
    </div>
  )
}

function ProfileSettings({ onPreview }) {
  const s = useStore()
  const share = s.friends.share
  const set = (k, v) => update((st) => { st.friends.share[k] = v })
  const push = () => refreshFriends().catch(() => {})
  return (
    <div class="section">
      <div class="section-title"><h2>Your profile</h2><button class="btn text small" onClick={onPreview}>Preview my profile</button></div>
      <div class="card" style="padding:6px 12px">
        <div class="muted small" style="padding:10px 4px 4px">Your friends - and anyone in a race with you - see these on your profile.</div>
        {[['trophy', 'Trophy animal'], ['zoo', 'Animal collection'], ['rings', "Today's rings"], ['goals', 'Daily goals'], ['streaks', 'Streaks'], ['records', 'Records']].map(([k, l]) => (
          <SettingRow key={k} title={l}><Switch checked={share[k]} onChange={(v) => { set(k, v); push() }} /></SettingRow>
        ))}
        <div style="padding:10px 4px">
          <div style="font-weight:600;margin-bottom:8px">Your picture in friends' lists</div>
          <div class="chips">
            <button class={`chip ${s.friends.avatar === 'emoji' ? 'on' : ''}`} onClick={() => { update((st) => { st.friends.avatar = 'emoji' }); push() }}>Race emoji</button>
            <button class={`chip ${s.friends.avatar !== 'emoji' ? 'on' : ''}`} onClick={() => { update((st) => { st.friends.avatar = '' }); push() }}>Animal on display</button>
          </div>
          {s.friends.avatar !== 'emoji' && !s.zoo.trophyId && <div class="muted tiny" style="margin-top:6px">Put an animal on display in your Zoo (and share it) to use it - until then friends see your emoji.</div>}
        </div>
        <div style="padding:10px 4px">
          <div style="font-weight:600;margin-bottom:8px">Your banner colour</div>
          <div class="swatches">
            <button class={`chip ${!s.friends.banner ? 'on' : ''}`} onClick={() => { update((st) => { st.friends.banner = '' }); push() }}>None</button>
            {[...LANGUAGE_COLORS_BRIGHT.map((c) => [c]), ...GRADIENTS.slice(0, 10)].map((g) => {
              const v = g.join(',')
              return <button key={v} class={`swatch ${s.friends.banner === v ? 'on' : ''}`} style={{ background: g.length > 1 ? `linear-gradient(135deg, ${g.join(', ')})` : g[0] }} onClick={() => { update((st) => { st.friends.banner = v }); push() }} />
            })}
          </div>
        </div>
        <div style="padding:10px 4px">
          <div style="font-weight:600;margin-bottom:8px">Profile background</div>
          <div class="chips scroll">
            <button class={`chip ${!s.friends.background ? 'on' : ''}`} onClick={() => { update((st) => { st.friends.background = '' }); push() }}>None</button>
            {PRESETS.map((p) => <button key={p} class={`chip ${s.friends.background === 'theme:' + p ? 'on' : ''}`} onClick={() => { update((st) => { st.friends.background = 'theme:' + p }); push() }}>{presetLabel(p)}</button>)}
          </div>
        </div>
      </div>
    </div>
  )
}

/** A profile's goals laid out like its owner's Home: the heading with their Momentum pill, then a
 *  goal card per language - two columns, an odd one out across the full width. */
function ProfileTodayCard({ p }) {
  const asOf = p.dayKey > 0 && p.dayKey !== ymdOf(Date.now())
  const has = (l, k) => l[k + 'Goal'] != null || l[k + 'Progress'] != null || !!l[k + 'Streak']
  const cards = p.languages.filter((l) => has(l, 'listen') || has(l, 'read'))
  const odd = cards.length % 2 === 1 ? cards[cards.length - 1] : null
  const grid = cards.filter((l) => l !== odd)
  const columns = [[], []]
  const weights = [0, 0]
  for (const l of grid) {
    const i = weights[0] <= weights[1] ? 0 : 1
    columns[i].push(l)
    weights[i] += has(l, 'listen') + has(l, 'read')
  }
  if (!cards.length) return null
  return (
    <div class="section">
      <div class="row" style="margin-bottom:6px">
        <h2 class="grow">Today</h2>
        {asOf && <span class="label-small muted">as of {formatYmd(p.dayKey)}</span>}
        {p.shows.streaks && p.goldenDays >= 3 && <MomentumPill days={p.goldenDays} progress={1} />}
      </div>
      {grid.length > 0 && <div class="goal-cols">{columns.map((col, i) => <div key={i}>{col.map((l, j) => <ProfileGoalCard key={j} l={l} ringStyle={p.ringStyle} />)}</div>)}</div>}
      {odd && <ProfileGoalCard l={odd} ringStyle={p.ringStyle} wide />}
    </div>
  )
}

/** One language as a goal card on its owner's Home: the language's colour taken down to the card,
 *  its name in that colour, and per goal its ring, today's minutes and the streak under it. */
function ProfileGoalCard({ l, ringStyle, wide }) {
  const light = !isDarkFor(getState().settings.uiColorPreset)
  const color = l.color || '#888888'
  const stops = l.gradient ? l.gradient.split(',').map((c) => c.trim()) : null
  const multi = stops && stops.length > 1
  const bg = multi ? `linear-gradient(135deg, ${stops.map((c) => dimColor(c, 0.6, 0.18, light)).join(', ')})` : dimColor(color, 0.6, 0.18, light)
  const nameStyle = multi
    ? { backgroundImage: `linear-gradient(90deg, ${stops.map((c) => (light ? deepened(c, 0.42) : c)).join(', ')})`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }
    : { color: light ? deepened(color, 0.42) : color }
  const iconColor = light ? '#000' : '#fff'
  const goals = [['listen', 'PODCAST'], ['read', 'READING']].filter(([k]) => l[k + 'Goal'] != null || l[k + 'Progress'] != null || l[k + 'Streak'])
  return (
    <div class={`goal-card ${wide ? 'wide' : ''}`} style={{ background: bg, cursor: 'default' }}>
      <div class="name ellipsis" style={nameStyle}>{l.name}</div>
      {goals.map(([k, type]) => {
        const goal = l[k + 'Goal']
        const today = l[k + 'Today'] ?? 0
        const progress = l[k + 'Progress'] ?? (goal > 0 ? today / goal : null)
        const streak = l[k + 'Streak']
        return (
          <div key={k} class="ring-stat">
            {progress != null
              ? <Ring size={64} progress={progress} color={color} stops={stops} ringStyle={ringStyle || 'CLASSIC'} icon={<TypeIcon type={type} size={22} color={iconColor} />} light={light} />
              : <div style="width:64px;height:64px;display:grid;place-items:center"><TypeIcon type={type} size={40} color={color} /></div>}
            {goal != null && <span class="val">{formatHm(today * 60000)} / {formatHm(goal * 60000, true)}</span>}
            {streak && <StreakBadge streak={{ current: streak.current, record: streak.record }} />}
          </div>
        )
      })}
    </div>
  )
}

export function ProfileDialog({ profile: p, onClose, onRemove }) {
  const catalog = useCatalog()
  const [all, setAll] = useState(false)
  const theme = p.background?.startsWith('theme:') ? schemeFor(p.background.slice(6), true) : null
  const wash = p.background && !theme ? p.background.split(',') : null
  const trophy = p.trophy && catalog?.find((a) => a.id === p.trophy)
  const cert = (id) => {
    const c = p.certs?.[id]
    return c ? { hourMark: c[0] >= 0 ? c[0] : null, languageName: c[1] || null, languageColor: c[2] || null, mediaTitle: c[3] || null, foil: c[4] === 1 } : null
  }
  const zoo = p.zoo && catalog ? Object.entries(p.zoo).map(([id, n]) => [catalog.find((a) => a.id === id), n]).filter(([a]) => a)
    .sort((a, b) => ['RAINBOW', 'ORANGE', 'PURPLE', 'BLUE', 'GREEN'].indexOf(a[0].rarity) - ['RAINBOW', 'ORANGE', 'PURPLE', 'BLUE', 'GREEN'].indexOf(b[0].rarity)) : []
  const banner = p.banner ? p.banner.split(',') : null
  return (
    <Dialog onClose={onClose} actions={<>{onRemove && <button class="btn text danger" onClick={onRemove}>Remove friend</button>}<span class="spacer" /><button class="btn" onClick={onClose}>Close</button></>}>
      <div style={theme ? { ...theme, background: 'var(--bg)', color: 'var(--on-surface)', margin: -22, padding: 22, borderRadius: 28 } : wash ? { background: `linear-gradient(160deg, ${wash.map((c) => withAlpha(c, 0.22)).join(', ')})`, margin: -22, padding: 22, borderRadius: 28 } : {}}>
        <div style={{ height: 70, borderRadius: 18, margin: '-4px 0 -30px', background: banner ? (banner.length > 1 ? `linear-gradient(90deg, ${banner.join(', ')})` : banner[0]) : 'var(--c-high)' }} />
        <div class="row" style="padding:0 12px;align-items:flex-end">
          <Avatar profile={p} size={64} />
          <div class="grow" style="padding-bottom:4px"><h2 style="margin:0">{p.emoji} {p.name}</h2>{p.updatedAt > 0 && <div class="muted tiny">Updated {agoText(p.updatedAt)}</div>}</div>
        </div>
        {p.code && <div class="muted small" style="margin:10px 12px 0">Friend code <span class="code-pill">{p.code}</span></div>}
        {trophy && p.shows.trophy && <div class="section"><div class="muted small" style="margin-bottom:6px">On display</div><AnimalCardView animal={trophy} cert={cert(trophy.id)} compact /></div>}
        {p.languages.length > 0 && (p.shows.rings || p.shows.goals || p.shows.streaks) && (
          <ProfileTodayCard p={p} />
        )}
        {p.records && (
          <div class="section">
            <h3 style="margin-bottom:8px">Records</h3>
            <div class="stat-tiles">
              <div class="tile"><div class="k">All-time immersion</div><div class="v">{Math.round(p.records.totalMillis / HOUR)}h</div></div>
              <div class="tile"><div class="k">Longest streak</div><div class="v">{p.records.longestStreak}d</div></div>
              <div class="tile"><div class="k">Best day</div><div class="v">{formatHm(p.records.bestDayMillis)}</div>{p.records.bestDay > 0 && <div class="k">{formatYmd(p.records.bestDay)}</div>}</div>
              <div class="tile"><div class="k">Days tracked</div><div class="v">{p.records.daysTracked}</div></div>
            </div>
          </div>
        )}
        {zoo.length > 0 && (
          <div class="section">
            <div class="row" style="margin-bottom:8px"><h3 class="grow">Zoo · {zoo.length}</h3>{zoo.length > 12 && <button class="btn text small" onClick={() => setAll(!all)}>{all ? 'Show fewer' : 'Show all'}</button>}</div>
            <div class="zoo-grid" style="grid-template-columns:repeat(auto-fill,minmax(72px,1fr))">
              {(all ? zoo : zoo.slice(0, 12)).map(([a, n]) => (
                <div key={a.id} class="tile-animal" style={{ borderColor: RARITY_COLOR[a.rarity] }} title={a.name}>
                  <AnimalPhoto animal={a} />{cert(a.id)?.foil && <div class="foil-sheen" />}{n > 1 && <span class="count">×{n}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}

export { RarityBadge }
