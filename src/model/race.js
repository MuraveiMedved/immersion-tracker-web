// Races and friends on the same Apps Script server the phones use (race-backend/Code.gs) - the
// web app is just another racer: it reports its own totals, worked out from its own entries.
import { getState, update } from '../store.js'
import { ANKI, PODCAST, READING, counts, durationOf, goldenStreakDays, computeStreak, dailyTotalsFor } from './rules.js'
import { DAY, HOUR, localZone, zonedParts, dayStart, goalDayStart, ymdOf, ymdToEpochDay, epochDayToYmd, isValidYmd } from './time.js'

/** The owner's server, built into the phone app too (see Tracker APP/CLAUDE.md - temporary until
 *  a public release). */
export const DEFAULT_RACE_URL = 'https://script.google.com/macros/s/AKfycbzHgsd0sFDyZhrp3Bv2lJ1K0fCO-d37P9VMaZRWKuXF3NsoE_LJPFY2fYlplHHNsJir/exec'
export const RACE_DAY_START_HOUR = 4
export const ANKI_RACE_SHARE = 0.1
const RESEND_UNCHANGED_MILLIS = 10 * 60 * 1000
const RECENT_FINISH_KEEP = 14 * DAY
export const SERVER_VERSION_STATE = 11

export const serverUrl = () => getState().race.serverUrl || DEFAULT_RACE_URL
export const raceConfigured = () => !!getState().race.name.trim()

/* ------------------------------------------------------------------------------------------------
 * Days: a race day starts at 4am local time (yyyymmdd keys, each person's own calendar).
 * --------------------------------------------------------------------------------------------- */

/** Local race-day start for [ms] in this browser's zone. */
function raceDayStartLocal(ms, startHour = RACE_DAY_START_HOUR) {
  const d = new Date(ms)
  const before = d.getHours() < startHour
  d.setHours(startHour, 0, 0, 0)
  if (before) d.setDate(d.getDate() - 1)
  return d.getTime()
}

export function addSplitByDay(byDay, from, until) {
  let cursor = from
  while (cursor < until) {
    const start = raceDayStartLocal(cursor)
    const key = ymdOf(start)
    const next = new Date(start)
    next.setDate(next.getDate() + 1)
    const sliceEnd = Math.min(until, next.getTime())
    byDay.set(key, (byDay.get(key) || 0) + (sliceEnd - cursor))
    cursor = sliceEnd
  }
}

/** Which of [standing]'s day keys is their today, in their zone with their day boundary. */
export function localTodayKey(standing, now = Date.now()) {
  const zone = standing.timeZone || localZone()
  const hourStart = standing.dayStartHour || 0
  const p = zonedParts(now, zone) || zonedParts(now, localZone())
  let ymd = p.year * 10000 + p.month * 100 + p.day
  if (p.hour < hourStart) ymd = epochDayToYmd(ymdToEpochDay(ymd) - 1)
  return ymd
}

export function cappedAnki(immersionByDay, ankiByDay, share = ANKI_RACE_SHARE) {
  const countedByDay = new Map()
  let immersion = 0, anki = 0, counted = 0
  const days = [...new Set([...immersionByDay.keys(), ...ankiByDay.keys()])].sort((a, b) => a - b)
  for (const day of days) {
    immersion += immersionByDay.get(day) || 0
    anki += ankiByDay.get(day) || 0
    const allowed = Math.min(anki, Math.floor(immersion * share))
    if (allowed > counted) countedByDay.set(day, allowed - counted)
    counted = allowed
  }
  return { countedByDay, counted, banked: anki - counted }
}

/** What this browser is tracking that counts in races (listening, reading or Anki with a
 *  language) - the newest, if several. Shared by the report and your own row's live tag. */
export function runningForRace(entries) {
  return entries.filter((e) => e.endTimeMillis == null && e.languageProfileId != null && (e.contentType === PODCAST || e.contentType === READING || e.contentType === ANKI))
    .sort((a, b) => b.startTimeMillis - a.startTimeMillis)[0] || null
}
export const activeKindOf = (e) => (e ? (e.contentType === READING ? 'reading' : e.contentType === ANKI ? 'anki' : 'listening') : '')

/** This browser's numbers for [event]: only entries with a language count, music never does, and
 *  only the part inside the event's window. */
export function scoreFor(event, entries, now = Date.now()) {
  const windowStart = event.startMillis
  const windowEnd = Math.min(event.endMillis ?? now, now)
  let immersion = 0, reading = 0
  const immersionByDay = new Map(), readingByDay = new Map(), ankiByDay = new Map()
  if (windowEnd > windowStart) {
    for (const e of entries) {
      const isAnki = e.contentType === ANKI
      if (!isAnki && (e.languageProfileId == null || !(e.contentType === PODCAST || e.contentType === READING))) continue
      const from = Math.max(e.startTimeMillis, windowStart)
      const until = Math.min(e.endTimeMillis ?? now, windowEnd)
      if (until - from <= 0) continue
      if (isAnki) { addSplitByDay(ankiByDay, from, until); continue }
      immersion += until - from
      if (e.contentType === READING) { reading += until - from; addSplitByDay(readingByDay, from, until) }
      addSplitByDay(immersionByDay, from, until)
    }
  }
  const anki = cappedAnki(immersionByDay, ankiByDay)
  const byDay = new Map(immersionByDay)
  for (const [d, m] of anki.countedByDay) byDay.set(d, (byDay.get(d) || 0) + m)
  let best = null
  for (const [d, m] of [...byDay].sort((a, b) => a[0] - b[0])) if (!best || m > best[1]) best = [d, m]
  const obj = (map) => Object.fromEntries([...map].sort((a, b) => a[0] - b[0]).map(([k, v]) => [String(k), v]))
  const live = now >= event.startMillis && !(event.endMillis != null && now >= event.endMillis)
  const running = live ? runningForRace(entries) : null
  return {
    eventId: event.id,
    windowEnd: event.endMillis ?? 0,
    millis: immersion + anki.counted,
    readingMillis: reading,
    bestDayMillis: best ? best[1] : 0,
    bestDay: best ? best[0] : 0,
    daily: obj(byDay),
    dailyReading: obj(readingByDay),
    ankiMillis: anki.counted,
    ankiBankedMillis: anki.banked,
    dailyAnki: obj(anki.countedByDay),
    timeZone: localZone(),
    dayStartHour: RACE_DAY_START_HOUR,
    active: !!running,
    activeKind: activeKindOf(running),
  }
}

/* ------------------------------------------------------------------------------------------------
 * Talking to the server: a POST of text/plain JSON (no CORS preflight); Apps Script redirects to a
 * one-off googleusercontent URL that fetch follows with a GET.
 * --------------------------------------------------------------------------------------------- */

export class RaceError extends Error {
  constructor(kind, detail) {
    super(detail || kind)
    this.kind = kind
    this.detail = detail
  }
}

export function errorText(err) {
  if (!err) return ''
  switch (err.kind) {
    case 'OFFLINE': return "You're offline, or the race server can't be reached right now."
    case 'NOT_A_RACE_SERVER': return "That link didn't answer like a race server. Check it's the Web app URL ending in /exec, deployed with access for \"Anyone\"."
    case 'SERVER_UNAVAILABLE': return `Google's servers answered with an error (${err.detail}). This is usually temporary, so try again in a minute.`
    case 'SCRIPT_OUTDATED': return "The race server's script is older than this app. Whoever set it up needs to paste in the new Code.gs and deploy a new version."
    case 'SERVER_MESSAGE': return err.detail
    default: return err.detail || 'Something went wrong talking to the race server.'
  }
}

export async function post(body) {
  const url = serverUrl()
  body.userId = getState().race.userId
  let res
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' })
  } catch {
    throw new RaceError('OFFLINE')
  }
  if (!res.ok) throw new RaceError('SERVER_UNAVAILABLE', String(res.status))
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { throw new RaceError('NOT_A_RACE_SERVER') }
  if (!json.ok) {
    const msg = String(json.error || '')
    if (msg.startsWith('Unknown action')) throw new RaceError('SCRIPT_OUTDATED')
    throw new RaceError('SERVER_MESSAGE', msg || 'The race server refused that.')
  }
  return json
}

let lastReport = null
let lastReportAt = 0
let inFlight = Promise.resolve()

/** Runs requests one at a time, so an older response can never land last. */
function serial(fn) {
  const run = inFlight.then(fn, fn)
  inFlight = run.catch(() => {})
  return run
}

const listeners = new Set()
export const raceStatus = { activity: null, error: null }
export function onRaceStatus(fn) { listeners.add(fn); return () => listeners.delete(fn) }
function setStatus(patch) { Object.assign(raceStatus, patch); listeners.forEach((l) => l()) }

const competedIn = (event, userId) => (event.standings || []).some((s) => s.userId === userId)
const ended = (event, now) => event.endMillis != null && event.endMillis <= now

/** Finished races go into this browser's own history (see RaceRepository.updateArchive). */
function updateArchive(s, previous, current, now) {
  const userId = s.race.userId
  const deleted = new Set(s.race.deleted)
  const archive = new Map()
  for (const e of s.race.archive) if (competedIn(e, userId)) archive.set(e.id, e)
  const currentIds = new Set()
  for (const e of current) {
    currentIds.add(e.id)
    if (ended(e, now) && !deleted.has(e.id) && competedIn(e, userId)) archive.set(e.id, e)
    if (!ended(e, now)) archive.delete(e.id)
  }
  for (const e of previous) {
    if (currentIds.has(e.id) || deleted.has(e.id) || archive.has(e.id)) continue
    if (!competedIn(e, userId) || e.startMillis > now) continue
    const copy = { ...e }
    if (copy.endMillis == null || copy.endMillis > now) { copy.endMillis = now; copy.endReason = 'manual' }
    archive.set(e.id, copy)
  }
  s.race.archive = [...archive.values()]
}

function cleanEvents(events) {
  return (events || []).filter((e) => e && e.id).map((e) => ({
    ...e,
    standings: (e.standings || []).map((st) => ({
      ...st,
      daily: cleanDays(st.daily),
      dailyReading: cleanDays(st.dailyReading),
      dailyAnki: cleanDays(st.dailyAnki),
      dayStartHour: Math.min(23, Math.max(0, Number(st.dayStartHour) || 0)),
    })),
  }))
}
function cleanDays(o) {
  const out = {}
  for (const [k, v] of Object.entries(o || {})) if (/^\d{8}$/.test(k) && isValidYmd(+k)) out[k] = Number(v) || 0
  return out
}

async function request(body, activity, retry = false) {
  return serial(async () => {
    setStatus({ activity })
    let json
    try {
      try {
        json = await post(body)
      } catch (err) {
        const transient = err.kind === 'SERVER_UNAVAILABLE' || (err.kind === 'SERVER_MESSAGE' && /lock/i.test(err.detail || ''))
        if (!retry || !transient) throw err
        await new Promise((r) => setTimeout(r, 2000))
        json = await post(body)
      }
    } catch (err) {
      setStatus({ activity: null, error: err })
      return null
    }
    const now = Date.now()
    const events = cleanEvents(json.events)
    update((s) => {
      updateArchive(s, s.race.cachedEvents, events, now)
      s.race.cachedEvents = events
      s.race.lastSync = now
      s.race.serverVersion = Number(json.serverVersion) || 0
      if (json.profiles) s.race.profiles = json.profiles
    })
    setStatus({ activity: null, error: null })
    return json
  })
}

/** Reports totals for every race this browser is in and fetches everyone's standings back. */
/** sync(), unless the standings came back less than `minGap` ms ago - and one already under way is
 *  shared, not repeated (RaceRepository.syncIfStale). Run the moment the app comes into focus, so
 *  the race is already updating by the time Social is open; Social's own first refresh joins it. */
let staleSync = null
export function syncIfStale(minGap = 15000) {
  if (staleSync) return staleSync
  if (!raceConfigured() || Date.now() - (getState().race.lastSync || 0) < minGap) return Promise.resolve()
  staleSync = sync().finally(() => { staleSync = null })
  return staleSync
}

export async function sync({ joinEventId = null, followUp = true } = {}) {
  const s = getState()
  if (!raceConfigured()) return
  const now = Date.now()
  const scores = s.race.cachedEvents
    .filter((e) => e.id === joinEventId || competedIn(e, s.race.userId))
    .filter((e) => !e.standings.some((st) => st.userId === s.race.userId && st.final))
    .map((e) => scoreFor(e, s.entries, now))
  const report = { action: 'sync', name: s.race.name, emoji: s.race.emoji, color: s.race.chartColor, scores }
  const profile = buildProfileBody()
  if (profile) report.profile = profile
  const fingerprint = JSON.stringify(report)
  const readOnly = !joinEventId && followUp && (s.race.serverVersion || 1) >= SERVER_VERSION_STATE &&
    fingerprint === lastReport && now - lastReportAt < RESEND_UNCHANGED_MILLIS
  const res = await request(readOnly ? { action: 'state' } : report, joinEventId ? 'JOINING' : followUp ? 'REFRESHING' : 'SENDING_FINAL', true)
  if (res && !readOnly) { lastReport = fingerprint; lastReportAt = now }
  const st = getState()
  const owesFinal = st.race.cachedEvents.some((e) => ended(e, Date.now()) && e.standings.some((x) => x.userId === st.race.userId && !x.final))
  if (res && followUp && owesFinal) await sync({ followUp: false })
}

/** Whether there's anything to report on a timer: a started race this browser is in that still
 *  needs its total. */
export function shouldReport() {
  const s = getState()
  const now = Date.now()
  return raceConfigured() && s.race.cachedEvents.some((e) => now >= e.startMillis && e.standings.some((x) => x.userId === s.race.userId && !x.final))
}

export async function createEvent({ name, startMillis, endMillis, goalHours }) {
  const s = getState()
  const ok = await request({ action: 'create', creatorName: s.race.name, creatorEmoji: s.race.emoji, creatorColor: s.race.chartColor, name, startMillis, endMillis: endMillis ?? null, goalHours }, 'CREATING')
  if (ok) await sync()
  return !!ok
}

export async function joinByCode(code) {
  const s = getState()
  const ok = await request({ action: 'joinByCode', code: code.trim().toUpperCase(), name: s.race.name, emoji: s.race.emoji, color: s.race.chartColor }, 'JOINING')
  if (ok) await sync()
  return !!ok
}

export const leaveEvent = (eventId) => request({ action: 'leave', eventId }, 'LEAVING')
export const endEvent = (eventId) => request({ action: 'end', eventId }, 'ENDING')
export function editEvent(eventId, name, changeEnd, endMillis) {
  const body = { action: 'edit', eventId, name }
  if (changeEnd) body.endMillis = endMillis ?? null
  return request(body, 'EDITING')
}
export function deleteEventForEveryone(eventId) {
  return request({ action: 'delete', eventId }, 'EDITING')
}

/** Takes a finished race out of this browser's own history only. */
export function deleteCompleted(eventId) {
  update((s) => {
    if (!s.race.deleted.includes(eventId)) s.race.deleted.push(eventId)
    s.race.archive = s.race.archive.filter((e) => e.id !== eventId)
  })
}

export function myLiveRaceMillis(now = Date.now()) {
  const s = getState()
  let best = 0
  for (const e of s.race.cachedEvents) {
    if (now < e.startMillis || ended(e, now)) continue
    const me = e.standings.find((x) => x.userId === s.race.userId)
    if (me) best = Math.max(best, me.millis)
  }
  return best
}

/** Visible events: live/upcoming from the server, finished ones from the history. */
export function visibleEvents(s, now = Date.now()) {
  const deleted = new Set(s.race.deleted)
  const running = s.race.cachedEvents.filter((e) => !ended(e, now) && competedIn(e, s.race.userId))
  const done = s.race.archive.filter((e) => !deleted.has(e.id)).sort((a, b) => (b.endMillis || 0) - (a.endMillis || 0))
  return { running, done, keep: RECENT_FINISH_KEEP }
}

export const ordinal = (n) => {
  const t = n % 100
  if (t >= 11 && t <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`
}

/* ------------------------------------------------------------------------------------------------
 * Profiles and friends (ProfileBuilder + FriendsRepository).
 * --------------------------------------------------------------------------------------------- */

export function zooSummary(s) {
  const held = {}
  const traded = new Set(s.zoo.tradeIns.map((t) => t.openingId))
  for (const o of s.zoo.openings) if (!traded.has(o.id)) held[o.animalId] = (held[o.animalId] || 0) + 1
  return held
}

/** This browser's own profile body, as friends and racers see it. */
export function buildProfileBody(now = Date.now()) {
  const s = getState()
  const share = s.friends.share
  const entries = s.entries
  // Goal rings, streaks and "today" are goal days (from 4 AM), like Home.
  const todayStart = goalDayStart(now)
  const today = ymdOf(todayStart)
  const immersionByDay = new Map()
  let total = 0
  for (const e of entries) {
    if (!counts(e.contentType, e.languageProfileId)) continue
    const d = dayStart(e.startTimeMillis)
    const ms = durationOf(e, now)
    immersionByDay.set(d, (immersionByDay.get(d) || 0) + ms)
    if (e.endTimeMillis != null) total += ms
  }
  let longest = 0
  const languages = s.profiles
    .filter((p) => !p.isAnki && (p.podcastGoalMinutes > 0 || p.readingGoalMinutes > 0))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((p) => {
      const out = { name: p.name, color: p.colorHex }
      if (p.gradientColors) out.gradient = p.gradientColors
      for (const [type, goal, key] of [[PODCAST, p.podcastGoalMinutes, 'listen'], [READING, p.readingGoalMinutes, 'read']]) {
        if (goal <= 0) continue
        const daily = dailyTotalsFor(entries, p.id, type, now)
        const todayMs = daily.get(todayStart) || 0
        const streak = computeStreak(daily, goal * 60000, now)
        longest = Math.max(longest, streak.record, streak.current)
        if (share.rings) out[key === 'listen' ? 'listenProgress' : 'readProgress'] = todayMs / (goal * 60000)
        if (share.goals) {
          out[key + 'Goal'] = goal
          out[key + 'Today'] = Math.floor(todayMs / 60000)
        }
        if (share.streaks) out[key + 'Streak'] = { current: streak.current, record: streak.record, pure: false }
      }
      return out
    })
  let best = null
  for (const [d, m] of immersionByDay) if (!best || m > best[1]) best = [d, m]
  const held = zooSummary(s)
  const trophy = s.zoo.trophyId && held[s.zoo.trophyId] ? s.zoo.trophyId : null
  const body = {
    v: 1,
    dayKey: today,
    shows: { ...share },
  }
  if (trophy && share.trophy) body.trophy = trophy
  if (s.friends.banner) body.banner = s.friends.banner
  if (s.friends.background) body.bg = s.friends.background
  if (s.settings.ringStyle && s.settings.ringStyle !== 'CLASSIC') body.ringStyle = s.settings.ringStyle
  if (s.friends.avatar === 'emoji') body.pic = 'emoji'
  if (share.trophy || share.zoo) body.zooFound = Object.keys(held).length
  if (share.streaks) body.gd = goldenStreakDays(entries, now)
  if (share.zoo) body.zoo = held
  const certs = bestCertificates(s, held, share, trophy)
  if (Object.keys(certs).length) body.zc = certs
  if (share.rings || share.goals || share.streaks) body.languages = languages
  if (share.records) {
    body.records = {
      totalMillis: total,
      bestDayMillis: best ? best[1] : 0,
      bestDay: best ? ymdOf(best[0]) : 0,
      longestStreak: longest,
      daysTracked: [...immersionByDay.values()].filter((v) => v > 0).length,
    }
  }
  // The server keeps the old profile if a new one is over 20k characters - leave the certificates
  // off rather than have nothing new saved.
  if (JSON.stringify(body).length > 17000) delete body.zc
  return body
}

function bestCertificates(s, held, share, trophy) {
  const out = {}
  const traded = new Set(s.zoo.tradeIns.map((t) => t.openingId))
  const byAnimal = {}
  for (const o of s.zoo.openings) if (!traded.has(o.id) && o.cert) (byAnimal[o.animalId] = byAnimal[o.animalId] || []).push(o)
  for (const [id, list] of Object.entries(byAnimal)) {
    if (!((share.zoo && held[id]) || (share.trophy && id === trophy))) continue
    list.sort(bestFirst)
    const c = list[0].cert
    if (c.hourMark == null && !c.foil) continue
    out[id] = [c.hourMark ?? -1, (c.languageName || '').slice(0, 24), c.languageColor || '', (c.mediaTitle || '').slice(0, 80), c.foil ? 1 : 0]
  }
  return out
}

export function bestFirst(a, b) {
  const fa = a.cert?.foil ? 1 : 0, fb = b.cert?.foil ? 1 : 0
  if (fa !== fb) return fb - fa
  const ha = a.cert?.hourMark ?? Infinity, hb = b.cert?.hourMark ?? Infinity
  if (ha !== hb) return ha - hb
  return a.atMillis - b.atMillis
}

async function friendsRequest(body) {
  const s = getState()
  const json = await post({ ...body, name: s.race.name, emoji: s.race.emoji, color: s.race.chartColor, profile: buildProfileBody() })
  update((st) => {
    st.friends.code = json.code || st.friends.code
    st.friends.friends = json.friends || []
    st.friends.incoming = json.incoming || []
    st.friends.outgoing = json.outgoing || []
    st.friends.lastFetch = Date.now()
  })
  return json
}

export const refreshFriends = () => friendsRequest({ action: 'friends' })
export const addFriendByCode = (code) => friendsRequest({ action: 'addFriend', code: code.trim().toUpperCase() })
export const addFriendById = (friendId) => friendsRequest({ action: 'addFriendById', friendId })
export const respondFriend = (friendId, accept) => friendsRequest({ action: 'respondFriend', friendId, accept })
export const removeFriend = (friendId) => friendsRequest({ action: 'removeFriend', friendId })

/** A friend/racer profile from the server into the shape the profile view draws. */
export function readProfile(o) {
  const body = o?.profile || {}
  const hexes = /^#[0-9A-Fa-f]{6}(,#[0-9A-Fa-f]{6}){0,5}$/
  return {
    userId: o.userId,
    name: o.name || '',
    emoji: o.emoji || '',
    color: o.color || '',
    code: o.code || '',
    updatedAt: o.updatedAt || 0,
    dayKey: body.dayKey || 0,
    trophy: body.trophy || null,
    banner: hexes.test(body.banner || '') ? body.banner : '',
    background: hexes.test(body.bg || '') || /^theme:[A-Z_]{1,20}$/.test(body.bg || '') ? body.bg : '',
    ringStyle: /^[A-Z_]{1,24}$/.test(body.ringStyle || '') ? body.ringStyle : '',
    avatar: body.pic === 'emoji' ? 'emoji' : '',
    zooFound: body.zooFound ?? null,
    goldenDays: body.gd ?? null,
    zoo: body.zoo || null,
    certs: body.zc || null,
    languages: Array.isArray(body.languages) ? body.languages : [],
    records: body.records || null,
    shows: { rings: true, goals: true, streaks: true, records: true, trophy: true, zoo: true, ...(body.shows || {}) },
  }
}
