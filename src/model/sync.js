// Account sync with the web sync server (sync-backend/Code.gs). Nothing here touches the race server.
//
// The state is seen as records - entries, languages, Zoo logs and a few settings groups - each with
// an id. A snapshot of every record as last agreed with the server is kept on the side; a sync
// pushes whatever differs from it (new, changed, or gone = a tombstone), then pulls everything the
// server has after the last revision this device saw and applies it. The newest edit wins per
// record, decided on the server.
import { getState, update, readExtra, writeExtra, subscribe } from '../store.js'
import { remapIds } from './ids.js'

/** The built-in sync server (sync-backend/Code.gs, deployed 2026-10-16 - see its SETUP.md). A
 *  different one can still be pasted in Settings. */
export const DEFAULT_SYNC_URL = 'https://script.google.com/macros/s/AKfycbyUSUQGINveSTIe7dHbXphSkEUe6QWcH2q8kUoE4ls5M-PORVKO9ZQ6B-XueUnjYO1v/exec'
const SNAPSHOT_KEY = 'syncSnapshot'
const PUSH_CHUNK = 1500
const AUTO_DELAY = 4000
const PERIODIC = 2 * 60 * 1000

export const syncUrl = () => getState().sync.url || DEFAULT_SYNC_URL
export const signedIn = () => !!getState().sync.token

const SETTINGS_KEYS = ['showRaceTab', 'showZooTab', 'showAnkiOnHome', 'logUncategorized', 'entryThresholdEnabled', 'entryThresholdSeconds',
  'uiColorPreset', 'ringStyle', 'titleStyleMode', 'goalCardStyleMode', 'entryLabelStyle']
const RACE_KEYS = ['userId', 'name', 'emoji', 'chartColor', 'serverUrl', 'deleted', 'archive', 'barPalette', 'barOrder']
const FRIEND_KEYS = ['share', 'banner', 'background', 'avatar']
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]))

/** Every record in [s], as coll -> id -> JSON text. */
export function collect(s) {
  const out = { entry: new Map(), profile: new Map(), opening: new Map(), grant: new Map(), tradeIn: new Map(), egg: new Map(), prefs: new Map() }
  for (const e of s.entries) out.entry.set(String(e.id), JSON.stringify(e))
  for (const p of s.profiles) out.profile.set(String(p.id), JSON.stringify(p))
  for (const o of s.zoo.openings) out.opening.set(String(o.id), JSON.stringify(o))
  for (const g of s.zoo.grants) out.grant.set(String(g.id), JSON.stringify(g))
  for (const t of s.zoo.tradeIns) out.tradeIn.set(String(t.id), JSON.stringify(t))
  for (const [k, egg] of Object.entries(s.zoo.eggs)) out.egg.set(k, JSON.stringify(egg))
  out.prefs.set('settings', JSON.stringify(pick(s.settings, SETTINGS_KEYS)))
  out.prefs.set('race', JSON.stringify(pick(s.race, RACE_KEYS)))
  out.prefs.set('friends', JSON.stringify(pick(s.friends, FRIEND_KEYS)))
  out.prefs.set('zoo', JSON.stringify({ base: s.zoo.base, trophyId: s.zoo.trophyId }))
  out.prefs.set('paused', JSON.stringify(s.paused || {}))
  return out
}

/** Records that differ from [snap] (coll -> {id: json}). */
export function diff(cur, snap, now = Date.now()) {
  const changes = []
  for (const [coll, map] of Object.entries(cur)) {
    const old = snap[coll] || {}
    for (const [id, json] of map) if (old[id] !== json) changes.push({ coll, id, updatedAt: now, deleted: false, data: JSON.parse(json) })
    for (const id of Object.keys(old)) if (!map.has(id)) changes.push({ coll, id, updatedAt: now, deleted: true, data: null })
  }
  return changes
}

const LISTS = { entry: (s) => s.entries, profile: (s) => s.profiles, opening: (s) => s.zoo.openings, grant: (s) => s.zoo.grants, tradeIn: (s) => s.zoo.tradeIns }
const SET_LIST = { entry: (s, v) => { s.entries = v }, profile: (s, v) => { s.profiles = v }, opening: (s, v) => { s.zoo.openings = v }, grant: (s, v) => { s.zoo.grants = v }, tradeIn: (s, v) => { s.zoo.tradeIns = v } }

/** Puts server [records] into [s]. */
export function applyRecords(s, records) {
  const byColl = {}
  for (const r of records) (byColl[r.coll] = byColl[r.coll] || []).push(r)
  for (const [coll, list] of Object.entries(byColl)) {
    if (LISTS[coll]) {
      const items = new Map(LISTS[coll](s).map((x) => [String(x.id), x]))
      for (const r of list) {
        if (r.deleted) items.delete(r.id)
        else items.set(r.id, r.data)
      }
      SET_LIST[coll](s, [...items.values()])
    } else if (coll === 'egg') {
      for (const r of list) {
        if (r.deleted) delete s.zoo.eggs[r.id]
        else s.zoo.eggs[r.id] = r.data
      }
    } else if (coll === 'prefs') {
      for (const r of list) {
        if (r.deleted || !r.data) continue
        if (r.id === 'settings') s.settings = { ...s.settings, ...r.data }
        if (r.id === 'race') s.race = { ...s.race, ...r.data }
        if (r.id === 'friends') s.friends = { ...s.friends, ...r.data }
        if (r.id === 'zoo') s.zoo = { ...s.zoo, base: r.data.base ?? s.zoo.base, trophyId: r.data.trophyId ?? null }
        if (r.id === 'paused') s.paused = r.data || {}
      }
    }
  }
  // Only ever one running session per type: if two devices each started one, keep the newest.
  const running = new Map()
  for (const e of s.entries) {
    if (e.endTimeMillis != null) continue
    const other = running.get(e.contentType)
    if (!other || e.startTimeMillis > other.startTimeMillis) running.set(e.contentType, e)
  }
  for (const e of s.entries) {
    if (e.endTimeMillis == null && running.get(e.contentType) !== e) e.endTimeMillis = running.get(e.contentType).startTimeMillis
  }
}

/** What makes two records the same thing under different ids - a phone backup imported here
 *  before the phone joined the account gives every session a second id. Same rules as the phone's
 *  WebSyncCodec.naturalKey. */
export function naturalKey(coll, id, d) {
  if (!d) return null
  switch (coll) {
    case 'entry': return `${d.startTimeMillis}:${d.endTimeMillis ?? null}:${d.contentType}`
    case 'profile': return d.isAnki ? 'anki' : String(d.name || '').trim().toLowerCase()
    case 'opening': return `${d.animalId}:${d.atMillis}`
    case 'grant': return `${d.rarity}:${d.atMillis}:${d.source}`
    case 'tradeIn': return `${d.animalId}:${d.atMillis}`
    default: return null
  }
}

/** Drops this device's copies of incoming records that are the same thing under another id, and
 *  points references at the incoming id - so they end up one record, not two. */
export function dedupeAgainst(s, records) {
  const cur = collect(s)
  const index = {}
  for (const [coll, map] of Object.entries(cur)) {
    for (const [id, json] of map) {
      const k = naturalKey(coll, id, JSON.parse(json))
      if (k != null) (index[coll] ||= new Map()).set(k, id)
    }
  }
  const profileMoves = new Map()
  const openingMoves = new Map()
  const grantMoves = new Map()
  for (const r of records) {
    if (r.deleted || !r.data || cur[r.coll]?.has(r.id)) continue
    const twin = index[r.coll]?.get(naturalKey(r.coll, r.id, r.data))
    if (twin == null || twin === r.id) continue
    const list = LISTS[r.coll]?.(s)
    if (!list) continue
    SET_LIST[r.coll](s, list.filter((x) => String(x.id) !== twin))
    if (r.coll === 'profile') profileMoves.set(Number(twin), Number(r.id))
    if (r.coll === 'opening') openingMoves.set(Number(twin), Number(r.id))
    if (r.coll === 'grant') grantMoves.set(Number(twin), Number(r.id))
  }
  for (const e of s.entries) if (profileMoves.has(e.languageProfileId)) e.languageProfileId = profileMoves.get(e.languageProfileId)
  for (const t of s.zoo.tradeIns) {
    if (openingMoves.has(t.openingId)) t.openingId = openingMoves.get(t.openingId)
    if (grantMoves.has(t.grantId)) t.grantId = grantMoves.get(t.grantId)
  }
}

/* ------------------------------------------------------------------------------------------------ */

const listeners = new Set()
export const syncStatus = { busy: false }
export function onSyncStatus(fn) { listeners.add(fn); return () => listeners.delete(fn) }
const setBusy = (busy) => { syncStatus.busy = busy; listeners.forEach((l) => l()) }

async function call(body, url = syncUrl()) {
  if (!url) throw new Error('No sync server link yet')
  let res
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
  } catch {
    throw new Error("Couldn't reach the sync server - check your connection")
  }
  if (!res.ok) throw new Error(`The sync server answered with an error (${res.status})`)
  let json
  try { json = JSON.parse(await res.text()) } catch { throw new Error("That link didn't answer like the sync server") }
  if (!json.ok) throw new Error(json.error || 'The sync server refused that')
  return json
}

let snapshot = null
async function loadSnapshot() {
  if (!snapshot) snapshot = (await readExtra(SNAPSHOT_KEY)) || {}
  return snapshot
}
async function saveSnapshot() {
  await writeExtra(SNAPSHOT_KEY, snapshot)
}

const deviceName = () => {
  const ua = navigator.userAgent
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : /Linux/.test(ua) ? 'Linux' : 'Device'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'browser'
  return `${os} · ${browser}`
}

/** Pulls every page after this device's last revision and applies it. [cur] is what was pushed
 *  from (records edited locally since are left for the next round). */
async function pullAll(token, cur) {
  let since = getState().sync.sinceRev || 0
  for (;;) {
    const res = await call({ action: 'pull', token, sinceRev: since })
    const now = collect(getState())
    const take = res.records.filter((r) => {
      const local = now[r.coll]?.get(r.id)
      return !cur || local === cur[r.coll]?.get(r.id) // untouched since the push began
    })
    since = res.rev
    update((s) => {
      dedupeAgainst(s, take)
      applyRecords(s, take)
      s.sync.sinceRev = since
    })
    // What the apply just produced is now agreed - record it, so it isn't pushed straight back.
    const after = collect(getState())
    for (const r of take) {
      const m = snapshot[r.coll] ||= {}
      const v = after[r.coll]?.get(r.id)
      if (v == null) delete m[r.id]
      else m[r.id] = v
    }
    if (!res.more) break
  }
}

let running = null
/** One full round: push local changes, pull the rest. Runs one at a time. */
export function syncNow() {
  if (running) { running.again = true; return running.promise }
  const job = { again: false }
  job.promise = (async () => {
    setBusy(true)
    try {
      do {
        job.again = false
        await round()
      } while (job.again)
      update((s) => { s.sync.lastSync = Date.now(); s.sync.error = '' })
    } catch (err) {
      update((s) => { s.sync.error = err.message })
    } finally {
      running = null
      setBusy(false)
    }
  })()
  running = job
  return job.promise
}

async function round() {
  const { token } = getState().sync
  if (!token) return
  await loadSnapshot()
  const cur = collect(getState())
  const changes = diff(cur, snapshot)
  // Never let one device empty the account: if most of the history suddenly looks deleted here
  // (storage cleared, a broken load), don't send that - stop and say so.
  const deletes = changes.filter((c) => c.deleted && c.coll !== 'prefs').length
  const known = Object.entries(snapshot).filter(([c]) => c !== 'prefs').reduce((t, [, m]) => t + Object.keys(m).length, 0)
  if (deletes > 20 && deletes > known / 2) {
    throw new Error(`Sync paused: ${deletes} records are missing on this device. Sign out and back in here to get your data back from the account.`)
  }
  for (let i = 0; i < changes.length; i += PUSH_CHUNK) {
    const chunk = changes.slice(i, i + PUSH_CHUNK)
    await call({ action: 'push', token, changes: chunk })
    for (const c of chunk) {
      const m = (snapshot[c.coll] ||= {})
      if (c.deleted) delete m[c.id]
      else m[c.id] = cur[c.coll].get(c.id)
    }
  }
  await pullAll(token, cur)
  await saveSnapshot()
}

/** Turns sync on with a brand new account holding this device's data. */
export async function createAccount(url) {
  const res = await call({ action: 'create', name: getState().race.name, deviceName: deviceName() }, url || syncUrl())
  snapshot = {}
  update((s) => {
    remapIds(s)
    s.sync = { ...s.sync, url: url || s.sync.url, token: res.token, accountId: res.accountId, sinceRev: 0, error: '' }
  })
  await saveSnapshot()
  await syncNow()
}

/** Signs this device into an existing account - with a link code from another device, or a
 *  recovery key. The account's data comes first (its race identity and settings win), then this
 *  device's own records are added to it. */
export async function joinAccount({ code, key, url }) {
  let token = key?.trim()
  let accountId = ''
  if (code) {
    const res = await call({ action: 'linkClaim', code: code.trim().toUpperCase(), deviceName: deviceName() }, url || syncUrl())
    token = res.token
    accountId = res.accountId
  }
  if (!token) throw new Error('Enter a code or your recovery key')
  snapshot = {}
  update((s) => {
    remapIds(s)
    s.sync = { ...s.sync, url: url || s.sync.url, token, accountId, sinceRev: 0, error: '' }
  })
  // The account's version of every shared setting wins over this device's - pull before pushing,
  // and count this device's settings as already agreed so they aren't sent over the account's.
  await pullAll(token, null)
  const after = collect(getState())
  snapshot.prefs = Object.fromEntries(after.prefs)
  await saveSnapshot()
  await syncNow()
}

export async function linkCode() {
  return call({ action: 'linkCode', token: getState().sync.token })
}

export async function listDevices() {
  return (await call({ action: 'devices', token: getState().sync.token })).devices
}

export async function unlinkDevice(deviceId) {
  return call({ action: 'unlink', token: getState().sync.token, deviceId })
}

/** Signs this device out: its data stays here, it just stops syncing. */
export async function signOut({ tellServer = true } = {}) {
  if (tellServer) { try { await call({ action: 'unlink', token: getState().sync.token }) } catch { /* offline - still sign out here */ } }
  snapshot = {}
  await saveSnapshot()
  update((s) => { s.sync = { ...s.sync, token: '', accountId: '', sinceRev: 0, lastSync: 0, error: '' } })
}

/** Syncs a few seconds after any change, every couple of minutes, and when the page comes back. */
export function startAutoSync() {
  let timer = null
  const check = async () => {
    if (!signedIn()) return
    await loadSnapshot()
    if (diff(collect(getState()), snapshot).length) syncNow()
  }
  subscribe(() => {
    if (!signedIn()) return
    clearTimeout(timer)
    timer = setTimeout(check, AUTO_DELAY)
  })
  setInterval(() => { if (signedIn() && document.visibilityState === 'visible') syncNow() }, PERIODIC)
  document.addEventListener('visibilitychange', () => { if (signedIn() && document.visibilityState === 'visible') syncNow() })
  if (signedIn()) syncNow()
}
