// The Zoo, ported from ZooRepository / ZooRules / Certificates: an egg per 10 hours of immersion,
// hatch odds Mythic 1% / Legendary 5% / Epic 10% / Rare 30% / else Common, 5-for-1 trade-ups into
// a coloured egg of the next tier, birth certificates on Epic+ copies and a 25% foil chance on eggs
// earned while Momentum was gold. Everything is an append-only log, like on the phone.
import { getState, update, uid } from '../store.js'
import { counts, immersionTotal, isGolden } from './rules.js'
import { HOUR } from './time.js'
import { myLiveRaceMillis, bestFirst } from './race.js'

export const RARITIES = ['GREEN', 'BLUE', 'PURPLE', 'ORANGE', 'RAINBOW']
export const RARITY_LABEL = { GREEN: 'Common', BLUE: 'Rare', PURPLE: 'Epic', ORANGE: 'Legendary', RAINBOW: 'Mythic' }
export const RARITY_COLOR = { GREEN: '#4CAF50', BLUE: '#3D8BFD', PURPLE: '#A855F7', ORANGE: '#FF9F1C', RAINBOW: '#FF4FD8' }
export const HOURS_PER_BOX = 10
export const TRADE_UP_COUNT = 5
export const FOIL_CHANCE_PERCENT = 25
export const LOOT_BOX_ODDS = [['RAINBOW', 1], ['ORANGE', 5], ['PURPLE', 10], ['BLUE', 30]]
const NATIVE_WINDOW_MILLIS = HOURS_PER_BOX * HOUR

export const nextRarity = (r) => RARITIES[RARITIES.indexOf(r) + 1] || null
export const rarityOf = (id) => {
  const r = String(id || '').toUpperCase()
  return r === 'GREY' ? 'GREEN' : RARITIES.includes(r) ? r : null
}
export const carriesCertificate = (r) => RARITIES.indexOf(r) >= RARITIES.indexOf('PURPLE')

/** Cryptographic randomness for every roll, like the phone's SecureRandom. */
export function randomInt(n) {
  const buf = new Uint32Array(1)
  const limit = Math.floor(0x100000000 / n) * n
  let x
  do { crypto.getRandomValues(buf); x = buf[0] } while (x >= limit)
  return x % n
}

export function lootBoxTier(roll) {
  let acc = 0
  for (const [tier, pct] of LOOT_BOX_ODDS) {
    acc += pct
    if (roll < acc) return tier
  }
  return 'GREEN'
}

let catalog = null
let catalogPromise = null
export function loadCatalog() {
  if (catalog) return Promise.resolve(catalog)
  catalogPromise ||= fetch('zoo/animals.json').then((r) => r.json()).then((list) => {
    catalog = list.map((a) => ({ ...a, rarity: rarityOf(a.rarity) })).filter((a) => a.rarity)
    return catalog
  })
  return catalogPromise
}
export const catalogNow = () => catalog
export const animalById = (id) => catalog?.find((a) => a.id === id)

/* ------------------------------------------------------------------------------------------------ */

/** Credits (hours) earned: the head start fixed once, plus one per hour of immersion since. */
export function earnedHours(s, immersion) {
  const base = s.zoo.base
  if (!base) return 0
  return base.credits + Math.floor(Math.max(0, immersion - base.immersionMillis) / HOUR)
}

/** Fixes this browser's starting point the first time the Zoo runs: hours in a live race count as
 *  a head start, then one credit per hour of immersion from here on (like a fresh phone install). */
export function ensureBase() {
  const s = getState()
  if (s.zoo.base) return
  update((st) => {
    st.zoo.base = { immersionMillis: immersionTotal(st.entries), credits: Math.floor(myLiveRaceMillis() / HOUR) }
  })
}

export function zooState(s, now = Date.now()) {
  const immersion = immersionTotal(s.entries, now)
  const earned = earnedHours(s, immersion)
  const progressMs = s.zoo.base ? Math.max(0, immersion - s.zoo.base.immersionMillis) % HOUR : 0
  const boxesOpened = s.zoo.openings.filter((o) => o.rarity === 'BOX').length
  const boxesReady = Math.max(0, Math.floor(earned / HOURS_PER_BOX) - boxesOpened)
  const doneMinutes = (earned % HOURS_PER_BOX) * 60 + Math.floor(progressMs / 60000)
  const minutesToNext = Math.max(1, HOURS_PER_BOX * 60 - doneMinutes)
  const coloured = {}
  for (const r of RARITIES) {
    const given = s.zoo.grants.filter((g) => g.rarity === r).length
    const opened = s.zoo.openings.filter((o) => o.rarity === r).length
    coloured[r] = Math.max(0, given - opened)
  }
  return {
    immersion,
    earned,
    boxesReady,
    boxesOpened,
    boxProgress: doneMinutes / (HOURS_PER_BOX * 60),
    timeToNextBox: minutesToNext >= 60 ? `${Math.floor(minutesToNext / 60)}h ${minutesToNext % 60}m` : `${minutesToNext}m`,
    coloured,
    copies: copiesHeld(s),
  }
}

/** Copies of each animal still held, best first. */
export function copiesHeld(s) {
  const traded = new Set(s.zoo.tradeIns.map((t) => t.openingId).filter((x) => x != null))
  const legacy = {}
  for (const t of s.zoo.tradeIns) if (t.openingId == null) legacy[t.animalId] = (legacy[t.animalId] || 0) + 1
  const out = {}
  for (const o of s.zoo.openings) {
    if (traded.has(o.id)) continue
    ;(out[o.animalId] = out[o.animalId] || []).push(o)
  }
  for (const [id, list] of Object.entries(out)) {
    list.sort(bestFirst)
    const drop = Math.min(legacy[id] || 0, list.length)
    if (drop) list.splice(list.length - drop, drop)
    if (!list.length) delete out[id]
  }
  return out
}

export const everFound = (s) => new Set(s.zoo.openings.map((o) => o.animalId))

/* ------------------------------------------------------------------------------------------------
 * Certificates
 * --------------------------------------------------------------------------------------------- */

export function immersionReachedAt(entries, target, now) {
  const list = entries.filter((e) => counts(e.contentType, e.languageProfileId)).sort((a, b) => a.startTimeMillis - b.startTimeMillis)
  if (target <= 0) return list[0]?.startTimeMillis ?? null
  let total = 0
  for (const e of list) {
    const len = Math.max(0, (e.endTimeMillis ?? now) - e.startTimeMillis)
    if (total + len >= target) return e.startTimeMillis + (target - total)
    total += len
  }
  return null
}

export function computeCertificate(entries, profiles, at) {
  const imm = entries.filter((e) => counts(e.contentType, e.languageProfileId) && e.startTimeMillis < at)
  const partBefore = (e) => Math.max(0, Math.min(e.endTimeMillis ?? at, at) - e.startTimeMillis)
  const total = imm.reduce((t, e) => t + partBefore(e), 0)
  const byLang = new Map()
  let covered = 0
  for (const e of [...imm].sort((a, b) => b.startTimeMillis - a.startTimeMillis)) {
    if (covered >= NATIVE_WINDOW_MILLIS) break
    const part = Math.min(partBefore(e), NATIVE_WINDOW_MILLIS - covered)
    byLang.set(e.languageProfileId, (byLang.get(e.languageProfileId) || 0) + part)
    covered += part
  }
  let nativeId = null, best = -1
  for (const [id, ms] of byLang) if (ms > best) { best = ms; nativeId = id }
  const native = profiles.find((p) => p.id === nativeId)
  const latest = imm.filter((e) => e.mediaTitle?.trim()).sort((a, b) => b.startTimeMillis - a.startTimeMillis)[0]
  return {
    hourMark: imm.length ? Math.floor(total / HOUR) : null,
    languageName: native?.name ?? null,
    languageColor: native?.colorHex ?? null,
    mediaTitle: latest?.mediaTitle?.trim() ?? null,
  }
}

function eggEarnedAt(s, n, now) {
  const base = s.zoo.base
  const needed = n * HOURS_PER_BOX
  const target = base.immersionMillis + Math.max(0, (needed - base.credits) * HOUR)
  return immersionReachedAt(s.entries, target, now) ?? now
}

function snapshotEgg(s, earnedAt) {
  const c = computeCertificate(s.entries, s.profiles, earnedAt)
  return { earnedAt, golden: isGolden(s.entries, earnedAt), ...c }
}

/** Records every egg earned and not yet recorded, as of when its 10-hour mark was crossed - so
 *  editing history later can't change what an egg hatches as. */
export function recordEarnedEggs() {
  const s = getState()
  if (!s.zoo.base) return
  const now = Date.now()
  const earned = Math.floor(earnedHours(s, immersionTotal(s.entries, now)) / HOURS_PER_BOX)
  const hatched = s.zoo.openings.filter((o) => o.rarity === 'BOX').length
  const missing = []
  for (let n = hatched + 1; n <= earned; n++) if (!s.zoo.eggs[`box:${n}`]) missing.push(n)
  if (!missing.length) return
  update((st) => {
    for (const n of missing) st.zoo.eggs[`box:${n}`] = snapshotEgg(st, eggEarnedAt(st, n, now))
  })
}

function certify(egg, rarity) {
  const foil = egg.golden && randomInt(100) < FOIL_CHANCE_PERCENT
  if (!carriesCertificate(rarity)) return foil ? { foil: true } : null
  return { hourMark: egg.hourMark, languageName: egg.languageName, languageColor: egg.languageColor, mediaTitle: egg.mediaTitle, foil }
}

/** Hatches the oldest egg from immersion. Returns {animal, copies, cert} or null. */
export async function hatchLootEgg() {
  const animals = await loadCatalog()
  const s = getState()
  const z = zooState(s)
  if (z.boxesReady <= 0) return null
  const tier = lootBoxTier(randomInt(100))
  const pool = animals.filter((a) => a.rarity === tier)
  if (!pool.length) return null
  const animal = pool[randomInt(pool.length)]
  const n = z.boxesOpened + 1
  const now = Date.now()
  let result = null
  update((st) => {
    const egg = st.zoo.eggs[`box:${n}`] || (st.zoo.eggs[`box:${n}`] = snapshotEgg(st, eggEarnedAt(st, n, now)))
    const cert = certify(egg, animal.rarity)
    st.zoo.openings.push({ id: uid(), rarity: 'BOX', animalId: animal.id, atMillis: now, upgradeKey: false, cert })
    result = { animal, cert, copies: st.zoo.openings.filter((o) => o.animalId === animal.id).length, fromBox: true }
  })
  return result
}

/** Hatches a coloured egg (from a trade-up) - always that colour. */
export async function hatchColouredEgg(rarity) {
  const animals = await loadCatalog()
  const s = getState()
  if (zooState(s).coloured[rarity] <= 0) return null
  const pool = animals.filter((a) => a.rarity === rarity)
  if (!pool.length) return null
  const animal = pool[randomInt(pool.length)]
  const now = Date.now()
  let result = null
  update((st) => {
    const offset = st.zoo.openings.filter((o) => o.rarity === rarity).length
    const grant = st.zoo.grants.filter((g) => g.rarity === rarity).sort((a, b) => a.id - b.id)[offset]
    const key = `grant:${grant?.id ?? 'none'}`
    const egg = st.zoo.eggs[key] || snapshotEgg(st, grant?.atMillis ?? now)
    if (grant) st.zoo.eggs[key] = egg
    const cert = certify(egg, animal.rarity)
    st.zoo.openings.push({ id: uid(), rarity, animalId: animal.id, atMillis: now, upgradeKey: true, cert })
    result = { animal, cert, copies: st.zoo.openings.filter((o) => o.animalId === animal.id).length, fromBox: false }
  })
  return result
}

/** Gives up exactly 5 copies of one tier (ids may repeat) for an egg of the next tier - the least
 *  special copies of each picked animal go. */
export function tradeUp(from, animalIds) {
  const to = nextRarity(from)
  if (!to || animalIds.length !== TRADE_UP_COUNT) return false
  if (animalIds.some((id) => animalById(id)?.rarity !== from)) return false
  const s = getState()
  const held = copiesHeld(s)
  const taken = {}
  const copies = []
  for (const id of animalIds) {
    taken[id] = (taken[id] || 0) + 1
    const list = held[id] || []
    const copy = list[list.length - taken[id]]
    if (!copy) return false
    copies.push(copy)
  }
  const now = Date.now()
  update((st) => {
    const grantId = uid()
    st.zoo.grants.push({ id: grantId, rarity: to, source: 'trade', atMillis: now })
    for (const c of copies) st.zoo.tradeIns.push({ id: uid(), animalId: c.animalId, grantId, atMillis: now, openingId: c.id })
    st.zoo.eggs[`grant:${grantId}`] = snapshotEgg(st, now)
    if (st.zoo.trophyId && !copiesHeld(st)[st.zoo.trophyId]) st.zoo.trophyId = null
  })
  return to
}

export function setTrophy(id) {
  update((s) => { s.zoo.trophyId = id })
}
