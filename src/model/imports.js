// Getting data in and out: Toggl Track / PolyLogger CSVs (same parsing as the phone's TogglImport
// and PolyLoggerImport), this web app's own JSON backup, and a phone backup zip (its SQLite
// database read in the browser with sql.js).
import { getState, replaceState, defaultState } from '../store.js'
import { ANKI, LISTENING, PODCAST, READING } from './rules.js'
import { localZone } from './time.js'
import { remapIds } from './ids.js'

/* ------------------------------------------------------------------------------------------------
 * CSV
 * --------------------------------------------------------------------------------------------- */

/** RFC 4180 rows: quoted fields may hold commas, line breaks and doubled quotes. */
export function csvRows(text) {
  const rows = []
  let row = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted && c === '"' && text[i + 1] === '"') { field += '"'; i++ }
    else if (c === '"') quoted = !quoted
    else if (!quoted && c === ',') { row.push(field); field = '' }
    else if (!quoted && (c === '\n' || c === '\r')) {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some((f) => f !== '')) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some((f) => f !== '')) rows.push(row)
  return rows
}

function parseDate(text) {
  text = text.trim()
  let m
  if ((m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return [+m[1], +m[2], +m[3]]
  if ((m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return [+m[3], +m[1], +m[2]] // MM/dd/yyyy first, like the phone
  if ((m = text.match(/^(\d{1,2})[.-](\d{1,2})[.-](\d{4})$/))) return [+m[3], +m[2], +m[1]]
  return null
}

function parseTime(text) {
  const m = text.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  return m ? [+m[1], +m[2], +(m[3] || 0)] : null
}

const localMillis = ([y, mo, d], [h, mi, s] = [0, 0, 0]) => new Date(y, mo - 1, d, h, mi, s).getTime()

export function parseToggl(text) {
  const rows = csvRows(text.replace(/^﻿/, ''))
  const header = (rows[0] || []).map((h) => h.trim().toLowerCase())
  const col = (n) => header.indexOf(n)
  const project = col('project'), description = col('description'), startDate = col('start date'), startTime = col('start time')
  const endDate = col('end date'), endTime = col('end time'), duration = col('duration')
  if (project < 0 || startDate < 0 || startTime < 0) throw new Error('Not a Toggl Track time entries export')
  const out = []
  for (const row of rows.slice(1)) {
    const cell = (i) => (i >= 0 ? (row[i] || '').trim() : '')
    const sd = parseDate(cell(startDate)), st = parseTime(cell(startTime))
    if (!sd || !st) continue
    const start = localMillis(sd, st)
    let end = null
    const ed = parseDate(cell(endDate)), et = parseTime(cell(endTime))
    if (ed && et) end = localMillis(ed, et)
    else {
      const parts = cell(duration).split(':').map(Number)
      if (parts.length === 3 && parts.every((n) => !isNaN(n))) end = start + ((parts[0] * 60 + parts[1]) * 60 + parts[2]) * 1000
    }
    if (end == null || end <= start) continue
    out.push({ project: cell(project), description: cell(description), start, end, source: 'toggl' })
  }
  return out
}

export function looksLikePolyLogger(text) {
  const header = (csvRows((text.replace(/^﻿/, '').split(/\r?\n/)[0]) || '')[0] || []).map((h) => h.trim().toLowerCase())
  return header.includes('activity type') && header.some((h) => h.startsWith('time')) && header.includes('language')
}

/** PolyLogger keeps only a date and a length: each day's sessions are laid end to end from noon
 *  (earlier for a day with more than 12 hours), in the order they were logged. */
export function parsePolyLogger(text) {
  const rows = csvRows(text.replace(/^﻿/, ''))
  const header = (rows[0] || []).map((h) => h.trim().toLowerCase())
  const activity = header.indexOf('activity'), language = header.indexOf('language'), type = header.indexOf('activity type')
  const minutes = header.findIndex((h) => h.startsWith('time')), date = header.indexOf('date')
  if (language < 0 || type < 0 || minutes < 0 || date < 0) throw new Error('Not a PolyLogger export')
  const sessions = []
  rows.slice(1).forEach((row, order) => {
    const cell = (i) => (i >= 0 ? (row[i] || '').trim() : '')
    const day = parseDate(cell(date))
    const len = Math.round(Number(cell(minutes)))
    if (!day || !(len > 0)) return
    sessions.push({ order, day, minutes: len, group: [cell(language), cell(type)].filter(Boolean).join(' · '), title: cell(activity) })
  })
  const byDay = new Map()
  for (const s of sessions) {
    const k = s.day.join('-')
    if (!byDay.has(k)) byDay.set(k, [])
    byDay.get(k).push(s)
  }
  const out = []
  for (const list of byDay.values()) {
    const total = list.reduce((t, s) => t + s.minutes, 0)
    const latestStart = 24 * 60 - 1 - total
    let startMin = 12 * 60 > latestStart ? Math.max(0, latestStart) : 12 * 60
    for (const s of [...list].sort((a, b) => b.order - a.order)) {
      const start = localMillis(s.day) + startMin * 60000
      out.push({ project: s.group, description: s.title, start, end: start + s.minutes * 60000, source: 'polylogger' })
      startMin += s.minutes
    }
  }
  return out
}

const CODE_SCRIPTS = { ru: 'CYRILLIC_RUSSIAN', uk: 'CYRILLIC_UKRAINIAN', ua: 'CYRILLIC_UKRAINIAN', zh: 'HAN_CHINESE', cn: 'HAN_CHINESE', ja: 'JAPANESE_KANA', jp: 'JAPANESE_KANA', ko: 'KOREAN_HANGUL', kr: 'KOREAN_HANGUL', th: 'THAI_SCRIPT', es: 'SPANISH_MARKERS', sp: 'SPANISH_MARKERS' }

/** A first guess at how one project comes in: language from a leading code or a language's name,
 *  type from listen/read/music/anki words; anything else starts out skipped. */
export function guessMapping(project, profiles) {
  const lower = project.toLowerCase()
  let type = null
  if (/anki|vocab|flashcard|srs/.test(lower)) type = ANKI
  else if (/music|song/.test(lower)) type = LISTENING
  else if (/listen|podcast|audio|watch/.test(lower)) type = PODCAST
  else if (/read/.test(lower)) type = READING
  if (type === ANKI) return { type, languageProfileId: profiles.find((p) => p.isAnki)?.id ?? null }
  const code = lower.split(/[^a-z]+/).find(Boolean)
  const script = CODE_SCRIPTS[code]
  const byCode = script ? profiles.find((p) => !p.isAnki && p.scriptDetectors?.includes(script)) : null
  const byName = profiles.find((p) => !p.isAnki && p.name.trim() && lower.includes(p.name.trim().toLowerCase()))
  return { type, languageProfileId: (byCode || byName)?.id ?? null }
}

/** Import entries -> app entries with the per-project [mapping]. */
export function toEntries(rows, mapping) {
  return rows.flatMap((r) => {
    const m = mapping[r.project]
    if (!m || !m.type) return []
    return [{
      startTimeMillis: r.start,
      endTimeMillis: r.end,
      mediaTitle: r.description,
      mediaArtist: '',
      appPackage: r.source === 'polylogger' ? 'import:polylogger' : 'import:toggl',
      languageProfileId: m.languageProfileId,
      contentType: m.type,
      detectionReason: m.languageProfileId != null ? `Imported from ${r.source === 'polylogger' ? 'PolyLogger' : 'Toggl'}` : null,
      isManual: false,
      timeZone: localZone(),
    }]
  })
}

/* ------------------------------------------------------------------------------------------------
 * Own JSON backup
 * --------------------------------------------------------------------------------------------- */

export function exportBackup() {
  const s = getState()
  const blob = new Blob([JSON.stringify({ app: 'immersion-tracker-web', exportedAt: Date.now(), state: s })], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  const d = new Date()
  a.download = `Immersion Tracker web backup ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

export async function readJsonBackup(file) {
  const json = JSON.parse(await file.text())
  if (json?.app !== 'immersion-tracker-web' || !json.state) throw new Error("That isn't an Immersion Tracker web backup.")
  return json.state
}

/* ------------------------------------------------------------------------------------------------
 * Phone backup zip: database/immersion-tracker.db + settings/*.xml
 * --------------------------------------------------------------------------------------------- */

function readPrefsXml(text) {
  const out = {}
  const doc = new DOMParser().parseFromString(text, 'text/xml')
  for (const el of doc.documentElement?.children || []) {
    const name = el.getAttribute('name')
    if (!name) continue
    if (el.tagName === 'string') out[name] = el.textContent
    else if (el.tagName === 'set') out[name] = [...el.children].map((c) => c.textContent)
    else out[name] = el.getAttribute('value')
  }
  return out
}

const SEP = '\u001F'
const splitList = (v) => (v ? String(v).split(SEP).filter(Boolean) : [])

/** Reads a phone backup into a summary plus a function that builds the web state from it. */
export async function readPhoneBackup(file) {
  const [{ default: JSZip }, { default: initSqlJs }, wasmUrl] = await Promise.all([
    import('jszip'),
    import('sql.js/dist/sql-wasm.js'),
    import('sql.js/dist/sql-wasm.wasm?url').then((m) => m.default),
  ])
  const zip = await JSZip.loadAsync(file)
  const dbFile = zip.file('database/immersion-tracker.db')
  if (!dbFile) throw new Error("That zip isn't an Immersion Tracker phone backup (no database inside).")
  const SQL = await initSqlJs({ locateFile: () => wasmUrl })
  const db = new SQL.Database(new Uint8Array(await dbFile.async('uint8array')))
  const all = (sql) => {
    try {
      const res = db.exec(sql)[0]
      if (!res) return []
      return res.values.map((row) => Object.fromEntries(res.columns.map((c, i) => [c, row[i]])))
    } catch { return [] }
  }
  const prefs = {}
  for (const name of ['race_prefs', 'zoo_prefs', 'immersion_prefs']) {
    const f = zip.file(`settings/${name}.xml`)
    if (f) prefs[name] = readPrefsXml(await f.async('string'))
  }
  const profiles = all('SELECT * FROM language_profiles')
  const entries = all('SELECT * FROM time_entries')
  const openings = all('SELECT * FROM zoo_crate_openings ORDER BY id')
  const grants = all('SELECT * FROM zoo_key_grants ORDER BY id')
  const purchases = all('SELECT * FROM zoo_key_purchases ORDER BY id')
  const tradeIns = all('SELECT * FROM zoo_trade_ins ORDER BY id')
  const eggs = all('SELECT * FROM zoo_eggs')
  db.close()

  const summary = { entries: entries.length, profiles: profiles.filter((p) => !p.isAnki).length, animals: openings.length - tradeIns.length, raceName: prefs.race_prefs?.display_name || '' }

  function build({ keepIdentity }) {
    const s = defaultState()
    const current = getState()
    s.settings = { ...current.settings, tutorialShown: true }
    s.profiles = profiles.map((p) => ({
      id: p.id, name: p.name || '', colorHex: p.colorHex || '#4370A3', gradientColors: p.gradientColors || null,
      scriptDetectors: splitList(p.scriptDetectors), keywords: splitList(p.keywords), sortOrder: p.sortOrder ?? p.id,
      podcastGoalMinutes: p.podcastGoalMinutes || 0, readingGoalMinutes: p.readingGoalMinutes || 0,
      isMain: !!p.isMain, isAnki: !!p.isAnki,
    }))
    s.entries = entries.map((e) => ({
      id: e.id, startTimeMillis: e.startTimeMillis, endTimeMillis: e.endTimeMillis ?? null, mediaTitle: e.mediaTitle || '',
      mediaArtist: e.mediaArtist || '', appPackage: e.appPackage || '', languageProfileId: e.languageProfileId ?? null,
      contentType: e.contentType || LISTENING, detectionReason: e.detectionReason ?? null, isManual: !!e.isManual,
      timeZone: e.timeZone || null,
    }))
    // A session still running on the phone stays with the phone.
    s.entries = s.entries.filter((e) => e.endTimeMillis != null)
    const cert = (o) => (o.certified ? { hourMark: o.hourMark ?? null, languageName: o.languageName ?? null, languageColor: o.languageColor ?? null, mediaTitle: o.mediaTitle ?? null, foil: !!o.foil } : null)
    s.zoo.openings = openings.map((o) => ({ id: o.id, rarity: o.rarity === 'GREY' ? 'GREEN' : o.rarity, animalId: o.animalId, atMillis: o.atMillis, upgradeKey: !!o.upgradeKey, cert: cert(o) }))
    let grantId = Math.max(0, ...grants.map((g) => g.id)) + 1
    s.zoo.grants = [
      ...grants.map((g) => ({ id: g.id, rarity: g.rarity === 'GREY' ? 'GREEN' : g.rarity, source: g.source, atMillis: g.atMillis })),
      // Keys bought before eggs existed still open their colour.
      ...purchases.map((p) => ({ id: grantId++, rarity: p.rarity === 'GREY' ? 'GREEN' : p.rarity, source: 'bought', atMillis: p.atMillis })),
    ]
    s.zoo.tradeIns = tradeIns.map((t) => ({ id: t.id, animalId: t.animalId, grantId: t.grantId, atMillis: t.atMillis, openingId: t.openingId ?? null }))
    for (const e of eggs) s.zoo.eggs[e.key] = { earnedAt: e.earnedAt, golden: !!e.golden, hourMark: e.hourMark ?? null, languageName: e.languageName ?? null, languageColor: e.languageColor ?? null, mediaTitle: e.mediaTitle ?? null }
    const zp = prefs.zoo_prefs || {}
    if (zp.credit_base_immersion != null) s.zoo.base = { immersionMillis: Number(zp.credit_base_immersion) || 0, credits: Number(zp.credit_base_credits) || 0 }
    s.zoo.trophyId = zp.trophy_animal || null
    const rp = prefs.race_prefs || {}
    s.race = { ...current.race, cachedEvents: [], archive: [], lastSync: 0 }
    if (keepIdentity && rp.user_id) {
      s.race.userId = rp.user_id
      s.race.name = rp.display_name || current.race.name
      s.race.emoji = rp.emoji || ''
      s.race.chartColor = rp.chart_color || ''
      try { s.race.archive = JSON.parse(rp.completed_archive || '[]') } catch { /* keep empty */ }
      s.race.deleted = Array.isArray(rp.hidden_events) ? rp.hidden_events : []
    }
    s.friends = { ...current.friends }
    return remapIds(s)
  }

  return { summary, build, apply: (opts) => replaceState(build(opts)) }
}
