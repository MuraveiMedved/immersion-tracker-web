import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useStore, useNow, update, getState } from '../store.js'
import {
  sync, syncIfStale, createEvent, joinByCode, leaveEvent, endEvent, editEvent, deleteEventForEveryone, deleteCompleted, visibleEvents, raceOutlook,
  raceStatus, onRaceStatus, errorText, ordinal, localTodayKey, refreshFriends, addFriendByCode, addFriendById, respondFriend, removeFriend,
  readProfile, buildProfileBody, raceConfigured, DEFAULT_RACE_URL, runningForRace, activeKindOf,
} from '../model/race.js'
import { GOLDEN_DAYS } from '../model/rules.js'
import { HOUR, DAY, formatHm, formatDate, formatDateTime, formatYmd, agoText, ymdToEpochDay, epochDayToYmd, ymdOf, epochDayStart, goalDayStart } from '../model/time.js'
import { withAlpha, languageFill, LANGUAGE_COLORS_BRIGHT, GRADIENTS, PRESETS, presetLabel, schemeFor, dimColor, deepened, isDarkFor } from '../model/theme.js'
import { Dialog, Confirm, Seg, Switch, SettingRow, toast, copyText, share, Spinner, Bolt, TypeIcon, TypeLabel, Icon, StreakBadge, MomentumPill, displayEmoji, firstGrapheme } from './common.jsx'
import { Ring } from './Ring.jsx'
import { useCatalog, AnimalPhoto, AnimalCardView, RarityBadge, CardStage, Floaty, GlowPill, FoilSheen } from './Zoo.jsx'
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

/** Social (RaceScreen.kt): the races, with Friends as a page of its own - opened from the button
 *  beside your profile in the header (the Social tab's own icon, with friend requests waiting). */
export function Social() {
  const s = useStore()
  const [friends, setFriends] = useState(false)
  const [setup, setSetup] = useState(false)
  const [me, setMe] = useState(false)
  if (!raceConfigured() || setup) return <RaceSetup onDone={() => setSetup(false)} first={!raceConfigured()} />
  if (friends) {
    return (
      <>
        <div class="row" style="align-items:center;gap:4px;margin-bottom:16px">
          <button class="icon-btn" title="Back" onClick={() => setFriends(false)}><Icon name="arrow_back" /></button>
          <h1 class="page-title grow" style="margin:0">Friends</h1>
        </div>
        <Friends />
      </>
    )
  }
  const requests = s.friends.incoming.length
  return (
    <>
      {/* Friends, then you - your profile, from the corner, like the phone. */}
      <div class="row" style="align-items:center;gap:4px;margin-bottom:16px">
        <h1 class="page-title grow" style="margin:0">Social</h1>
        <button class="icon-btn badged" title="Friends" onClick={() => setFriends(true)}>
          <Icon name="groups" />{requests > 0 && <span class="badge">{requests}</span>}
        </button>
        <MyAvatar onClick={() => setMe(true)} />
      </div>
      <Race onEditName={() => setSetup(true)} onOpenMe={() => setMe(true)} />
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
        <input class="input" style="max-width:200px" placeholder="Or type any emoji" value={EMOJIS.includes(emoji) ? '' : emoji} onInput={(e) => setEmoji(firstGrapheme(e.currentTarget.value))} />
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
    syncIfStale() // joins the sync started as the app came into focus, if there is one
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
          <div class="title-medium ellipsis">Racing as {s.race.emoji ? `${displayEmoji(s.race.emoji)} ` : ''}{s.race.name}</div>
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
        {done.map((e) => <RaceCard key={e.id} event={e} now={now} completed onOpenMe={onOpenMe} />)}
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
const withEmoji = (emoji, name) => (emoji ? `${displayEmoji(emoji)} ${name}` : name)
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
        {/* Which colour is which is said once, by RaceBarLegend; the exact amounts are on the racer's sheet. */}
        {!isLive && <div class="muted" style="font-size:11px;text-align:right;margin-top:3px;height:16px">{percentText(st.millis, goal)}%</div>}
      </div>
    </div>
  )
}

/** One line above the standings saying which colour on the bars is which kind of immersion, for
 *  just the kinds anyone in this race has - so the rows needn't repeat it. */
function RaceBarLegend({ event, colors }) {
  const kinds = [
    event.standings.some((x) => x.millis - (x.readingMillis || 0) - (x.ankiMillis || 0) > 0) && ['PODCAST', 'Listening', colors.listening],
    event.standings.some((x) => x.readingMillis > 0) && ['READING', 'Reading', colors.reading],
    event.standings.some((x) => x.ankiMillis > 0) && ['ANKI', 'Anki', colors.anki],
  ].filter(Boolean)
  if (!kinds.length) return null
  return (
    <div class="row race-legend">
      {kinds.map(([type, label, color]) => <span key={type} class="row" style="gap:3px"><TypeIcon type={type} size={14} color={color} />{label}</span>)}
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
    <>
    <RaceBarLegend event={event} colors={colors} />
    <div class="col" style="gap:6px;margin-top:8px">
      {event.standings.map((st, i) => (
        <StandingRow key={st.userId} rank={i + 1} st={st} isMe={st.userId === me} goal={goal} scaleMax={scaleMax} now={now} isLive={isLive} view={view} todayMax={todayMax} colors={colors} onClick={() => onPerson(st)} />
      ))}
    </div>
    </>
  )
}

/** The race's key facts as one small line under its name: "Goal 1000 h · Started Oct 3 · Ends ...".
 *  As tiles they took a whole band of the card above the standings. */
function RaceFacts({ event, started }) {
  const parts = [`Goal ${event.goalHours} h`, `${started ? 'Started' : 'Starts'} ${factDate(event.startMillis, !started)}`]
  if (event.endMillis != null) parts.push(`Ends ${factDate(event.endMillis, true)}`)
  return <div class="race-facts-line">{parts.join('  ·  ')}</div>
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
  // You open your own profile (to see and edit it), the same sheet as Social's corner picture.
  const openPerson = (st) => (st.userId === me && onOpenMe ? onOpenMe() : setPerson(st))
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
          <Standings event={event} now={now} isLive={false} view="total" onPerson={openPerson} />
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
        <div class="grow" style="min-width:0">
          <div class="race-title">{event.name}</div>
          <RaceFacts event={event} started={started} />
        </div>
        {countdown && <CardTag text={countdown} color={started ? 'var(--primary)' : 'var(--on-surface-variant)'} />}
      </div>
      {outlook && <OutlookSummary o={outlook} />}
      {!event.standings.length ? <div class="muted small" style="margin-top:12px">Nobody has joined yet.</div> : <>
        {canShowToday && (
          <div class="standings-switch">
            {[['total', 'Total'], ['today', 'Today']].map(([k, l]) => <button key={k} class={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}
          </div>
        )}
        {canShowToday && view === 'today' && zonesDiffer && <div class="muted" style="font-size:11px;margin:6px 4px 0">Each person's own today, where they are.</div>}
        <Standings event={event} now={now} isLive={started} view={canShowToday ? view : 'total'} onPerson={openPerson} />
        {started && <RaceCharts event={event} now={now} />}
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
  const emoji = displayEmoji(standing?.emoji || prof?.emoji || '')
  const animal = prof && prof.avatar !== 'emoji' && prof.trophy && catalog ? catalog.find((a) => a.id === prof.trophy) : null
  return (
    <div class="avatar" style={{ width: size, height: size, fontSize: size * 0.5, border: animal ? `2px solid ${RARITY_COLOR[animal.rarity]}` : undefined }}>
      {animal ? <AnimalPhoto animal={animal} /> : emoji || (standing?.name || prof?.name || '?').slice(0, 1).toUpperCase()}
    </div>
  )
}

/** "Where do I stand": my place and the gap to whoever's next, as a compact strip at the top of a
 *  race's card. */
function OutlookSummary({ o }) {
  const gap = o.participants < 2 ? 'Nobody else has joined yet'
    : o.ahead ? (o.gapToAhead === 0 ? `Tied with ${o.ahead.name}` : `${formatHm(o.gapToAhead)} to pass ${o.ahead.name}`)
      : o.behind ? `Leading ${o.behind.name} by ${formatHm(o.leadOverBehind)}` : null
  return (
    <div class="outlook-summary row">
      <Icon name="leaderboard" size={20} color="var(--primary)" />
      <div class="col grow" style="gap:0;min-width:0">
        {o.participants >= 2 && <span style="font-weight:650">You're {ordinal(o.rank)} of {o.participants}</span>}
        {gap && <span class="muted">{gap}</span>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------------------------------
 * The progress chart and its replay - a port of the phone's ProgressChart (RaceInsights.kt).
 * --------------------------------------------------------------------------------------------- */

// Tall enough that racers close together don't sit on top of each other (was 160).
const CHART_HEIGHT = 320
const MONTH_LABEL_MIN_DAYS = 120
/** The racer bubbles at the end of each line on the progress chart. */
const BUBBLE_RADIUS = 12

const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", system-ui, sans-serif'
const inkCenters = new Map()
/** Where an emoji's visible pixels are centred, relative to its left/baseline drawing point, as a
 *  fraction of the font size - found once per emoji by drawing it big off-screen and scanning
 *  for ink, since every platform's emoji font reports different (often wrong) metrics. */
function emojiInkCenter(emoji) {
  let c = inkCenters.get(emoji)
  if (c) return c
  c = { x: 0.5, y: -0.35 }
  try {
    const size = 96, pad = 48, W = size + pad * 2
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = W
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.font = `${size}px ${EMOJI_FONT}`
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = '#000'
    ctx.fillText(emoji, pad, pad + size)
    const d = ctx.getImageData(0, 0, W, W).data
    let x0 = W, x1 = -1, y0 = W, y1 = -1
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    }
    if (x1 >= 0) c = { x: ((x0 + x1 + 1) / 2 - pad) / size, y: ((y0 + y1 + 1) / 2 - pad - size) / size }
  } catch { /* no canvas - keep the estimate */ }
  inkCenters.set(emoji, c)
  return c
}

const JOIN_REACTION_PROGRESS = 0.04
const OVERTAKE_REACTION_PROGRESS = 0.06
const SPOTLIGHT_DIM = 0.65
const SLOWMO_FACTOR = 5
const SLOWMO_WIDTH = 0.03
const SPOTLIGHT_REACH = SLOWMO_WIDTH * 2
const SLOWMO_MAX_EXTRA_MILLIS = 6000
const SUBTLE_OVERTAKE_WEIGHT = 0.35
const LIVE_GREEN_RGB = '76,175,80'

/** How a replay moves through the race over time: an even pace that slows smoothly (to 5x at the
 *  peak) into each significant pass, and eases in and out at the very start and end. */
class ReplayTimeline {
  constructor(baseMillis, moments) {
    this.moments = moments
    const steps = this.steps = 1000
    const gauss = (p, c, w) => Math.exp(-(((p - c) / w) ** 2))
    const ends = (p) => 1 + 1.5 * gauss(p, 0, 0.06) + 1.5 * gauss(p, 1, 0.06)
    const slowness = (p) => ends(p) + moments.reduce((t, m) => t + (SLOWMO_FACTOR - 1) * gauss(p, m, SLOWMO_WIDTH), 0)
    this.elapsed = new Float64Array(steps + 1)
    let plain = 0
    for (let i = 1; i <= steps; i++) {
      const p = (i - 0.5) / steps
      this.elapsed[i] = this.elapsed[i - 1] + slowness(p) / steps
      plain += ends(p) / steps
    }
    this.totalMillis = Math.min(Math.round((baseMillis * this.elapsed[steps]) / plain), baseMillis + SLOWMO_MAX_EXTRA_MILLIS)
  }
  progressAt(time) {
    const { elapsed, steps } = this
    const target = Math.min(1, Math.max(0, time)) * elapsed[steps]
    let lo = 0, hi = steps
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (elapsed[mid] < target) lo = mid; else hi = mid }
    const span = elapsed[hi] - elapsed[lo]
    return (lo + (span > 0 ? (target - elapsed[lo]) / span : 0)) / steps
  }
  get millisPerProgressAtEnd() { const { elapsed, steps } = this; return (this.totalMillis * (elapsed[steps] - elapsed[steps - 1]) * steps) / elapsed[steps] }
  spotlightAt(progress) {
    const v = Math.max(0, ...this.moments.map((m) => Math.exp(-(((progress - m) / SLOWMO_WIDTH) ** 2))))
    return v > 0.02 ? v : 0
  }
}

/** Every pass in the race, day by day (against the last day the two weren't level); [important]
 *  when it's a change of leader. */
function findOvertakes(lines, levelWithin) {
  const out = []
  const lastDay = Math.max(-1, ...lines.map((l) => l.cumulative.length - 1))
  if (lastDay < 0) return out
  const at = (l, d) => l.cumulative[Math.min(d, l.cumulative.length - 1)]
  const leaders = []
  for (let d = 0; d <= lastDay; d++) {
    let best = null
    for (const l of lines) if (l.joinIndex <= d && (!best || at(l, d) > at(best, d))) best = l
    leaders.push(best?.st.userId)
  }
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    const a = lines[i], b = lines[j]
    let sign = 0
    for (let d = Math.max(a.joinIndex, b.joinIndex); d <= lastDay; d++) {
      const diff = at(a, d) - at(b, d)
      const now = diff > levelWithin ? 1 : diff < -levelWithin ? -1 : 0
      if (!now) continue
      if (sign && now !== sign) {
        const [passer, passed] = now > 0 ? [a, b] : [b, a]
        out.push({ day: d, passer: passer.st.userId, passed: passed.st.userId, important: leaders[d] === passer.st.userId && leaders[d - 1] === passed.st.userId })
      }
      sign = now
    }
  }
  return out
}

const valueAt = (line, at) => {
  const c = line.cumulative
  if (c.length === 1) return c[0]
  const k = Math.min(Math.max(0, Math.floor(at)), c.length - 2)
  const u = Math.min(1, Math.max(0, at - k))
  return c[k] + (c[k + 1] - c[k]) * u
}
const rgbOf = (hex) => { const h = hex.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',') }

/** Everyone's running total, day by day, with a replay of the race. */
function ProgressChart({ event, now }) {
  const s = useStore()
  const me = s.race.userId
  const raceDay = (t) => ymdToEpochDay(ymdOf(t - 4 * HOUR))
  const withData = event.standings.filter((st) => Object.keys(st.daily || {}).length)
  const missing = event.standings.filter((st) => !Object.keys(st.daily || {}).length && st.millis > 0)
  const dayKeys = withData.flatMap((st) => Object.keys(st.daily).map((k) => ymdToEpochDay(+k)))
  const first = Math.min(raceDay(event.startMillis), ...dayKeys)
  const last = Math.max(raceDay(Math.min(now, event.endMillis ?? now)), ...dayKeys)
  const days = []
  for (let d = first; d <= last && days.length < 731; d++) days.push(epochDayToYmd(d))
  const lines = useMemo(() => withData.map((st) => {
    let run = 0
    // Point 0 is the start of the first day (nothing yet, for everyone); point i is the end of
    // day i - so every line rises from zero instead of starting in mid-air at its first day's total.
    const cumulative = [0, ...days.map((k) => Math.min((run += st.daily[k] || 0), st.millis))]
    const joinedLate = st.joinedAt > event.startMillis && st.userId !== event.createdBy
    // Time logged on race days before they joined still counts - so a late joiner comes in on their
    // first day with any, and the replay grows their line through those days rather than jumping
    // it up all at once on the day they joined.
    // The point they come in at is the start of that day (still zero), so their line grows up from
    // the baseline like everyone else's.
    const joinIndex = !joinedLate ? 0 : (() => {
      const i = days.indexOf(epochDayToYmd(raceDay(st.joinedAt)))
      const joinDay = i < 0 ? days.length - 1 : i
      const firstWithTime = cumulative.findIndex((v) => v > 0) - 1
      return firstWithTime < 0 ? joinDay : Math.min(joinDay, firstWithTime)
    })()
    const color = lineColor(st, event.standings.indexOf(st), event.standings)
    return { st, color, rgb: rgbOf(color), cumulative, isMe: st.userId === me, joinIndex }
  }).sort((x, y) => x.isMe - y.isMe), [event, days.length, me])
  const topValue = Math.max(0, ...lines.map((l) => l.cumulative[l.cumulative.length - 1] || 0))
  const overtakes = useMemo(() => findOvertakes(lines, Math.max(60000, topValue * 0.005)), [lines])
  const significantDays = [...new Set(overtakes.filter((o) => o.important).map((o) => o.day))]
  const replayMillis = Math.min(12000, Math.max(3000, days.length * 220))
  // Chart points: the start of the first day, then the end of each day.
  const points = days.length + 1
  const timeline = useMemo(() => new ReplayTimeline(replayMillis, significantDays.map((d) => d / Math.max(1, points - 1))), [overtakes, replayMillis, points])
  const tailNeeded = useMemo(() => {
    const li = Math.max(1, points - 1)
    const ends = [...overtakes.map((o) => o.day / li + OVERTAKE_REACTION_PROGRESS / 2), ...lines.filter((l) => l.joinIndex > 0).map((l) => l.joinIndex / li + JOIN_REACTION_PROGRESS * 1.4), ...significantDays.map((d) => d / li + SPOTLIGHT_REACH)]
    return Math.max(0, Math.max(0, ...ends) - 1)
  }, [overtakes, lines, days.length])

  const canvasRef = useRef(null)
  const [width, setWidth] = useState(300)
  const [replay, setReplay] = useState(null) // { start } while playing
  const [shownDay, setShownDay] = useState(null)
  useEffect(() => {
    const el = canvasRef.current?.parentElement
    if (!el) return
    const ro = new ResizeObserver(() => el.clientWidth && setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const goal = event.goalHours * HOUR
  const showGoal = goal <= (topValue * 3) / 2
  const yMax = Math.max(1, showGoal ? (Math.max(topValue, goal) * 21) / 20 : (topValue * 21) / 20)
  const anyLive = lines.some((l) => isLiveAt(l.st, now) && l.st.emoji)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !lines.length || topValue <= 0) return
    const dpr = window.devicePixelRatio || 1
    const H = CHART_HEIGHT, W = width
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr)
    const ctx = canvas.getContext('2d')
    const css = getComputedStyle(canvas)
    const grid = css.getPropertyValue('--outline-variant').trim() || '#33364F'
    const goalColor = css.getPropertyValue('--tertiary').trim() || '#E8B93E'
    const base = css.getPropertyValue('--bg').trim() || '#121420'
    const tailStart = replay ? replay.start + timeline.totalMillis : 0
    const tailMillis = tailNeeded * timeline.millisPerProgressAtEnd
    let raf = 0
    const frame = (t) => {
      const replaying = !!replay
      let time = 1, tail = 0
      if (replaying) {
        time = Math.min(1, (t - replay.start) / timeline.totalMillis)
        if (t > tailStart) tail = Math.min(tailNeeded, ((t - tailStart) / Math.max(1, tailMillis)) * tailNeeded)
      }
      const progress = replaying ? timeline.progressAt(time) : 1
      const lastIndex = Math.max(1, points - 1)
      const position = progress * (points - 1)
      const effect = progress + (replaying ? tail : 0)
      const since = (day) => effect - day / lastIndex
      const bubble = BUBBLE_RADIUS
      const inset = lines.some((l) => l.st.emoji) ? bubble + 2 : 0
      const plotW = W - inset
      const x = (i) => (i * plotW) / (points - 1)
      const y = (v) => H - (v / yMax) * (H - inset)
      const visible = lines.filter((l) => !replaying || position >= l.joinIndex)
      const arrival = (l) => (!replaying || l.joinIndex === 0 ? 1 : Math.min(1, Math.max(0, since(l.joinIndex) / JOIN_REACTION_PROGRESS)))
      const phaseOf = (o) => since(o.day) / OVERTAKE_REACTION_PROGRESS + 0.5
      const newLeaders = new Set(overtakes.filter((o) => o.important && phaseOf(o) >= 0 && phaseOf(o) <= 1).map((o) => o.passer))
      const reaction = (id, asPasser) => {
        if (!replaying || days.length < 2) return 0
        if (newLeaders.size && (!asPasser || !newLeaders.has(id))) return 0
        let best = 0
        for (const o of overtakes) {
          if ((asPasser ? o.passer : o.passed) !== id) continue
          const p = phaseOf(o)
          if (p >= 0 && p <= 1) best = Math.max(best, Math.sin(Math.PI * p) * (o.important ? 1 : SUBTLE_OVERTAKE_WEIGHT))
        }
        return best
      }
      const spotlight = replaying ? timeline.spotlightAt(effect) : 0
      const spotDay = spotlight > 0 ? significantDays.reduce((b, d) => (b == null || Math.abs(since(d)) < Math.abs(since(b)) ? d : b), null) : null
      const inSpot = new Set(spotDay == null ? [] : overtakes.filter((o) => o.day === spotDay && o.important).map((o) => o.passer))
      const dimFor = (l) => (spotlight > 0 && !inSpot.has(l.st.userId) ? 1 - SPOTLIGHT_DIM * spotlight : 1)
      const livePulse = anyLive ? 1 - 0.65 * (0.5 - 0.5 * Math.cos((t / 900) * Math.PI)) : 1

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)
      ctx.lineWidth = 1
      ctx.strokeStyle = grid
      ctx.globalAlpha = 0.6
      for (const f of [0, 0.5, 1]) { ctx.beginPath(); ctx.moveTo(0, y(yMax * f)); ctx.lineTo(W, y(yMax * f)); ctx.stroke() }
      ctx.globalAlpha = 1
      if (showGoal) {
        ctx.save(); ctx.setLineDash([8, 6]); ctx.lineWidth = 1.5; ctx.strokeStyle = goalColor
        ctx.beginPath(); ctx.moveTo(0, y(goal)); ctx.lineTo(W, y(goal)); ctx.stroke(); ctx.restore()
      }
      const step = Math.max(1, points / (plotW / 2))
      for (const l of visible) {
        const sw = l.isMe ? 3 : 2
        const start = replaying ? l.joinIndex : 0
        const tip = [x(position), y(valueAt(l, position))]
        const alpha = arrival(l) * dimFor(l)
        ctx.strokeStyle = ctx.fillStyle = `rgba(${l.rgb},${alpha})`
        if (position <= start) {
          ctx.beginPath(); ctx.arc(tip[0], tip[1], sw * 1.5, 0, Math.PI * 2); ctx.fill()
        } else {
          ctx.beginPath(); ctx.moveTo(x(start), y(valueAt(l, start)))
          for (let at = start + step; at < position; at += step) ctx.lineTo(x(at), y(valueAt(l, at)))
          ctx.lineTo(tip[0], tip[1])
          ctx.lineWidth = sw; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke()
          if (!l.st.emoji) { ctx.beginPath(); ctx.arc(tip[0], tip[1], sw * 1.2, 0, Math.PI * 2); ctx.fill() }
        }
        // A late joiner arriving mid-replay: a quick ring pulse where they appear.
        const sj = since(l.joinIndex) / (JOIN_REACTION_PROGRESS * 1.4)
        if (replaying && l.joinIndex > 0 && sj >= 0 && sj <= 1) {
          ctx.strokeStyle = `rgba(${l.rgb},${1 - sj})`; ctx.lineWidth = 2
          ctx.beginPath(); ctx.arc(x(l.joinIndex), y(l.cumulative[l.joinIndex]), bubble * (0.8 + 1.4 * sj), 0, Math.PI * 2); ctx.stroke()
        }
      }
      // Emoji bubbles, whoever's ahead at this point drawn last (on top).
      const order = event.standings.map((x2) => x2.userId)
      const withE = visible.filter((l) => l.st.emoji).sort((a2, b2) => valueAt(a2, position) - valueAt(b2, position) || order.indexOf(b2.st.userId) - order.indexOf(a2.st.userId))
      for (const l of withE) {
        const a = arrival(l)
        const pop = a >= 1 ? 1 : 1 + 2.70158 * (a - 1) ** 3 + 1.70158 * (a - 1) ** 2
        if (pop <= 0) continue
        const cx = x(position), cy = y(valueAt(l, position))
        const passing = reaction(l.st.userId, true), passed = reaction(l.st.userId, false)
        const dim = dimFor(l)
        if (spotlight > 0 && inSpot.has(l.st.userId)) {
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, bubble * 2.6)
          g.addColorStop(0, `rgba(${l.rgb},${0.42 * spotlight})`); g.addColorStop(1, `rgba(${l.rgb},0)`)
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, bubble * 2.6, 0, Math.PI * 2); ctx.fill()
        }
        const sc = pop * (1 + 0.28 * passing) * (1 - 0.16 * passed)
        ctx.save(); ctx.translate(cx, cy); ctx.scale(sc, sc)
        ctx.globalAlpha = dim
        ctx.fillStyle = base; ctx.beginPath(); ctx.arc(0, 0, bubble, 0, Math.PI * 2); ctx.fill()
        if (isLiveAt(l.st, now) && !replaying) {
          ctx.fillStyle = `rgba(${LIVE_GREEN_RGB},${0.12 + 0.2 * livePulse})`; ctx.fill()
          ctx.strokeStyle = `rgba(${LIVE_GREEN_RGB},${livePulse})`; ctx.lineWidth = 2; ctx.stroke()
        } else {
          ctx.fillStyle = `rgba(${l.rgb},${0.22 * dim})`; ctx.fill()
          ctx.strokeStyle = `rgba(${l.rgb},${dim})`; ctx.lineWidth = 1.5; ctx.stroke()
        }
        ctx.font = `${Math.round(bubble * 1.2)}px ${EMOJI_FONT}`
        ctx.fillStyle = '#000' // opaque, or the colour emoji comes out faded
        // Centred on the emoji's own drawn pixels (see emojiInkCenter), not the font's metrics,
        // which put emoji off-centre by different amounts on different platforms.
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
        const shown = displayEmoji(l.st.emoji)
        const ink = emojiInkCenter(shown)
        const fontPx = Math.round(bubble * 1.2)
        ctx.fillText(shown, -ink.x * fontPx, -ink.y * fontPx)
        ctx.restore()
      }
      if (replaying) {
        const k = days[Math.min(days.length - 1, Math.max(0, Math.round(progress * (points - 1)) - 1))]
        setShownDay(k)
        if (time >= 1 && tail >= tailNeeded) { setReplay(null); setShownDay(null); return }
      }
      if (replaying || anyLive) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [lines, width, replay, yMax, anyLive, now, timeline, tailNeeded])

  if (!lines.length || topValue <= 0) return <div class="muted small">No day-by-day totals yet.</div>
  const longRace = days.length > MONTH_LABEL_MIN_DAYS
  const label = (k) => (replay && longRace ? new Date(epochDayStart(ymdToEpochDay(+k))).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : formatYmd(+k))
  return (
    <div>
      <div class="row" style="align-items:flex-start;gap:10px">
        <span class="muted grow" style="font-size:11px">{formatHm(yMax)}</span>
        {showGoal && <span style="font-size:11px;color:var(--tertiary)">Goal {event.goalHours}h</span>}
        {days.length > 1 && (
          <button class="replay-btn" onClick={() => (replay ? (setReplay(null), setShownDay(null)) : setReplay({ start: performance.now() }))}>
            <Icon name={replay ? 'stop' : 'play_arrow'} size={16} />{replay ? 'Stop' : 'Replay'}
          </button>
        )}
      </div>
      <div style="margin-top:4px"><canvas ref={canvasRef} style={{ width: '100%', height: CHART_HEIGHT, display: 'block' }} /></div>
      <div class="row" style="margin-top:4px;font-size:11px">
        <span class="muted grow">{formatYmd(+days[0])}</span>
        {days.length > 1 && <span style={replay ? { color: 'var(--primary)', fontWeight: 600 } : { color: 'var(--on-surface-variant)' }}>{label(replay && shownDay ? shownDay : days[days.length - 1])}</span>}
      </div>
      <div class="chart-legend">
        {event.standings.map((st) => lines.find((l) => l.st.userId === st.userId)).filter(Boolean).map((l) => (
          <span key={l.st.userId}><i style={{ background: l.color }} />{withEmoji(l.st.emoji, l.st.name)}</span>
        ))}
      </div>
      {missing.length > 0 && <div class="muted" style="font-size:11px;margin-top:6px">No day-by-day data from {missing.map((m) => m.name).join(', ')} yet.</div>}
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
    <Dialog hideScrollbar onClose={onClose} actions={<button class="btn" onClick={onClose}>Close</button>}>
      {/* Who: medal, name and place, with being friends as a small action on the right. */}
      <div class="row" style="gap:12px">
        <RankMedal rank={rank} />
        <div class="grow" style="min-width:0">
          <div class="row" style="gap:8px"><span class="title-large ellipsis">{withEmoji(st.emoji, st.name)}</span>{isLiveAt(st, now) && <LiveBadge kind={st.activeKind} />}</div>
          <div class="muted small">{ordinal(rank)} of {event.standings.length}</div>
        </div>
        {isMe && onOpenMe && <button class="btn tonal small" onClick={onOpenMe}><Icon name="edit" size={16} />Profile</button>}
        {!isMe && (isFriend ? <span class="label-large" style="color:var(--primary)">Friends ✓</span>
          : incoming ? <button class="btn small" onClick={() => friendAction(() => respondFriend(st.userId, true), `You and ${st.name} are now friends!`)}>Accept</button>
            : outgoing ? <span class="label-large muted">Requested</span>
              : <button class="btn tonal small" disabled={busy} onClick={() => friendAction(() => addFriendById(st.userId), `Friend request sent to ${st.name}`)}>{busy ? 'Sending…' : 'Add friend'}</button>)}
      </div>
      {/* The total against the goal: the number, then a bar instead of a sentence. */}
      <div class="row" style="align-items:baseline;gap:8px;margin-top:18px">
        <span class="person-total" style="margin:0">{formatHm(st.millis)}</span>
        <span class="muted" style="font-size:16px;font-weight:500">/ {event.goalHours}h</span>
      </div>
      <div class="row" style="gap:10px;margin-top:8px">
        <div class="goal-bar grow"><div style={{ width: `${Math.min(100, goal > 0 ? (st.millis * 100) / goal : 0)}%` }} /></div>
        <span class="muted" style="font-size:12px;font-weight:500">{percentText(st.millis, goal)}%</span>
      </div>
      {/* Against me, then their clock and how fresh the number is - one line. */}
      {((!isMe && mine) || localTime || report) && (
        <div class="row" style="gap:10px;margin-top:10px">
          {!isMe && mine && (
            <span class="diff-chip" style={{ '--c': diff > 0 ? 'var(--danger)' : 'var(--primary)' }}>
              {diff > 0 ? `${formatHm(diff)} ahead of you` : diff < 0 ? `${formatHm(-diff)} behind you` : 'Tied with you'}
            </span>
          )}
          <span class="muted grow" style="font-size:11px;line-height:15px">{[localTime && `${localTime} their time`, report].filter(Boolean).join(' · ')}</span>
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
        {/* Today's split too, while the race runs - the card's Today view shows only the bars. */}
        {live && Object.keys(st.dailyReading || {}).length > 0 && (() => {
          const k = localTodayKey(st, now)
          const today = Math.min(st.millis, (st.daily || {})[k] || 0)
          const r = Math.min(today, st.dailyReading[k] || 0)
          const a = Math.min(today, (st.dailyAnki || {})[k] || 0)
          return (
            <div class="row split-line" style="gap:12px;margin-top:8px">
              <span class="muted" style="font-size:11px">{localTime ? 'Their today' : 'Today'}</span>
              <SplitAmount type="PODCAST" color={colors.listening} millis={Math.max(0, today - r - a)} />
              <SplitAmount type="READING" color={colors.reading} millis={r} />
              {a > 0 && <SplitAmount type="ANKI" color={colors.anki} millis={a} />}
            </div>
          )
        })()}
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

/** Your picture in Social's corner - the same one friends see: your animal on display (in its
 *  rarity's ring) if you chose that, else your emoji (or initial) on your banner colour, like the
 *  phone's MyProfileAvatar. */
function MyAvatar({ onClick }) {
  const s = useStore()
  const catalog = useCatalog()
  const stops = (s.friends.banner || '').split(',').filter(Boolean)
  const fill = stops.length ? `linear-gradient(135deg, ${(stops.length === 1 ? [stops[0], stops[0]] : stops).join(', ')})` : 'linear-gradient(135deg, var(--primary), var(--tertiary))'
  const emoji = displayEmoji(s.race.emoji)
  const animal = s.friends.avatar !== 'emoji' && s.zoo.trophyId && catalog ? catalog.find((a) => a.id === s.zoo.trophyId) : null
  return (
    <button class="my-avatar" title="Your profile" onClick={onClick}
      style={animal ? { background: 'var(--c-high)', boxShadow: `0 0 0 2px ${RARITY_COLOR[animal.rarity]}` } : { background: fill, fontSize: emoji ? 22 : 18 }}>
      {animal ? <AnimalPhoto animal={animal} /> : emoji || (s.race.name || '🙂').slice(0, 1).toUpperCase()}
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
        <div class="row" style="gap:8px"><span class="title-medium ellipsis" style="font-weight:600">{p.name}</span>{p.goldenDays >= GOLDEN_DAYS && <MomentumPill days={p.goldenDays} progress={1} />}</div>
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
    <Dialog hideScrollbar title="Your profile" onClose={onClose} actions={<button class="btn" onClick={onClose}>Done</button>}>
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
      <Fold id="emoji" title="Emoji" value={<span style="font-size:22px">{displayEmoji(s.race.emoji) || '—'}</span>} />
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
          <span class="pp-emoji" style="width:40px;height:40px;background:var(--surface-variant);font-size:20px">{displayEmoji(s.race.emoji) || (s.race.name || '🙂').slice(0, 1).toUpperCase()}</span>Emoji
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
  const asOf = p.dayKey > 0 && p.dayKey !== ymdOf(goalDayStart(Date.now()))
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
        {p.shows.streaks && p.goldenDays >= GOLDEN_DAYS && <MomentumPill days={p.goldenDays} progress={1} />}
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
    <Dialog hideScrollbar onClose={onClose} actions={<>{onRemove && <button class="btn text danger" onClick={onRemove}>Remove friend</button>}<span class="spacer" /><button class="btn" onClick={onClose}>Close</button></>}>
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
                <AnimalPhoto animal={a} />{cert(a.id)?.foil && <FoilSheen seed={a.id} />}{n > 1 && <span class="count">×{n}</span>}
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
  return <div class="pp-emoji" style={{ width: size, height: size, background: color ? withAlpha(color, 0.3) : 'color-mix(in srgb, var(--primary) 30%, transparent)' }}>{displayEmoji(p.emoji) || (p.name || '?').slice(0, 1).toUpperCase()}</div>
}

function RecordTile({ label, value }) {
  return <div class="record-tile"><div class="k">{label}</div><div class="v ellipsis">{value}</div></div>
}

export { RarityBadge }
