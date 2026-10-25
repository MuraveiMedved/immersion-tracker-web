// The Zoo, ported from ZooRepository / ZooRules / Certificates: an egg per 10 hours of immersion,
// hatch odds Mythic 1% / Legendary 5% / Epic 10% / Rare 30% / else Common, 5-for-1 trade-ups into
// a coloured egg of the next tier, birth certificates on Epic+ copies and a holo chance on eggs
// earned while Momentum is Bronze or better - 10/20/25/30% by tier. Everything is an append-only
// log, like on the phone. (Holo is stored as `foil`, the same as the phone and older records.)
import { getState, update, uid, isImported } from '../store.js'
import { counts, immersionTotal, vouchedEntries, goldenStreakDays, momentumTier, GOLDEN_DAYS } from './rules.js'
import { HOUR } from './time.js'
import { myLiveRaceMillis, bestFirst, raceConfigured, sync as raceSync, refreshFriends } from './race.js'

export const RARITIES = ['GREEN', 'BLUE', 'PURPLE', 'ORANGE', 'RAINBOW']
export const RARITY_LABEL = { GREEN: 'Common', BLUE: 'Rare', PURPLE: 'Epic', ORANGE: 'Legendary', RAINBOW: 'Mythic' }
export const RARITY_COLOR = { GREEN: '#4CAF50', BLUE: '#3D8BFD', PURPLE: '#A855F7', ORANGE: '#FF9F1C', RAINBOW: '#FF4FD8' }
export const HOURS_PER_BOX = 10
export const TRADE_UP_COUNT = 5
/** The holo chance for an egg earned with `momentumDays` of Momentum (Certificates.holoChancePercent). */
export const holoChancePercent = (momentumDays) => momentumTier(momentumDays)?.holoPercent ?? 0
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

/** Only immersion from this day on (local time) earns eggs - nothing tracked or imported from
 *  before it, and no head start. The phone's ZooRules.EGG_HOURS_FROM is the same day. */
export const eggHoursFrom = () => new Date(2026, 9, 2).getTime()

/** The immersion in `entries` that earns eggs: sessions from `from` on, one that started before
 *  it counting only from then. */
export function eggEntries(entries, from = eggHoursFrom()) {
  return entries
    .filter((e) => counts(e.contentType, e.languageProfileId) && (e.endTimeMillis ?? Infinity) > from)
    .map((e) => (e.startTimeMillis < from ? { ...e, startTimeMillis: from } : e))
}

/** Immersion earning eggs, as of `now`. */
export const eggImmersion = (entries, now = Date.now()) => immersionTotal(eggEntries(vouchedEntries(entries)), now)

/** Credits (hours) earned: one per hour of immersion from eggHoursFrom on. */
export function earnedHours(s, immersion) {
  return Math.floor(immersion / HOUR)
}

/** Fixes this browser's starting point the first time the Zoo runs: hours in a live race count as
 *  a head start, then one credit per hour of immersion from here on (like a fresh phone install). */
export function ensureBase() {
  const s = getState()
  if (s.zoo.base) return
  update((st) => {
    st.zoo.base = { immersionMillis: immersionTotal(vouchedEntries(st.entries)), credits: Math.floor(myLiveRaceMillis() / HOUR) }
  })
}

export function zooState(s, now = Date.now()) {
  const immersion = eggImmersion(s.entries, now)
  const earned = earnedHours(s, immersion)
  const progressMs = immersion % HOUR
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
  return immersionReachedAt(eggEntries(vouchedEntries(s.entries)), n * HOURS_PER_BOX * HOUR, now) ?? now
}

function snapshotEgg(s, earnedAt) {
  const c = computeCertificate(s.entries, s.profiles, earnedAt)
  const momentumDays = goldenStreakDays(s.entries, earnedAt)
  return { earnedAt, golden: momentumDays >= GOLDEN_DAYS, ...c, momentumDays }
}

/** Records every egg earned and not yet recorded, as of when its 10-hour mark was crossed - so
 *  editing history later can't change what an egg hatches as. */
export function recordEarnedEggs() {
  const s = getState()
  const now = Date.now()
  const earned = Math.floor(earnedHours(s, eggImmersion(s.entries, now)) / HOURS_PER_BOX)
  const hatched = s.zoo.openings.filter((o) => o.rarity === 'BOX').length
  const missing = []
  for (let n = hatched + 1; n <= earned; n++) if (!s.zoo.eggs[`box:${n}`]) missing.push(n)
  if (!missing.length) return
  update((st) => {
    for (const n of missing) st.zoo.eggs[`box:${n}`] = snapshotEgg(st, eggEarnedAt(st, n, now))
  })
}

/** How much Momentum `egg` was earned with. Eggs recorded before tiers only noted whether it was
 *  lit: those are read from history at the time - at least Bronze if lit (ZooRepository.momentumDaysOf). */
function momentumDaysOf(s, egg) {
  if (egg.momentumDays != null) return egg.momentumDays
  return egg.golden ? Math.max(GOLDEN_DAYS, goldenStreakDays(s.entries, egg.earnedAt)) : 0
}

function certify(s, egg, rarity) {
  const momentumDays = momentumDaysOf(s, egg)
  const foil = randomInt(100) < holoChancePercent(momentumDays)
  // momentumDays: its tier colours a holo card's pill (ZooCrateOpening.momentumDays).
  if (!carriesCertificate(rarity)) return foil ? { foil: true, momentumDays } : null
  // The hour is the person's total hours now, as it's unlocked - the egg's own moment of earning
  // was counted from the Zoo's start (which race hours set), not from all history.
  const hourMark = hourMarkAt(vouchedEntries(s.entries), Date.now()) ?? egg.hourMark
  return { hourMark, languageName: egg.languageName, languageColor: egg.languageColor, mediaTitle: egg.mediaTitle, foil, momentumDays }
}

/** The hour mark for a copy unlocked at `at`: total immersion hours by then, from the very first
 *  session (Certificates.hourMarkAt); null with none at all. */
export function hourMarkAt(entries, at) {
  const imm = entries.filter((e) => counts(e.contentType, e.languageProfileId) && e.startTimeMillis < at)
  if (!imm.length) return null
  return Math.floor(imm.reduce((t, e) => t + Math.max(0, Math.min(e.endTimeMillis ?? at, at) - e.startTimeMillis), 0) / HOUR)
}

/** Certificates whose hour came out too low (read from the Zoo's start, which race hours set,
 *  rather than all history) get the real total hours at the moment that copy was unlocked
 *  (ZooRepository.raiseCertificateHours). Only ever raised, so history still syncing in can't
 *  lower a correct one; runs whenever the Zoo opens. */
export function raiseCertificateHours() {
  const s = getState()
  const entries = vouchedEntries(s.entries)
  const fixes = []
  for (const o of s.zoo.openings) {
    if (o.cert?.hourMark == null) continue
    const hour = hourMarkAt(entries, o.atMillis)
    if (hour != null && hour > o.cert.hourMark) fixes.push([o.id, hour])
  }
  if (!fixes.length) return
  update((st) => {
    for (const [id, hour] of fixes) {
      const at = st.zoo.openings.findIndex((o) => o.id === id)
      if (at >= 0) st.zoo.openings[at] = { ...st.zoo.openings[at], cert: { ...st.zoo.openings[at].cert, hourMark: hour } }
    }
  })
}

/** Holo copies hatched before a copy kept its egg's Momentum get it once, from the egg they
 *  hatched from: the Nth loot opening = "box:N", coloured ones in their tier's trade-up order
 *  (ZooRepository.backfillHoloMomentum). One whose egg can't be found keeps the plain white pill. */
export function backfillHoloMomentum() {
  const s = getState()
  const pending = s.zoo.openings.filter((o) => o.cert?.foil && o.cert.momentumDays == null)
  if (!pending.length) return
  const ordered = [...s.zoo.openings].sort((a, b) => a.atMillis - b.atMillis || a.id - b.id)
  const found = []
  for (const o of pending) {
    let key = null
    if (o.rarity === 'BOX') {
      key = `box:${ordered.filter((x) => x.rarity === 'BOX').indexOf(o) + 1}`
    } else {
      const offset = ordered.filter((x) => x.rarity === o.rarity && !!x.upgradeKey === !!o.upgradeKey).indexOf(o)
      const grant = s.zoo.grants.filter((g) => g.rarity === o.rarity && (g.source === 'trade') === !!o.upgradeKey).sort((a, b) => a.id - b.id)[offset]
      if (grant) key = `grant:${grant.id}`
    }
    const egg = key && s.zoo.eggs[key]
    if (egg) found.push([o.id, momentumDaysOf(s, egg)])
  }
  if (!found.length) return
  update((st) => {
    for (const [id, days] of found) {
      const o = st.zoo.openings.find((x) => x.id === id)
      if (o?.cert) o.cert = { ...o.cert, momentumDays: days }
    }
  })
}

/** Whether `entries` hold CSV-imported sessions (Toggl Track, PolyLogger - from either app) from
 *  before eggHoursFrom: the only way hours from before it ever earned eggs. */
export const hasEarlyImports = (entries, from = eggHoursFrom()) => entries.some((e) => e.startTimeMillis < from && isImported(e.appPackage))

/**
 * Loot-box openings to take back because the hours behind them weren't earned from eggHoursFrom
 * on: with `allowedBoxes` earned, the first ones opened stay and the rest go - and so does every
 * trade-up that used a copy that goes (the copy it made goes too, and anything traded up from
 * that; the other copies given up come back). The phone's ZooRules.eggsToTakeBack, same rules.
 */
export function eggsToTakeBack(allowedBoxes, openings, grants, tradeIns) {
  const order = (a, b) => a.atMillis - b.atMillis || a.id - b.id
  const boxes = openings.filter((o) => o.rarity === 'BOX').sort(order)
  const none = { openings: new Set(), grants: new Set(), tradeIns: new Set() }
  if (boxes.length <= allowedBoxes) return none
  const tier = (r) => rarityOf(r) || r
  const goneOpenings = new Set()
  const goneGrants = new Set()
  const pending = boxes.slice(allowedBoxes).map((o) => o.id)
  while (pending.length) {
    const openingId = pending.shift()
    if (goneOpenings.has(openingId)) continue
    goneOpenings.add(openingId)
    for (const grantId of new Set(tradeIns.filter((t) => t.openingId === openingId).map((t) => t.grantId))) {
      if (goneGrants.has(grantId)) continue
      goneGrants.add(grantId)
      const grant = grants.find((g) => g.id === grantId)
      if (!grant) continue
      // Coloured eggs hatch in the order they were given: the trade-up's own copy is the one at
      // its place among that tier's trade-up grants.
      const place = grants.filter((g) => g.source === 'trade' && tier(g.rarity) === tier(grant.rarity)).sort((a, b) => a.id - b.id).indexOf(grant)
      const hatched = openings.filter((o) => o.upgradeKey && tier(o.rarity) === tier(grant.rarity)).sort(order)[place]
      if (hatched) pending.push(hatched.id)
    }
  }
  return { openings: goneOpenings, grants: goneGrants, tradeIns: new Set(tradeIns.filter((t) => goneGrants.has(t.grantId)).map((t) => t.id)) }
}

/**
 * Once per account: loot boxes opened beyond what hours from eggHoursFrom on earned are taken back
 * (eggsToTakeBack), with any trade-ups they went into, and eggs recorded past that count are
 * forgotten. Synced like any other change, and only this person's own Zoo is read or changed. On
 * an account it's called only straight after a finished sync round (sync.js), so it never judges
 * from half-arrived history and sees whether another device already did it (zoo.eggsTakenBack).
 * Every session counts, running ones up to now, wherever they're tracked - so an egg opened on
 * any device always finds the hours that earned it. Returns whether anything changed.
 */
export function takeBackEarlyEggs() {
  const s = getState()
  if (s.zoo.eggsTakenBack || s.settings.earlyEggsTakenBack) return false
  // Only a Zoo that a CSV import of older history fed is touched - how extra eggs came about.
  // Anyone else keeps every animal, whatever their hours.
  if (!hasEarlyImports(s.entries)) {
    update((st) => { st.settings.earlyEggsTakenBack = true; st.zoo.eggsTakenBack = true })
    return false
  }
  const allowed = Math.floor(earnedHours(s, immersionTotal(eggEntries(s.entries))) / HOURS_PER_BOX)
  const gone = eggsToTakeBack(allowed, s.zoo.openings, s.zoo.grants, s.zoo.tradeIns)
  update((st) => {
    if (gone.openings.size) {
      st.zoo.tradeIns = st.zoo.tradeIns.filter((t) => !gone.tradeIns.has(t.id))
      st.zoo.grants = st.zoo.grants.filter((g) => !gone.grants.has(g.id))
      st.zoo.openings = st.zoo.openings.filter((o) => !gone.openings.has(o.id))
      for (const key of Object.keys(st.zoo.eggs)) {
        const [kind, n] = key.split(':')
        if ((kind === 'box' && Number(n) > allowed) || (kind === 'grant' && gone.grants.has(Number(n)))) delete st.zoo.eggs[key]
      }
      const held = copiesHeld(st)
      st.zoo.trophyIds = normalizeTrophies((st.zoo.trophyIds || []).map((id) => (held[id] ? id : '')))
      st.zoo.trophyId = st.zoo.trophyIds.find(Boolean) || null
    }
    st.settings.earlyEggsTakenBack = true
    st.zoo.eggsTakenBack = true
  })
  // Friends' Recent finds (and profiles) show what was sent last - send the corrected one now.
  if (gone.openings.size && raceConfigured()) {
    raceSync().catch(() => {})
    refreshFriends().catch(() => {})
  }
  return gone.openings.size > 0
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
    const cert = certify(st, egg, animal.rarity)
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
    const cert = certify(st, egg, animal.rarity)
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
    const held = copiesHeld(st)
    st.zoo.trophyIds = normalizeTrophies((st.zoo.trophyIds || []).map((id) => (held[id] ? id : '')))
    st.zoo.trophyId = st.zoo.trophyIds.find(Boolean) || null
  })
  return to
}

/** The trophy case's size (the phone's TROPHY_CASE_SIZE). */
export const TROPHY_CASE_SIZE = 3

/** Trophy-case slots as kept (the phone's normalizeTrophies): at most TROPHY_CASE_SIZE, '' for an
 *  empty one, an animal in only one slot, no empty slots trailing. */
export function normalizeTrophies(ids) {
  const seen = new Set()
  const out = (ids || []).slice(0, TROPHY_CASE_SIZE).map((id) => {
    const v = String(id || '').trim()
    if (!v || seen.has(v)) return ''
    seen.add(v)
    return v
  })
  while (out.length && !out[out.length - 1]) out.pop()
  return out
}

/** The whole trophy case, slot by slot ('' = empty); its first filled slot is the profile's trophy. */
export function setTrophies(ids) {
  const list = normalizeTrophies(ids)
  update((s) => { s.zoo.trophyIds = list; s.zoo.trophyId = list.find(Boolean) || null })
}

/** Shows [id] on the profile: it goes into the first slot, the rest moving along after it (the
 *  last drops off a full case). Null empties the profile's slot. */
export function setTrophy(id) {
  const filled = (getState().zoo.trophyIds || []).filter(Boolean)
  setTrophies(id == null ? filled.slice(1) : [id, ...filled.filter((x) => x !== id)])
}

/** Puts [id] in trophy-case [slot] - replacing what's there, and leaving its old slot (if any) empty. */
export function setTrophySlot(slot, id) {
  const now = getState().zoo.trophyIds || []
  const list = Array.from({ length: TROPHY_CASE_SIZE }, (_, i) => (now[i] === id ? '' : now[i] || ''))
  list[Math.min(Math.max(slot, 0), TROPHY_CASE_SIZE - 1)] = id
  setTrophies(list)
}

/** Empties the slot [id] is in; the others stay where they are. */
export function removeFromTrophyCase(id) {
  setTrophies((getState().zoo.trophyIds || []).map((x) => (x === id ? '' : x)))
}

/** Race Weekly/Monthly rewards already collected, by prize key (sprints.js). */
export const takenPrizes = (s) => new Set([
  ...s.zoo.openings.filter((o) => String(o.rarity).startsWith('SPRINT:')).map((o) => o.rarity),
  ...(s.zoo.nametags || []).filter((t) => t.kind === 'earned').map((t) => t.id),
])

// Nametags (the phone's ZooNametag): a Monthly challenge's reward, spent naming an animal. A ledger
// of rows - earned (id = the prize key, so it's earned once everywhere) and spent (with the animal
// and the name). Held = earned - spent; an animal's name is its latest spent row's.
export const NAMETAG_MAX_LENGTH = 24
export function nametagsOf(s) {
  const rows = s.zoo.nametags || []
  const spent = rows.filter((t) => t.kind === 'spent')
  const names = {}
  for (const t of [...spent].sort((a, b) => a.atMillis - b.atMillis || String(a.id).localeCompare(String(b.id)))) {
    if (t.animalId && t.name) names[t.animalId] = t.name
  }
  return { held: Math.max(0, rows.filter((t) => t.kind === 'earned').length - spent.length), names }
}

/** Collects a Monthly challenge's nametag - false if it was already collected. */
export function claimNametag(key) {
  let added = false
  update((s) => {
    s.zoo.nametags = s.zoo.nametags || []
    if (s.zoo.nametags.some((t) => t.id === key)) return
    s.zoo.nametags.push({ id: key, kind: 'earned', animalId: null, name: null, atMillis: Date.now() })
    added = true
  })
  return added
}

/** Spends a nametag naming animal `animalId` (renaming takes another) - false with none held. */
export function nameAnimal(animalId, name) {
  const trimmed = String(name || '').trim().slice(0, NAMETAG_MAX_LENGTH)
  if (!trimmed || nametagsOf(getState()).held <= 0) return false
  update((s) => {
    s.zoo.nametags = s.zoo.nametags || []
    s.zoo.nametags.push({ id: uid(), kind: 'spent', animalId, name: trimmed, atMillis: Date.now() })
  })
  return true
}

/** Collects a Weekly/Monthly reward: a random animal of `rarity` (ZooRepository.claimSprintPrize).
 *  Momentum right now gives it the egg tiers' holo chance, and an Epic gets its birth certificate
 *  from now. Null if already collected. */
export async function claimSprintPrize(key, rarity) {
  const animals = await loadCatalog()
  const pool = animals.filter((a) => a.rarity === rarity)
  if (!pool.length || takenPrizes(getState()).has(key)) return null
  const animal = pool[randomInt(pool.length)]
  const now = Date.now()
  let result = null
  update((st) => {
    if (st.zoo.openings.some((o) => o.rarity === key)) return
    const cert = certify(st, snapshotEgg(st, now), animal.rarity)
    st.zoo.openings.push({ id: uid(), rarity: key, animalId: animal.id, atMillis: now, upgradeKey: false, cert })
    result = { animal, cert, copies: st.zoo.openings.filter((o) => o.animalId === animal.id).length, fromBox: false, prize: true }
  })
  return result
}
