// The whole app's state, kept in memory and saved to IndexedDB (debounced). Other open tabs are
// told about each save over a BroadcastChannel and reload, so two windows never fight.
import { useEffect, useState } from 'preact/hooks'
import { localZone } from './model/time.js'
import { ANKI, PODCAST, READING, LISTENING } from './model/rules.js'

const DB_NAME = 'immersion-tracker'
const STORE = 'kv'
const KEY = 'state'
export const MANUAL_APP = 'manual'
/** appPackage of every session made in the web app, so they can be told apart from the phone's
 *  synced ones (the phone shows it as the session's source). */
export const WEB_APP = 'web'
export const ANKI_COLOR = '#2E7DD7'
/** The one Anki profile has the same id on every device, so synced devices share it. */
export const ANKI_ID = 1

let lastUid = 0
/** A record id that's unique across devices (synced records from several devices never clash):
 *  milliseconds x 1000 plus a random part, still a safe integer. */
export function uid() {
  let id = Date.now() * 1000 + Math.floor(Math.random() * 1000)
  if (id <= lastUid) id = lastUid + 1
  lastUid = id
  return id
}

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15)
  return (c === 'x' ? r : (r & 3) | 8).toString(16)
}))

export function defaultState() {
  return {
    version: 1,
    nextId: { entry: 1, profile: 1, opening: 1, grant: 1, tradeIn: 1 },
    profiles: [],
    entries: [],
    paused: {},
    settings: {
      showRaceTab: true,
      showZooTab: true,
      showAnkiOnHome: true,
      logUncategorized: true,
      entryThresholdEnabled: false,
      entryThresholdSeconds: 30,
      uiColorPreset: 'SLATE',
      ringStyle: 'CLASSIC',
      titleStyleMode: 'DEFAULT',
      goalCardStyleMode: 'LANGUAGE_COLOR',
      entryLabelStyle: 'ICON',
      tutorialShown: false,
      backupPromptShown: false,
    },
    race: {
      userId: uuid(),
      name: '',
      emoji: '',
      chartColor: '',
      serverUrl: '',
      cachedEvents: [],
      lastSync: 0,
      serverVersion: 0,
      deleted: [],
      archive: [],
      seenOrder: {},
      barPalette: 'theme',
      barOrder: [0, 1, 2],
    },
    friends: {
      code: '',
      friends: [],
      incoming: [],
      outgoing: [],
      share: { rings: true, goals: true, streaks: true, records: true, trophy: true, zoo: true },
      banner: '',
      background: '',
      avatar: '',
      lastFetch: 0,
    },
    zoo: { base: null, openings: [], grants: [], tradeIns: [], eggs: {}, trophyId: null },
    // This device's sign-in to the sync server - never synced itself.
    sync: { url: '', token: '', accountId: '', sinceRev: 0, lastSync: 0, error: '' },
  }
}

let state = defaultState()
let version = 0
const listeners = new Set()
let savePending = false
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('immersion-tracker') : null
channel?.unref?.() // never keeps a test process alive
const tabId = uuid()

let dbPromise = null
/** One shared connection, so saves are written in the order they were made. */
function openDb() {
  return (dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => { dbPromise = null; reject(req.error) }
  }))
}

async function readSaved(key = KEY) {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    try { return JSON.parse(localStorage.getItem(key) || 'null') } catch { return null }
  }
}

async function writeSaved(value, key = KEY) {
  try {
    const db = await openDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(value, key)
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage full or blocked */ }
  }
  if (key === KEY) channel?.postMessage({ from: tabId, type: 'saved' })
}

/** Fills in anything a newer version added, so older saves keep loading. */
function migrate(saved) {
  const base = defaultState()
  const s = { ...base, ...saved }
  for (const k of ['nextId', 'settings', 'race', 'friends', 'zoo', 'sync']) s[k] = { ...base[k], ...(saved[k] || {}) }
  s.friends.share = { ...base.friends.share, ...(saved.friends?.share || {}) }
  s.profiles = saved.profiles || []
  s.entries = saved.entries || []
  s.paused = saved.paused || {}
  return s
}

export async function loadState() {
  const saved = await readSaved()
  if (saved) state = migrate(saved)
  ensureAnkiProfile()
  try { navigator.storage?.persist?.() } catch { /* not supported */ }
  version++
  listeners.forEach((l) => l())
  channel && (channel.onmessage = async (msg) => {
    if (msg.data?.from === tabId) return
    const fresh = await readSaved()
    if (fresh) { state = migrate(fresh); version++; listeners.forEach((l) => l()) }
  })
}

export const getState = () => state

/** Other saved values (the sync snapshot) - kept apart from the state so it isn't rewritten on
 *  every change. */
export const readExtra = (key) => readSaved(key)
export const writeExtra = (key, value) => writeSaved(value, key)

/** Calls [fn] after every change. */
export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Runs [fn] on the state (mutating it), then saves and re-renders. */
export function update(fn) {
  fn(state)
  // Fresh references, so views memoized on them (useMemo deps) recompute.
  state = { ...state, entries: state.entries.slice(), profiles: state.profiles.slice(), zoo: { ...state.zoo }, race: { ...state.race }, friends: { ...state.friends }, settings: { ...state.settings }, sync: { ...state.sync } }
  version++
  listeners.forEach((l) => l())
  // Saved straight away (several updates in one tick are written once) - a debounce lost changes
  // made just before the page was reloaded or closed.
  if (!savePending) {
    savePending = true
    queueMicrotask(() => { savePending = false; writeSaved(state) })
  }
}

/** Saves right away - before the page goes away. */
export function flush() {
  return writeSaved(state)
}

export function replaceState(next) {
  state = migrate(next)
  ensureAnkiProfile()
  update(() => {})
}

export function useStore() {
  const [, setV] = useState(version)
  useEffect(() => {
    const l = () => setV(version)
    listeners.add(l)
    return () => listeners.delete(l)
  }, [])
  return state
}

/** Re-renders every [ms] - for live timers. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

/* ------------------------------------------------------------------------------------------------
 * Tracking actions - the same rules as the phone's TrackingRepository.
 * --------------------------------------------------------------------------------------------- */

function ensureAnkiProfile() {
  if (state.profiles.some((p) => p.isAnki)) return
  const id = state.profiles.some((p) => p.id === ANKI_ID) ? uid() : ANKI_ID
  state.profiles.push(newProfile({ id, name: 'Anki', colorHex: ANKI_COLOR, isAnki: true, sortOrder: 9999 }))
}

export function newProfile(fields = {}) {
  const id = uid()
  return {
    id,
    name: '',
    colorHex: '#4370A3',
    gradientColors: null,
    scriptDetectors: [],
    keywords: [],
    sortOrder: state.profiles.length + 1,
    podcastGoalMinutes: 0,
    readingGoalMinutes: 0,
    isMain: false,
    isAnki: false,
    ...fields,
  }
}

export const profileById = (id) => state.profiles.find((p) => p.id === id)
export const runningEntry = (type) => state.entries.find((e) => e.endTimeMillis == null && e.contentType === type)

function minEntryMillis() {
  return state.settings.entryThresholdEnabled ? state.settings.entryThresholdSeconds * 1000 : 1000
}

/** Closes whatever is running for [type] at [at], dropping it when it's shorter than the minimum. */
function closeRunning(s, type, at) {
  const min = minEntryMillis()
  s.entries = s.entries.filter((e) => !(e.endTimeMillis == null && e.contentType === type && at - e.startTimeMillis < min))
  for (const e of s.entries) if (e.endTimeMillis == null && e.contentType === type) e.endTimeMillis = at
}

function addEntry(s, fields) {
  const entry = {
    id: uid(),
    startTimeMillis: Date.now(),
    endTimeMillis: null,
    mediaTitle: '',
    mediaArtist: '',
    appPackage: WEB_APP,
    languageProfileId: null,
    contentType: PODCAST,
    detectionReason: null,
    isManual: true,
    timeZone: localZone(),
    ...fields,
  }
  s.entries.push(entry)
  return entry
}

/** Every content type a session can run under - only one session runs at a time, across all of them. */
const ALL_TYPES = [PODCAST, READING, ANKI, LISTENING]

/** Starts a live timer, closing whatever was running (of any type - one session at a time).
 *  Returns the new entry's id. */
export function startManualEntry(type, languageProfileId, title) {
  let id = null
  update((s) => {
    const now = Date.now()
    delete s.paused[type]
    for (const t of ALL_TYPES) closeRunning(s, t, now)
    id = addEntry(s, {
      startTimeMillis: now,
      contentType: type,
      languageProfileId,
      mediaTitle: title || '',
      detectionReason: languageProfileId != null ? 'Manually started' : null,
    }).id
  })
  return id
}

/** Undo for a stop or a discard: the session runs on from where it started, as if never stopped -
 *  closing anything started since, since only one session runs at a time. */
export function reopenEntry(snapshot) {
  update((s) => {
    const now = Date.now()
    for (const t of ALL_TYPES) closeRunning(s, t, now)
    delete s.paused[snapshot.contentType]
    const e = s.entries.find((x) => x.id === snapshot.id)
    if (e) e.endTimeMillis = null
    else {
      const { id, ...fields } = snapshot
      addEntry(s, { ...fields, endTimeMillis: null })
    }
  })
}

/** Removes one entry outright (undoing a start). */
export function discardEntry(id) {
  update((s) => { s.entries = s.entries.filter((e) => e.id !== id) })
}

export function stopRunningEntry(type) {
  update((s) => {
    delete s.paused[type]
    closeRunning(s, type, Date.now())
  })
}

/** Pause = close the running entry, remembering what it was so Resume starts the same again. */
export function pauseRunningEntry(type) {
  update((s) => {
    const r = s.entries.find((e) => e.endTimeMillis == null && e.contentType === type)
    if (!r) return
    s.paused[type] = { title: r.mediaTitle, languageProfileId: r.languageProfileId }
    closeRunning(s, type, Date.now())
  })
}

export function resumePaused(type) {
  const p = state.paused[type]
  if (p) startManualEntry(type, p.languageProfileId, p.title)
}

export function dismissPaused(type) {
  update((s) => { delete s.paused[type] })
}

export function deleteRunningEntry(type) {
  update((s) => {
    delete s.paused[type]
    s.entries = s.entries.filter((e) => !(e.endTimeMillis == null && e.contentType === type))
  })
}

/** Renames what's running for [type] (a quick start begins as "Manual Japanese session"). */
export function editRunningTitle(type, title) {
  update((s) => {
    const r = s.entries.find((e) => e.endTimeMillis == null && e.contentType === type)
    if (r) r.mediaTitle = title
  })
}

export function editRunningElapsed(type, elapsedMillis) {
  update((s) => {
    const r = s.entries.find((e) => e.endTimeMillis == null && e.contentType === type)
    if (r) r.startTimeMillis = Date.now() - Math.max(0, elapsedMillis)
  })
}

/** Logs a session that already happened. A past day ends it at that day's same clock time as now
 *  (pushed later if it would start before that day's midnight). */
export function logCompletedManualEntry(type, languageProfileId, title, elapsedMillis, dayStartMs = null) {
  update((s) => {
    const elapsed = Math.max(0, elapsedMillis)
    const now = new Date()
    let start
    const todayStart = new Date(now).setHours(0, 0, 0, 0)
    if (dayStartMs == null || dayStartMs >= todayStart) {
      start = now.getTime() - elapsed
    } else {
      const d = new Date(dayStartMs)
      d.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds())
      start = Math.max(dayStartMs, d.getTime() - elapsed)
    }
    addEntry(s, {
      startTimeMillis: start,
      endTimeMillis: start + elapsed,
      contentType: type,
      languageProfileId,
      mediaTitle: title || '',
      detectionReason: languageProfileId != null ? 'Manually logged' : null,
    })
  })
}

export function editEntry(id, changes) {
  update((s) => {
    const e = s.entries.find((x) => x.id === id)
    if (!e) return
    if ('languageProfileId' in changes) e.detectionReason = changes.languageProfileId != null ? 'Manually assigned' : null
    Object.assign(e, changes)
  })
}

export function deleteEntries(ids) {
  const set = new Set(ids)
  update((s) => { s.entries = s.entries.filter((e) => !set.has(e.id)) })
}

export function deleteAllUncategorized() {
  update((s) => { s.entries = s.entries.filter((e) => e.languageProfileId != null || e.endTimeMillis == null) })
}

/** Adds finished entries, skipping any whose exact start and end are already there for the same
 *  source - so importing the same file twice is safe. Returns how many were added. */
export function importEntries(list) {
  let added = 0
  update((s) => {
    const have = new Set(s.entries.map((e) => `${e.appPackage}:${e.startTimeMillis}:${e.endTimeMillis}`))
    for (const e of list) {
      const key = `${e.appPackage}:${e.startTimeMillis}:${e.endTimeMillis}`
      if (have.has(key)) continue
      have.add(key)
      addEntry(s, e)
      added++
    }
  })
  return added
}

export function upsertProfile(profile) {
  update((s) => {
    if (profile.isMain) s.profiles.forEach((p) => { if (p.id !== profile.id) p.isMain = false })
    const i = s.profiles.findIndex((p) => p.id === profile.id)
    if (i >= 0) s.profiles[i] = profile
    else s.profiles.push(profile)
  })
}

/** Deletes a language; entries already logged under it stay but lose their language. */
export function deleteProfile(id) {
  update((s) => {
    s.profiles = s.profiles.filter((p) => p.id !== id)
    s.entries.forEach((e) => { if (e.languageProfileId === id) { e.languageProfileId = null; e.detectionReason = null } })
  })
}

export function setSetting(key, value) {
  update((s) => { s.settings[key] = value })
}

export { uuid, PODCAST, READING, ANKI, LISTENING }
