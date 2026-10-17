import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useStore, useNow, update, getState } from '../store.js'
import {
  sync, createEvent, joinByCode, leaveEvent, endEvent, editEvent, deleteEventForEveryone, deleteCompleted, visibleEvents, raceOutlook,
  raceStatus, onRaceStatus, errorText, ordinal, localTodayKey, refreshFriends, addFriendByCode, addFriendById, respondFriend, removeFriend,
  readProfile, buildProfileBody, raceConfigured, DEFAULT_RACE_URL, runningForRace, activeKindOf,
} from '../model/race.js'
import { HOUR, DAY, formatHm, formatDate, formatDateTime, formatYmd, agoText, ymdToEpochDay, epochDayToYmd, ymdOf } from '../model/time.js'
import { withAlpha, languageFill, LANGUAGE_COLORS_BRIGHT, GRADIENTS, PRESETS, presetLabel, schemeFor, dimColor, deepened, isDarkFor } from '../model/theme.js'
import { Dialog, Confirm, Seg, Switch, SettingRow, toast, copyText, share, Spinner, Flame, TypeIcon, TypeLabel, Icon, StreakBadge, MomentumPill } from './common.jsx'
import { Ring } from './Ring.jsx'
import { useCatalog, AnimalPhoto, AnimalCardView, RarityBadge, CardStage, Floaty, GlowPill } from './Zoo.jsx'
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
  const [me, setMe] = useState(false)
  if (!raceConfigured() || setup) return <RaceSetup onDone={() => setSetup(false)} first={!raceConfigured()} />
  return (
    <>
      {/* You - your profile, from the corner, like the phone. */}
      <div class="row" style="align-items:center"><h1 class="page-title grow">Social</h1><MyAvatar onClick={() => setMe(true)} /></div>
      <Seg options={[['race', 'Race'], ['friends', 'Friends']]} value={tab} onChange={setTab} />
      <div style="margin-top:12px">{tab === 'race' ? <Race onEditName={() => setSetup(true)} onOpenMe={() => setMe(true)} /> : <Friends />}</div>
      {me && <MyProfileSheet onClose={() => setMe(false)} />}
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

function Race({ onEditName, onOpenMe }) {
  const s = useStore()
  const [addMenu, setAddMenu] = useState(false)
  const [emptyMenu, setEmptyMenu] = useState(false)
  const status = useRaceStatus()
  const now = useNow(30000)
  const [create, setCreate] = useState(false)
  const [join, setJoin] = useState(false)
  const [settings, setSettings] = useState(false)
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
        <div class="grow clickable" style="min-width:0" onClick={onEditName}>
          <div class="title-medium ellipsis">Racing as {s.race.emoji ? `${s.race.emoji} ` : ''}{s.race.name}</div>
          <div class="muted ellipsis" style="font-size:11px">{activityText ? <span class="row"><Spinner /> {activityText}</span> : s.race.lastSync ? `Updated ${agoText(s.race.lastSync, now)} · tap to change name` : 'Tap to change name'}</div>
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
        <button class="icon-btn" title="Race settings" onClick={() => setSettings(true)}><Icon name="brush" /></button>
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
      {running.map((e) => <RaceCard key={e.id} event={e} now={now} onOpenMe={onOpenMe} />)}
      {/* Finished races keep their own area below everything still in play, each collapsed. */}
      {done.length > 0 && <>
        <div class="row" style="gap:6px;margin-top:24px"><Icon name="emoji_events" size={18} color="var(--tertiary)" /><span class="title-small">Completed races</span></div>
        {done.map((e) => <RaceCard key={e.id} event={e} now={now} completed />)}
      </>}
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

/** How long a racer's green tag is trusted without a fresh report (tracking reports every 5 min),
 *  so a tag from an app that stopped without saying goes rather than lingering. */
const ACTIVE_SHOW_MS = 12 * 60 * 1000
const isLiveAt = (st, now) => !!st.active && (!st.updatedAt || now - st.updatedAt < ACTIVE_SHOW_MS)
const GOLD = '#E8B93E', SILVER = '#B9C0CC', BRONZE = '#CB8D5E', LIVE_GREEN = '#4CAF50', TODAY_GREEN = '#43A047'
const STALE_REPORT_MS = HOUR

/** "12", "3.4" or "0.2" - whole percents once they're big enough to read, one decimal below. */
const percentText = (ms, goal) => { const p = goal > 0 ? (ms * 100) / goal : 0; return p >= 10 ? String(Math.floor(p)) : p.toFixed(1) }
const withEmoji = (emoji, name) => (emoji ? `${emoji} ${name}` : name)
const factDate = (ms, withTime) => {
  const d = new Date(ms)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric', ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}) })
}
/** A racer's best day - from the server when it says, else worked out from their days. */
function bestDayOf(st) {
  if (st.bestDayMillis > 0 && st.bestDay > 0) return [st.bestDay, st.bestDayMillis]
  let best = null
  for (const [k, v] of Object.entries(st.daily || {})) if (v > 0 && (!best || v > best[1])) best = [+k, v]
  return best
}

function RankMedal({ rank }) {
  const medal = rank === 1 ? GOLD : rank === 2 ? SILVER : rank === 3 ? BRONZE : null
  return <span class="rank-medal" style={medal ? { background: medal, color: '#1A1B3A' } : {}}>{rank}</span>
}

function LiveBadge({ kind }) {
  const type = kind === 'reading' ? 'READING' : kind === 'anki' ? 'ANKI' : kind === 'listening' ? 'PODCAST' : null
  return <span class="live-badge"><span class="pulse" />{type && <TypeIcon type={type} size={13} color={LIVE_GREEN} />}</span>
}

function StaleBadge({ since }) {
  const m = Math.floor(since / 60000)
  return <span class="stale-badge">{m < 60 ? `${m}m` : m < 48 * 60 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`}</span>
}

function CardTag({ text, color }) {
  return <span class="card-tag" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>{text}</span>
}

function IconBadge({ icon, color }) {
  return <span class="icon-badge" style={{ color, background: `color-mix(in srgb, ${color} 16%, transparent)` }}><Icon name={icon} size={22} /></span>
}

function SplitAmount({ type, color, millis, short }) {
  return <span class="split-amount"><TypeIcon type={type} size={14} color={color} />{short && millis > 5 * HOUR ? `${Math.floor(millis / HOUR)}h` : formatHm(millis)}</span>
}

/** A bar of [total] against [max], split into its listening, reading and Anki parts (one grey
 *  block when the split isn't known). */
function SplitBar({ listening, reading, anki = 0, total, max, colors, height = 10 }) {
  const m = Math.max(1, max)
  const filled = Math.min(1, total / m)
  const known = listening != null && reading != null
  const l = known ? Math.min(filled, listening / m) : 0
  const a = known ? Math.min(Math.max(0, filled - l), anki / m) : 0
  const r = known ? Math.max(0, filled - l - a) : 0
  return (
    <div class="split-bar" style={{ height }}>
      {known ? <>
        {listening > 0 && <div style={{ width: `${Math.max(l, 0.01) * 100}%`, background: colors.listening }} />}
        {reading > 0 && <div style={{ width: `${Math.max(r, 0.01) * 100}%`, background: colors.reading }} />}
        {anki > 0 && <div style={{ width: `${Math.max(a, 0.01) * 100}%`, background: colors.anki }} />}
      </> : total > 0 && <div style={{ width: `${Math.max(filled, 0.01) * 100}%`, background: 'color-mix(in srgb, var(--on-surface-variant) 60%, transparent)' }} />}
    </div>
  )
}

/** One person's line in the standings: medal, name, the figure, its split bar and the split in numbers. */
function StandingRow({ rank, st, isMe, goal, scaleMax, now, isLive, view, todayMax, colors, onClick }) {
  const todayKey = localTodayKey(st, now)
  const hasDaily = Object.keys(st.daily || {}).length > 0
  const today = isLive && hasDaily ? Math.min(st.millis, st.daily[todayKey] || 0) : null
  const todayReading = today != null && Object.keys(st.dailyReading || {}).length ? Math.min(today, st.dailyReading[todayKey] || 0) : null
  const todayAnki = today != null ? Math.min(today, (st.dailyAnki || {})[todayKey] || 0) : null
  const showingToday = view === 'today'
  const figure = showingToday ? today : st.millis
  const readingPart = showingToday ? todayReading : st.readingMillis
  const ankiPart = (showingToday ? todayAnki : st.ankiMillis) || 0
  const listeningPart = figure != null && readingPart != null ? Math.max(0, figure - readingPart - ankiPart) : null
  const since = now - (st.updatedAt || 0)
  return (
    <div class={`standing-row ${isMe ? 'me' : ''}`} onClick={onClick}>
      <RankMedal rank={rank} />
      <div class="grow" style="min-width:0;padding-left:10px">
        <div class="row" style="gap:0;align-items:center">
          <div class="row grow" style="gap:8px;min-width:0">
            <span class="st-name ellipsis" style={{ fontWeight: isMe ? 600 : 500 }}>{withEmoji(st.emoji, st.name)}</span>
            {isLiveAt(st, now) ? <LiveBadge kind={st.activeKind} /> : isLive && !isMe && st.updatedAt > 0 && since >= STALE_REPORT_MS && <StaleBadge since={since} />}
          </div>
          <div class="st-figure">
            <div class="v" style={figure == null ? { color: 'var(--on-surface-variant)' } : {}}>{figure != null ? formatHm(figure) : '–'}</div>
            {isLive && (showingToday
              ? <div class="sub">{formatHm(st.millis)} total</div>
              : today != null && <div class="sub" style={today > 0 ? { color: TODAY_GREEN, fontWeight: 600 } : {}}>+{formatHm(today)} today</div>)}
          </div>
        </div>
        <div style="margin-top:6px"><SplitBar listening={listeningPart} reading={readingPart} anki={ankiPart} total={figure || 0} max={showingToday ? todayMax : scaleMax} colors={colors} /></div>
        <div class="row split-line">
          {listeningPart != null && readingPart != null && <>
            <SplitAmount type="PODCAST" color={colors.listening} millis={listeningPart} short />
            <SplitAmount type="READING" color={colors.reading} millis={readingPart} short />
            {ankiPart > 0 && <SplitAmount type="ANKI" color={colors.anki} millis={ankiPart} short />}
          </>}
          <span class="spacer" />
          {!isLive && <span class="muted" style="font-size:11px">{percentText(st.millis, goal)}%</span>}
        </div>
      </div>
    </div>
  )
}

function Standings({ event, now, isLive, view, onPerson }) {
  const s = useStore()
  const me = s.race.userId
  const goal = event.goalHours * HOUR
  const leader = Math.max(0, ...event.standings.map((x) => x.millis))
  // Early in a long race everyone's a sliver of the goal, so bars measure against the leader until
  // they're halfway there.
  const scaleMax = leader <= 0 || leader * 2 >= goal ? Math.max(goal, leader, 1) : leader
  const todayMax = Math.max(0, ...event.standings.map((x) => (x.daily || {})[localTodayKey(x, now)] || 0))
  const colors = barColors(s)
  return (
    <div class="col" style="gap:6px;margin-top:14px">
      {event.standings.map((st, i) => (
        <StandingRow key={st.userId} rank={i + 1} st={st} isMe={st.userId === me} goal={goal} scaleMax={scaleMax} now={now} isLive={isLive} view={view} todayMax={todayMax} colors={colors} onClick={() => onPerson(st)} />
      ))}
    </div>
  )
}

function RaceFacts({ event, started }) {
  const tile = (icon, label, value) => (
    <div class="fact-tile">
      <div class="row" style="gap:5px"><Icon name={icon} size={14} color="var(--primary)" /><span class="k">{label.toUpperCase()}</span></div>
      <div class="v">{value}</div>
    </div>
  )
  return (
    <div class="race-facts">
      {tile('emoji_events', 'Goal', `${event.goalHours} h`)}
      {tile('flag', started ? 'Started' : 'Starts', factDate(event.startMillis, !started))}
      {event.endMillis != null && tile('sports_score', 'Ends', factDate(event.endMillis, true))}
    </div>
  )
}

function RaceCharts({ event, now }) {
  const hasDaily = event.standings.some((x) => Object.keys(x.daily || {}).length)
  const best = event.standings.map((x) => [x, bestDayOf(x)]).filter(([, b]) => b).sort((a, b) => b[1][1] - a[1][1])[0]
  return (
    <>
      {hasDaily && <><div class="label-medium muted" style="margin:16px 0 6px">Progress</div><ProgressChart event={event} now={now} /></>}
      {best && <div class="row best-day-line"><Icon name="bolt" size={16} color="var(--tertiary)" /><span class="ellipsis">Best day: {best[0].name}, {formatHm(best[1][1])} on {formatYmd(best[1][0])}</span></div>}
    </>
  )
}

/** [event] with your own standing's live tag taken from what this browser is tracking right now,
 *  rather than from your last report - so it's right the moment you start or stop. */
function withMyLive(event, me, entries, now) {
  const live = now >= event.startMillis && !(event.endMillis != null && now >= event.endMillis)
  if (!live || !event.standings.some((x) => x.userId === me)) return event
  const running = runningForRace(entries)
  return { ...event, standings: event.standings.map((x) => (x.userId === me ? { ...x, active: !!running, activeKind: activeKindOf(running), updatedAt: now } : x)) }
}

function RaceCard({ event: raw, now: tickNow, completed, onOpenMe }) {
  const s = useStore()
  const me = s.race.userId
  // Ticks every 30s for countdowns; your own live tag follows the store straight away.
  const now = Math.max(tickNow, Date.now())
  const event = withMyLive(raw, me, s.entries, now)
  const [menu, setMenu] = useState(false)
  const [person, setPerson] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [edit, setEdit] = useState(false)
  const [view, setView] = useState('total')
  const [expanded, setExpanded] = useState(false)
  const started = now >= event.startMillis
  const joined = event.standings.some((x) => x.userId === me)
  const isCreator = event.createdBy === me
  const canShowToday = started && event.standings.some((x) => Object.keys(x.daily || {}).length)
  const zonesDiffer = event.standings.some((x) => {
    try { return x.timeZone && new Date(new Date(now).toLocaleString('en-US', { timeZone: x.timeZone })).getTime() !== new Date(new Date(now).toLocaleString('en-US')).getTime() } catch { return false }
  })
  const outlook = raceOutlook(event, me, now)
  const dialogs = <>
    {person && <PersonSheet event={event} standing={event.standings.find((x) => x.userId === person.userId) || person} now={now} onClose={() => setPerson(null)} onOpenMe={onOpenMe && (() => { setPerson(null); onOpenMe() })} />}
    {edit && <EditRaceDialog event={event} onClose={() => setEdit(false)} />}
    {confirm === 'leave' && <Confirm title="Leave this race?" text={`You'll be removed from the standings of "${event.name}". You can join again while it's still running.`} confirmLabel="Leave" danger onConfirm={() => leaveEvent(event.id)} onClose={() => setConfirm(null)} />}
    {confirm === 'end' && <Confirm title="End this event?" text={`"${event.name}" will stop counting time for everyone, the standings will be locked, and it will move to Completed races.`} confirmLabel="End event" danger onConfirm={() => endEvent(event.id)} onClose={() => setConfirm(null)} />}
    {confirm === 'delete' && <Confirm title="Delete this race?" text={`"${event.name}" will be removed from your history in this browser. Your friends keep their own copies.`} confirmLabel="Delete" danger onConfirm={() => deleteCompleted(event.id)} onClose={() => setConfirm(null)} />}
    {confirm === 'deleteAll' && <Confirm title="Delete this race for everyone?" text={`"${event.name}" and everyone's scores in it will be removed from the server.`} confirmLabel="Delete" danger onConfirm={() => deleteEventForEveryone(event.id)} onClose={() => setConfirm(null)} />}
  </>

  if (completed) {
    const winner = event.standings[0]?.millis > 0 ? event.standings[0] : null
    const reason = { goal: 'goal reached', manual: 'ended early' }[event.endReason] || 'time ran out'
    const waiting = event.standings.filter((x) => !x.final).map((x) => x.name)
    return (
      <div class="race-card">
        <div class="row" style="gap:12px">
          <IconBadge icon="sports_score" color="var(--tertiary)" />
          <div class="race-title grow">{event.name}</div>
          <CardTag text="Completed" color="var(--tertiary)" />
        </div>
        <div class="muted small" style="margin-top:8px">Ended {formatDateTime(event.endMillis || 0)} · {reason}</div>
        {winner && (
          <div class="winner-row">
            <Icon name="emoji_events" size={26} color="var(--tertiary)" />
            <span class="grow ellipsis">{winner.name} won</span>
            <span>{formatHm(winner.millis)}</span>
          </div>
        )}
        {expanded && <>
          <Standings event={event} now={now} isLive={false} view="total" onPerson={setPerson} />
          <RaceCharts event={event} now={now} />
          {waiting.length > 0 && <div class="muted" style="font-size:11px;margin-top:10px">Still waiting for final totals from: {waiting.join(', ')}</div>}
        </>}
        <div class="row" style="margin-top:4px">
          <button class="btn text danger" onClick={() => setConfirm('delete')}>Delete</button>
          <span class="spacer" />
          {event.standings.length > 0 && <button class="btn text" onClick={() => setExpanded(!expanded)}>{expanded ? 'Hide results' : 'Show results'}<Icon name={expanded ? 'expand_less' : 'expand_more'} size={18} /></button>}
        </div>
        {dialogs}
      </div>
    )
  }

  const countdown = !started ? `Starts in ${remaining(event.startMillis - now)}` : event.endMillis != null ? `${remaining(event.endMillis - now)} left` : null
  return (
    <div class={`race-card ${started && joined ? 'live' : ''}`}>
      <div class="row" style="gap:12px">
        <IconBadge icon={started ? 'flag' : 'schedule'} color={started ? 'var(--primary)' : 'var(--on-surface-variant)'} />
        <div class="race-title grow">{event.name}</div>
        {countdown && <CardTag text={countdown} color={started ? 'var(--primary)' : 'var(--on-surface-variant)'} />}
      </div>
      <RaceFacts event={event} started={started} />
      {!event.standings.length ? <div class="muted small" style="margin-top:12px">Nobody has joined yet.</div> : <>
        {canShowToday && (
          <div class="standings-switch">
            {[['total', 'Total'], ['today', 'Today']].map(([k, l]) => <button key={k} class={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}
          </div>
        )}
        {canShowToday && view === 'today' && zonesDiffer && <div class="muted" style="font-size:11px;margin:6px 4px 0">Each person's own today, where they are.</div>}
        <Standings event={event} now={now} isLive={started} view={canShowToday ? view : 'total'} onPerson={setPerson} />
        {started && <RaceCharts event={event} now={now} />}
        {outlook && <OutlookNote o={outlook} event={event} />}
      </>}
      {!joined ? <button class="btn" style="width:100%;margin-top:14px" onClick={() => sync({ joinEventId: event.id })}>Join</button> : <>
        <div class="race-rule" />
        <div class="row" style="justify-content:flex-end">
          {event.code && (
            <button class="btn text grow" style="justify-content:flex-start" onClick={() => share(`Join my race "${event.name}" in Immersion Tracker: Social → Race → Join with a code → ${event.code}`)}>
              <Icon name="share" size={16} />Code {event.code}
            </button>
          )}
          <div style="position:relative">
            <button class="icon-btn muted" title="More options" onClick={() => setMenu(!menu)}><Icon name="more_vert" /></button>
            {menu && (
              <div class="menu" style="top:auto;bottom:46px" onMouseLeave={() => setMenu(false)}>
                <button onClick={() => { setMenu(false); setConfirm('leave') }}>Leave</button>
                {isCreator && <button onClick={() => { setMenu(false); setEdit(true) }}>Edit event</button>}
                {isCreator && <button style="color:var(--danger)" onClick={() => { setMenu(false); setConfirm('end') }}>End event</button>}
                {isCreator && <button style="color:var(--danger)" onClick={() => { setMenu(false); setConfirm('deleteAll') }}>Delete for everyone</button>}
              </div>
            )}
          </div>
        </div>
      </>}
      {dialogs}
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
  return <div class="col small" style="gap:2px;margin-top:14px;padding:10px 12px;border-radius:14px;background:color-mix(in srgb, var(--primary) 8%, transparent)">{lines.map((l, i) => <span key={i} class={i ? 'muted' : ''} style={i ? '' : 'font-weight:650'}>{l}</span>)}</div>
}

/** Everyone's running total, day by day, as lines. */
function ProgressChart({ event, now }) {
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

  // Drawn in a 600-wide viewBox; [k] turns screen px into its units, so the bubbles stay the
  // phone's size (10px, a 13px emoji) however wide the chart is.
  const svgRef = useRef(null)
  const [pxWidth, setPxWidth] = useState(300)
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const ro = new ResizeObserver(() => el.clientWidth && setPxWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const W = 600, H = 200
  const k = W / Math.max(1, pxWidth)
  const bubble = 10 * k
  // Inset by a bubble, so one at either end sits centred on its line without spilling out.
  const P = series.some((sr) => sr.st.emoji) ? bubble + 2 * k : 6
  const goal = event.goalHours * HOUR
  const maxY = Math.max(1, ...series.flatMap((x) => x.pts.slice(0, shownDays)), Math.min(goal, Math.max(...series.map((x) => x.st.millis)) * 1.1))
  const x = (i) => P + (days.length <= 1 ? 0 : (i / (days.length - 1)) * (W - 2 * P))
  const y = (v) => H - P - (v / maxY) * (H - 2 * P)
  return (
    <div>
      <div class="row" style="justify-content:flex-end;margin-top:-30px"><button class="btn text small" onClick={() => setReplay(replay == null ? 1 : null)}>{replay == null ? 'Replay' : 'Stop'}</button></div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style="width:100%;height:auto;margin-top:8px;overflow:visible">
        {goal <= maxY && <line x1={P} x2={W - P} y1={y(goal)} y2={y(goal)} stroke="var(--outline)" stroke-dasharray="6 6" />}
        {series.map((sr) => (
          <polyline key={sr.st.userId} fill="none" stroke={sr.color} stroke-width="3" stroke-linejoin="round" stroke-linecap="round"
            points={sr.pts.slice(0, shownDays).map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
        ))}
        {/* Each person's emoji rides the end of their line in a bubble of their line's colour -
            solid underneath, so a bubble on top covers the one below; the leader's on top.
            Someone tracking right now breathes green. No emoji: a dot. */}
        {[...series].reverse().map((sr) => {
          const i = Math.max(0, shownDays - 1)
          const cx = x(i), cy = y(sr.pts[i] || 0)
          if (!sr.st.emoji) return <circle key={'e' + sr.st.userId} cx={cx} cy={cy} r={3.6 * k} fill={sr.color} />
          return (
            <g key={'e' + sr.st.userId}>
              <circle cx={cx} cy={cy} r={bubble} fill="var(--bg)" />
              {isLiveAt(sr.st, now)
                ? <circle class="bubble-live" cx={cx} cy={cy} r={bubble} stroke-width={2 * k} />
                : <circle cx={cx} cy={cy} r={bubble} fill={withAlpha(sr.color, 0.22)} stroke={sr.color} stroke-width={1.5 * k} />}
              <text x={cx} y={cy} font-size={13 * k} text-anchor="middle" dominant-baseline="central">{sr.st.emoji}</text>
            </g>
          )
        })}
      </svg>
      <div class="row tiny muted"><span class="grow">{formatYmd(days[0])}</span>{goal <= maxY && <span>Goal {event.goalHours}h</span>}<span class="grow" style="text-align:right">{formatYmd(days[days.length - 1])}</span></div>
      {missing.length > 0 && <div class="muted tiny">No day-by-day data from {missing.map((m) => m.name).join(', ')} yet.</div>}
    </div>
  )
}

/** Everything about one person in one race, like the phone's PersonSheet: who and where they
 *  stand, their total against the goal, against you, being friends, their profile, how it splits,
 *  the numbers, and a bar per day. */
function PersonSheet({ event, standing: st, now, onClose, onOpenMe }) {
  const s = useStore()
  const me = s.race.userId
  const isMe = st.userId === me
  const rank = event.standings.findIndex((x) => x.userId === st.userId) + 1
  const goal = event.goalHours * HOUR
  const live = now >= event.startMillis && (event.endMillis == null || event.endMillis > now)
  const colors = barColors(s)
  const mine = event.standings.find((x) => x.userId === me)
  const isFriend = s.friends.friends.some((f) => f.userId === st.userId)
  const outgoing = s.friends.outgoing.some((f) => f.userId === st.userId)
  const incoming = s.friends.incoming.some((f) => f.userId === st.userId)
  const [busy, setBusy] = useState(false)
  const raw = s.race.profiles?.[st.userId]
  const profile = raw ? readProfile({ ...raw, userId: st.userId }) : null
  const hasDaily = Object.keys(st.daily || {}).length > 0
  const windowEnd = Math.min(now, event.endMillis ?? now)
  const elapsedDays = Math.max(1, (windowEnd - event.startMillis) / DAY)
  const best = bestDayOf(st)
  const listening = Math.max(0, st.millis - (st.readingMillis || 0) - (st.ankiMillis || 0))
  const pct = (v) => (st.millis > 0 ? Math.round((v * 100) / st.millis) : 0)
  let localTime = ''
  try {
    if (st.timeZone && !isMe) {
      const theirs = new Date(new Date(now).toLocaleString('en-US', { timeZone: st.timeZone })).getTime()
      const mineT = new Date(new Date(now).toLocaleString('en-US')).getTime()
      if (theirs !== mineT) localTime = new Date(now).toLocaleString(undefined, { timeZone: st.timeZone, weekday: 'short', hour: 'numeric', minute: '2-digit' })
    }
  } catch { /* unknown zone */ }
  const report = isLiveAt(st, now) ? null : !live && st.final ? 'Final total' : st.updatedAt > 0 ? `Last reported ${agoText(st.updatedAt, now)}` : null
  const friendAction = async (fn, ok) => {
    setBusy(true)
    try { await fn(); toast(ok) } catch (err) { toast(errorText(err) || 'Couldn\'t send the friend request') } finally { setBusy(false) }
  }
  const diff = mine ? st.millis - mine.millis : 0
  return (
    <Dialog onClose={onClose} actions={<button class="btn" onClick={onClose}>Close</button>}>
      <div class="row" style="gap:12px">
        <RankMedal rank={rank} />
        <div class="grow" style="min-width:0">
          <div class="row" style="gap:8px"><span class="title-large ellipsis">{withEmoji(st.emoji, st.name)}</span>{isLiveAt(st, now) && <LiveBadge kind={st.activeKind} />}</div>
          <div class="muted small">{ordinal(rank)} of {event.standings.length} in {event.name}</div>
        </div>
      </div>
      <div class="person-total">{formatHm(st.millis)}</div>
      <div class="muted">{percentText(st.millis, goal)}% of the {event.goalHours}h goal</div>
      {localTime && <div class="muted" style="font-size:11px;margin-top:2px">{localTime} where they are</div>}
      {report && <div class="muted" style="font-size:11px;margin-top:2px">{report}</div>}
      {!isMe && mine && (
        <div style={{ marginTop: 8, fontWeight: 500, color: diff > 0 ? 'var(--danger)' : 'var(--primary)' }}>
          {diff > 0 ? `${formatHm(diff)} ahead of you` : diff < 0 ? `${formatHm(-diff)} behind you` : 'Tied with you'}
        </div>
      )}
      {/* Your own: everything about your profile is one tap away. */}
      {isMe && onOpenMe && <div class="row" style="margin-top:12px"><button class="btn outline" onClick={onOpenMe}><Icon name="edit" size={18} />Edit my profile</button></div>}
      {!isMe && (
        <div class="row" style="margin-top:12px">
          {isFriend ? <span class="label-large" style="color:var(--primary)">Friends</span>
            : incoming ? <button class="btn" onClick={() => friendAction(() => respondFriend(st.userId, true), `You and ${st.name} are now friends!`)}>Accept friend request</button>
              : outgoing ? <span class="label-large muted">Friend request sent</span>
                : <button class="btn outline" disabled={busy} onClick={() => friendAction(() => addFriendById(st.userId), `Friend request sent to ${st.name}`)}>{busy ? 'Sending…' : 'Add friend'}</button>}
        </div>
      )}
      {profile && <>
        <div class="title-small" style="margin:24px 0 8px">Profile</div>
        <ProfileFrame p={profile}><ProfileSections p={profile} /></ProfileFrame>
      </>}
      <div style="margin-top:20px">
        <SplitBar listening={listening} reading={st.readingMillis || 0} anki={st.ankiMillis || 0} total={st.millis} max={st.millis} colors={colors} height={12} />
        <div class="row split-line" style="gap:4px;margin-top:6px">
          <SplitAmount type="PODCAST" color={colors.listening} millis={listening} /><span class="muted" style="font-size:11px">Listening · {pct(listening)}%</span>
          <span style="width:12px" />
          <SplitAmount type="READING" color={colors.reading} millis={st.readingMillis || 0} /><span class="muted" style="font-size:11px">Reading · {pct(st.readingMillis || 0)}%</span>
        </div>
        {(st.ankiMillis > 0 || st.ankiBankedMillis > 0) && (
          <div class="row split-line" style="gap:4px;margin-top:6px">
            <SplitAmount type="ANKI" color={colors.anki} millis={st.ankiMillis || 0} />
            <span class="muted" style="font-size:11px">{st.ankiBankedMillis > 0 ? `counted · ${formatHm(st.ankiBankedMillis)} banked` : 'counted'}</span>
          </div>
        )}
      </div>
      <div class="person-stats">
        {live && hasDaily && <StatTile label={localTime ? 'Their today' : 'Today'} value={formatHm((st.daily || {})[localTodayKey(st, now)] || 0)} />}
        <StatTile label="Daily average" value={formatHm(st.millis / elapsedDays)} />
        {hasDaily && <StatTile label="Days active" value={`${Object.values(st.daily).filter((v) => v > 0).length} of ${Math.ceil(elapsedDays)}`} />}
      </div>
      {best && <div style="margin-top:10px"><StatTile label="Best day" value={`${formatHm(best[1])} on ${formatYmd(best[0])}`} /></div>}
      <div class="title-small" style="margin:24px 0 8px">Day by day</div>
      {hasDaily ? <DayBars event={event} st={st} now={now} colors={colors} best={best} /> : <div class="muted small">Day-by-day totals appear once this person updates the app.</div>}
    </Dialog>
  )
}

function StatTile({ label, value }) {
  return <div class="stat-tile"><div class="k">{label}</div><div class="v ellipsis">{value}</div></div>
}

/** A bar per day of the race (the last 60), split into listening, reading and Anki when known;
 *  their best day marked with a dot. */
function DayBars({ event, st, now, colors, best }) {
  const first = Math.min(ymdToEpochDay(+localTodayKey(st, event.startMillis)), ...Object.keys(st.daily).map((k) => ymdToEpochDay(+k)))
  const last = Math.max(ymdToEpochDay(+localTodayKey(st, Math.min(now, event.endMillis ?? now))), ...Object.keys(st.daily).map((k) => ymdToEpochDay(+k)))
  const days = []
  for (let d = Math.max(first, last - 59); d <= last; d++) days.push(epochDayToYmd(d))
  const values = days.map((k) => st.daily[k] || 0)
  const max = Math.max(1, ...values)
  const split = Object.keys(st.dailyReading || {}).length > 0
  return (
    <div>
      <div class="muted" style="font-size:11px">{formatHm(max)}</div>
      <div class="day-bars">
        {days.map((k, i) => {
          const v = values[i]
          const reading = split ? Math.min(v, st.dailyReading[k] || 0) : 0
          const anki = Math.min(v - reading, (st.dailyAnki || {})[k] || 0)
          const listening = v - reading - anki
          return (
            <div key={k} class="day-bar" title={`${formatYmd(+k)}: ${formatHm(v)}`}>
              {best && +k === best[0] && v > 0 && <span class="best-dot" style={{ bottom: `calc(${(v / max) * 100}% + 3px)` }} />}
              <div class="stack" style={{ height: `${(v / max) * 100}%` }}>
                {split ? <>
                  {anki > 0 && <div style={{ flex: anki, background: colors.anki }} />}
                  {reading > 0 && <div style={{ flex: reading, background: colors.reading }} />}
                  {listening > 0 && <div style={{ flex: listening, background: colors.listening }} />}
                </> : <div style="flex:1;background:color-mix(in srgb, var(--on-surface-variant) 60%, transparent)" />}
              </div>
            </div>
          )
        })}
      </div>
      <div class="row muted" style="font-size:11px;margin-top:4px"><span class="grow">{formatYmd(+days[0])}</span><span>{formatYmd(+days[days.length - 1])}</span></div>
    </div>
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
          <div class="col" style="gap:8px">{friends.map((p) => (
            <FriendRow key={p.userId} p={p} onClick={() => setOpen(p)} />          ))}</div>
        )}
      </div>

      {open && <ProfileDialog profile={open} onClose={() => setOpen(null)} onRemove={() => setRemove(open)} />}
      {remove && <Confirm title={`Remove ${remove.name} as a friend?`} confirmLabel="Remove friend" danger onConfirm={() => { setOpen(null); run(() => removeFriend(remove.userId)) }} onClose={() => setRemove(null)} />}
    </div>
  )
}

/** Your picture in Social's corner: your emoji (or initial) on your banner colour, like the phone's
 *  MyProfileAvatar. */
function MyAvatar({ onClick }) {
  const s = useStore()
  const stops = (s.friends.banner || '').split(',').filter(Boolean)
  const fill = stops.length ? `linear-gradient(135deg, ${(stops.length === 1 ? [stops[0], stops[0]] : stops).join(', ')})` : 'linear-gradient(135deg, var(--primary), var(--tertiary))'
  const emoji = (s.race.emoji || '').trim()
  return (
    <button class="my-avatar" title="Your profile" style={{ background: fill, fontSize: emoji ? 22 : 18 }} onClick={onClick}>
      {emoji || (s.race.name || '🙂').slice(0, 1).toUpperCase()}
    </button>
  )
}

/** A friend in the list, like the phone's FriendRow: a soft wash of their banner colour with a
 *  matching outline, their picture, name (and golden Momentum), animal on display and when they
 *  last updated. */
function FriendRow({ p, onClick }) {
  const catalog = useCatalog()
  const light = !isDarkFor(getState().settings.uiColorPreset)
  const cols = (p.banner || p.color || '').split(',').map((c) => c.trim()).filter((c) => /^#[0-9a-f]{6}$/i.test(c))
  const cs = cols.length ? (cols.length === 1 ? [cols[0], cols[0]] : cols) : ['#6FA8C9', '#6FA8C9']
  const trophy = p.trophy && catalog?.find((a) => a.id === p.trophy)
  const fill = `linear-gradient(90deg, ${cs.map((c) => withAlpha(c, light ? 0.16 : 0.12)).join(', ')})`
  const edge = `linear-gradient(90deg, ${cs.map((c) => withAlpha(c, light ? 1 : 0.6)).join(', ')})`
  return (
    <div class="friend-row" onClick={onClick} style={{ background: `${fill} padding-box, linear-gradient(var(--bg), var(--bg)) padding-box, ${edge} border-box` }}>
      <ProfilePicture p={p} color={cs[0]} />
      <div class="grow" style="min-width:0;padding-left:12px">
        <div class="row" style="gap:8px"><span class="title-medium ellipsis" style="font-weight:600">{p.name}</span>{p.goldenDays >= 3 && <MomentumPill days={p.goldenDays} progress={1} />}</div>
        <div class="muted ellipsis" style="font-size:12px">{[trophy?.name, p.updatedAt ? agoText(p.updatedAt) : null].filter(Boolean).join(' · ')}</div>
      </div>
      <Icon name="chevron_right" color={cs[0]} />
    </div>
  )
}

/** Your own profile, like the phone's profile screen: your code, your profile as friends see it,
 *  then everything about it - name, emoji, banner, background, picture and what you share. */
function MyProfileSheet({ onClose }) {
  const s = useStore()
  const light = !isDarkFor(s.settings.uiColorPreset)
  const [name, setName] = useState(s.race.name)
  const [open, setOpen] = useState(null) // 'emoji' | 'banner' | 'background'
  const share = s.friends.share
  const push = () => { refreshFriends().catch(() => {}); sync() }
  const setF = (fn) => { update(fn); push() }
  const me = readProfile({ userId: s.race.userId, name: s.race.name, emoji: s.race.emoji, color: s.race.chartColor, code: s.friends.code, updatedAt: Date.now(), profile: buildProfileBody() })
  const catalog = useCatalog()
  const onDisplay = s.zoo.trophyId && catalog?.find((a) => a.id === s.zoo.trophyId)
  const changed = name.trim() && name.trim() !== s.race.name
  const swatchesFor = (current, onPick) => (
    <div class="swatches" style="padding:4px 4px 8px">
      {[...LANGUAGE_COLORS_BRIGHT.map((c) => [c]), ...GRADIENTS].map((g) => {
        const v = g.join(',')
        return <button key={v} class={`swatch ${current === v ? 'on' : ''}`} style={{ background: g.length > 1 ? `linear-gradient(135deg, ${g.join(', ')})` : g[0] }} onClick={() => onPick(v)} />
      })}
    </div>
  )
  const Fold = ({ id, title, value }) => (
    <button class="fold-row" onClick={() => setOpen(open === id ? null : id)}>
      <span class="title-medium grow" style="font-weight:600;text-align:left">{title}</span>{value}<Icon name={open === id ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} />
    </button>
  )
  const bannerStops = (s.friends.banner || '').split(',').filter(Boolean)
  return (
    <Dialog title="Your profile" onClose={onClose} actions={<button class="btn" onClick={onClose}>Done</button>}>
      <div class="card row" style="margin:0 0 12px">
        <div class="grow clickable" onClick={() => s.friends.code && copyText(s.friends.code, 'Friend code copied')}>
          <div class="muted small">Your friend code · tap to copy</div>
          <div style="font-family:ui-monospace,monospace;font-size:28px;font-weight:900;letter-spacing:4px">{s.friends.code || '······'}</div>
        </div>
        <button class="icon-btn" title="Share code" disabled={!s.friends.code} onClick={() => share(`Add me as a friend in Immersion Tracker (Social → Friends): ${s.friends.code}`)}><Icon name="share" /></button>
      </div>
      <ProfileFrame p={me}><ProfileBanner p={me} light={light} /><ProfileSections p={me} /></ProfileFrame>

      <div class="row" style="margin-top:16px;gap:8px">
        <label class="field grow">Name<input class="input" value={name} maxLength={24} onInput={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && changed && setF((st) => { st.race.name = name.trim() })} /></label>
        {changed && <button class="btn text" style="margin-top:18px" onClick={() => setF((st) => { st.race.name = name.trim() })}>Save</button>}
      </div>
      <Fold id="emoji" title="Emoji" value={<span style="font-size:22px">{s.race.emoji || '—'}</span>} />
      {open === 'emoji' && <div class="swatches" style="padding:4px 4px 8px">{EMOJIS.map((e) => <button key={e} class={`swatch ${s.race.emoji === e ? 'on' : ''}`} style="background:var(--c-high);font-size:18px" onClick={() => setF((st) => { st.race.emoji = st.race.emoji === e ? '' : e })}>{e}</button>)}</div>}
      <Fold id="banner" title="Banner" value={<span class="banner-swatch" style={{ background: bannerStops.length ? `linear-gradient(90deg, ${(bannerStops.length === 1 ? [bannerStops[0], bannerStops[0]] : bannerStops).join(', ')})` : 'linear-gradient(90deg, var(--primary), var(--tertiary))' }} />} />
      {open === 'banner' && <>
        <div style="padding:4px"><button class={`chip ${!s.friends.banner ? 'on' : ''}`} onClick={() => setF((st) => { st.friends.banner = '' })}>None</button></div>
        {swatchesFor(s.friends.banner, (v) => setF((st) => { st.friends.banner = v }))}
      </>}
      <Fold id="background" title="Profile background" value={<span class="banner-swatch" style={{ background: s.friends.background?.startsWith('theme:') ? schemeFor(s.friends.background.slice(6), isDarkFor(s.friends.background.slice(6)))['--bg'] : s.friends.background ? `linear-gradient(90deg, ${s.friends.background.split(',').join(', ')})` : 'var(--surface-variant)' }} />} />
      {open === 'background' && <>
        <div class="label-large" style="margin:4px">Themes</div>
        <div class="chips scroll" style="padding:4px">
          <button class={`chip ${!s.friends.background ? 'on' : ''}`} onClick={() => setF((st) => { st.friends.background = '' })}>None</button>
          {PRESETS.map((pr) => <button key={pr} class={`chip ${s.friends.background === 'theme:' + pr ? 'on' : ''}`} onClick={() => setF((st) => { st.friends.background = 'theme:' + pr })}>{presetLabel(pr)}</button>)}
        </div>
        <div class="label-large" style="margin:10px 4px 4px">Colours</div>
        {swatchesFor(s.friends.background, (v) => setF((st) => { st.friends.background = v }))}
      </>}

      <div class="title-medium" style="font-weight:600;margin:16px 4px 6px">Your picture</div>
      <div class="row" style="gap:10px">
        <button class={`avatar-choice ${s.friends.avatar === 'emoji' ? 'on' : ''}`} onClick={() => setF((st) => { st.friends.avatar = 'emoji' })}>
          <span class="pp-emoji" style="width:40px;height:40px;background:var(--surface-variant);font-size:20px">{s.race.emoji || (s.race.name || '🙂').slice(0, 1).toUpperCase()}</span>Emoji
        </button>
        <button class={`avatar-choice ${s.friends.avatar !== 'emoji' ? 'on' : ''}`} onClick={() => setF((st) => { st.friends.avatar = '' })}>
          {onDisplay ? <span class="pp-animal" style={{ width: 40, height: 40, borderRadius: 10, borderColor: RARITY_COLOR[onDisplay.rarity] }}><AnimalPhoto animal={onDisplay} /></span> : <span class="pp-emoji" style="width:40px;height:40px;border-radius:10px;background:var(--surface-variant);font-size:20px">🦒</span>}Animal on display
        </button>
      </div>
      {s.friends.avatar !== 'emoji' && !s.zoo.trophyId && <div class="muted small" style="margin:6px 4px">Put an animal on display in your Zoo to use it - until then friends see your emoji.</div>}

      <div class="title-medium" style="font-weight:600;margin:16px 4px 2px">What you share</div>
      <div class="muted small" style="margin:0 4px 6px">Your friends - and anyone in a race with you - see these on your profile.</div>
      {[['trophy', 'Trophy animal'], ['zoo', 'Animal collection'], ['rings', "Today's rings"], ['goals', 'Daily goals'], ['streaks', 'Streaks'], ['records', 'Records']].map(([k, l]) => (
        <SettingRow key={k} title={l}><Switch checked={share[k]} onChange={(v) => setF((st) => { st.friends.share[k] = v })} /></SettingRow>
      ))}
    </Dialog>
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
    <div>
      <div class="row" style="margin-bottom:6px">
        <div class="title-medium grow" style="font-weight:400">Today</div>
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
              ? <Ring size={64} progress={progress} color={color} stops={stops} ringStyle={ringStyle || 'CLASSIC'} iconType={type} iconColor={iconColor} light={light} />
              : <div style="width:64px;height:64px;display:grid;place-items:center"><TypeIcon type={type} size={40} color={color} /></div>}
            {goal != null && <span class="val">{formatHm(today * 60000)} / {formatHm(goal * 60000, true)}</span>}
            {streak && <StreakBadge streak={{ current: streak.current, record: streak.record }} />}
          </div>
        )
      })}
    </div>
  )
}

/** Someone's profile, laid out like the phone's ProfileSheet: their banner (picture and name on a
 *  wash of their banner colour), the animal on display, their zoo, Today's goal cards, records,
 *  and when it was last updated - on their chosen background. */
/** Someone's profile in a dialog, like the phone's ProfileSheet: their banner, then the sections. */
export function ProfileDialog({ profile: p, onClose, onRemove }) {
  const light = !isDarkFor(getState().settings.uiColorPreset)
  return (
    <Dialog onClose={onClose} actions={<>{onRemove && <button class="btn text danger" onClick={onRemove}>Remove friend</button>}<span class="spacer" /><button class="btn" onClick={onClose}>Close</button></>}>
      <ProfileFrame p={p}>
        <ProfileBanner p={p} light={light} />
        <ProfileSections p={p} />
      </ProfileFrame>
    </Dialog>
  )
}

/** A profile's chosen background: one of the app's themes, or a wash of a colour or gradient that
 *  also tints the blocks inside. */
function ProfileFrame({ p, children }) {
  const light = !isDarkFor(getState().settings.uiColorPreset)
  const preset = p.background?.startsWith('theme:') ? p.background.slice(6) : null
  const theme = preset ? schemeFor(preset, isDarkFor(preset)) : null
  const wash = p.background && !preset ? p.background.split(',').map((c) => c.trim()).filter(Boolean) : null
  const tint = wash ? wash[Math.floor(wash.length / 2)] : null
  const style = theme
    ? { ...theme, background: 'var(--bg)', color: 'var(--on-surface)', borderRadius: 22, padding: 12 }
    : wash
      ? { background: `linear-gradient(180deg, ${wash.map((c) => withAlpha(c, 0.28)).join(', ')})`, borderRadius: 22, padding: 12,
          '--profile-block': `color-mix(in srgb, color-mix(in srgb, ${tint} 18%, var(--block)) ${light ? 90 : 55}%, black)` }
      : {}
  return <div class="profile-page" style={style}>{children}</div>
}

/** The animal on display, their zoo, Today's goal cards, records and when it was updated. */
function ProfileSections({ p }) {
  const catalog = useCatalog()
  const [all, setAll] = useState(false)
  const [open, setOpen] = useState(null)
  const trophy = p.trophy && catalog?.find((a) => a.id === p.trophy)
  const cert = (id) => {
    const c = p.certs?.[id]
    return c ? { hourMark: c[0] >= 0 ? c[0] : null, languageName: c[1] || null, languageColor: c[2] || null, mediaTitle: c[3] || null, foil: c[4] === 1 } : null
  }
  const ORDER = ['RAINBOW', 'ORANGE', 'PURPLE', 'BLUE', 'GREEN']
  const zoo = p.zoo && catalog ? Object.entries(p.zoo).map(([id, n]) => [catalog.find((a) => a.id === id), n]).filter(([a]) => a)
    .sort((a, b) => ORDER.indexOf(a[0].rarity) - ORDER.indexOf(b[0].rarity) || a[0].name.toLowerCase().localeCompare(b[0].name.toLowerCase())) : []
  return (
    <div class="col" style="gap:16px">
      {trophy && p.shows.trophy && (
        <button class="trophy-card" style={{ '--rarity': RARITY_COLOR[trophy.rarity] }} onClick={() => setOpen(trophy)}>
          <div class="photo"><AnimalPhoto animal={trophy} /></div>
          <div class="grow" style="min-width:0;text-align:left">
            <div class="row muted" style="gap:4px;font-size:12px;font-weight:500"><Icon name="emoji_events" size={16} color={RARITY_COLOR[trophy.rarity]} />On display</div>
            <div class="title-medium" style="font-weight:700">{trophy.name}</div>
            <div style="padding-top:4px"><RarityBadge rarity={trophy.rarity} /></div>
          </div>
        </button>
      )}
      {zoo.length > 0 && (
        <div class="profile-card">
          <div class="pc-title">Zoo · {zoo.length}</div>
          <div class="profile-zoo">
            {(all ? zoo : zoo.slice(0, 12)).map(([a, n]) => (
              <button key={a.id} class="tile-animal" style={{ borderColor: RARITY_COLOR[a.rarity] }} title={a.name} onClick={() => setOpen(a)}>
                <AnimalPhoto animal={a} />{cert(a.id)?.foil && <div class="foil-sheen" />}{n > 1 && <span class="count">×{n}</span>}
              </button>
            ))}
          </div>
          {zoo.length > 12 && <button class="btn text small" onClick={() => setAll(!all)}>{all ? 'Show fewer' : 'Show all'}</button>}
        </div>
      )}
      {p.languages.length > 0 && (p.shows.rings || p.shows.goals || p.shows.streaks) && <ProfileTodayCard p={p} />}
      {p.records && (
        <div class="profile-card">
          <div class="pc-title">Records</div>
          <div class="record-tiles">
            <RecordTile label="All-time immersion" value={formatHm(p.records.totalMillis)} />
            <RecordTile label="Longest streak" value={`${p.records.longestStreak}d`} />
            <RecordTile label="Best day" value={p.records.bestDay > 0 ? `${formatHm(p.records.bestDayMillis)} · ${formatYmd(p.records.bestDay)}` : '-'} />
            <RecordTile label="Days tracked" value={String(p.records.daysTracked)} />
          </div>
        </div>
      )}
      {p.updatedAt > 0 && <div class="muted" style="font-size:11px;font-weight:500;letter-spacing:.5px">Updated {agoText(p.updatedAt)}</div>}
      {open && (
        <CardStage rarity={open.rarity} onClose={() => setOpen(null)}>
          <Floaty><AnimalCardView animal={open} cert={cert(open.id)} timesFound={p.zoo?.[open.id] || 1} /></Floaty>
          <GlowPill rarity={open.rarity} onClick={() => setOpen(null)}>Close</GlowPill>
        </CardStage>
      )}
    </div>
  )
}

/** The top of a profile: their picture and name on a wash of their banner colour (or gradient),
 *  else their race colour, else the theme's. */
function ProfileBanner({ p, light }) {
  const colors = (p.banner || p.color || '').split(',').map((c) => c.trim()).filter((c) => /^#[0-9a-f]{6}$/i.test(c))
  const cs = colors.length ? (colors.length === 1 ? [colors[0], colors[0]] : colors) : null
  const fill = cs ? `linear-gradient(90deg, ${cs.map((c) => withAlpha(c, light ? 0.4 : 0.5)).join(', ')})` : 'linear-gradient(color-mix(in srgb, var(--primary) 45%, transparent), color-mix(in srgb, var(--primary) 45%, transparent))'
  const edge = cs ? `linear-gradient(90deg, ${cs.map((c) => withAlpha(c, 0.8)).join(', ')})` : 'linear-gradient(var(--primary), var(--primary))'
  return (
    <div class="profile-banner" style={{ background: `${fill} padding-box, linear-gradient(var(--bg), var(--bg)) padding-box, ${edge} border-box` }}>
      <ProfilePicture p={p} color={cs ? cs[0] : null} />
      <div class="name ellipsis">{p.name}</div>
    </div>
  )
}

/** Their picture as friends see it: the animal on display, else their race emoji in a circle. */
function ProfilePicture({ p, color, size = 48 }) {
  const catalog = useCatalog()
  const animal = p.avatar !== 'emoji' && p.trophy && catalog ? catalog.find((a) => a.id === p.trophy) : null
  if (animal) return <div class="pp-animal" style={{ width: size, height: size, borderColor: RARITY_COLOR[animal.rarity] }}><AnimalPhoto animal={animal} /></div>
  return <div class="pp-emoji" style={{ width: size, height: size, background: color ? withAlpha(color, 0.3) : 'color-mix(in srgb, var(--primary) 30%, transparent)' }}>{(p.emoji || '').trim() || (p.name || '?').slice(0, 1).toUpperCase()}</div>
}

function RecordTile({ label, value }) {
  return <div class="record-tile"><div class="k">{label}</div><div class="v ellipsis">{value}</div></div>
}

export { RarityBadge }
