// Import history (the phone's data/importer/ImportHistory.kt): every Toggl / PolyLogger import, kept
// whole - left-out groups too, since they exist nowhere else - so it can be looked back on and a group
// counted differently later. Kept in this browser only (readExtra 'import-history'), not synced; the
// phone keeps its own in the same shape.
import { LISTENING } from './rules.js'

export const HISTORY_KEY = 'import-history'

export const packageFor = (source) => (source === 'polylogger' ? 'import:polylogger' : 'import:toggl')
export const reasonFor = (source, languageProfileId) =>
  languageProfileId == null ? null : `Imported from ${source === 'polylogger' ? 'PolyLogger' : 'Toggl'}`

export function newRecordId(at = Date.now()) {
  return `${at}-${Math.random().toString(36).slice(2, 6)}`
}

/** A record from what the import dialog had: its rows and the mapping picked for each project. */
export function makeRecord({ source, fileCount, fileNames = [], rows, mapping, at = Date.now() }) {
  const projects = [...new Set(rows.map((r) => r.project))]
  return {
    id: newRecordId(at),
    source,
    atMillis: at,
    fileCount,
    fileNames,
    groups: projects.map((project) => {
      const m = mapping[project]
      const type = m?.type || null
      return { project, type, languageProfileId: type && type !== LISTENING ? m.languageProfileId ?? null : null }
    }),
    rows: rows.map((r) => ({ project: r.project, description: r.description || '', start: r.start, end: r.end })),
  }
}

/** Each group with what's in it: counted first, then left out; biggest first within each. */
export function summaries(record) {
  const by = new Map()
  for (const r of record.rows) {
    const g = by.get(r.project) || { count: 0, ms: 0, first: Infinity, last: 0 }
    g.count++
    g.ms += r.end - r.start
    g.first = Math.min(g.first, r.start)
    g.last = Math.max(g.last, r.end)
    by.set(r.project, g)
  }
  return record.groups
    .map((group) => {
      const g = by.get(group.project) || { count: 0, ms: 0, first: 0, last: 0 }
      return { group, count: g.count, ms: g.ms, first: g.first === Infinity ? 0 : g.first, last: g.last }
    })
    .sort((a, b) => (a.group.type == null) - (b.group.type == null) || b.ms - a.ms)
}

/** Time per destination type (null = left out), biggest first - the record's bar. */
export function totals(record) {
  const by = new Map()
  for (const s of summaries(record)) by.set(s.group.type, (by.get(s.group.type) || 0) + s.ms)
  return [...by.entries()].filter(([, ms]) => ms > 0).sort((a, b) => b[1] - a[1])
}

export const rowsOf = (record, project) => record.rows.filter((r) => r.project === project)

export const withGroup = (record, group) => ({ ...record, groups: record.groups.map((g) => (g.project === group.project ? group : g)) })

/** App entries for [rows], counted as [type] in [languageProfileId]. Music never has a language. */
export function toEntries(source, rows, type, languageProfileId, zone) {
  const language = type === LISTENING ? null : languageProfileId ?? null
  return rows.map((r) => ({
    startTimeMillis: r.start,
    endTimeMillis: r.end,
    mediaTitle: r.description || r.project,
    mediaArtist: '',
    appPackage: packageFor(source),
    languageProfileId: language,
    contentType: type,
    detectionReason: reasonFor(source, language),
    isManual: false,
    ...(zone ? { timeZone: zone } : {}),
  }))
}

/** Imported entries no record holds - from before history was kept, or another device - grouped by
 *  source and where they went. [importTags] is store.js's IMPORT_TAGS. */
export function earlierGroups(records, entries, importTags) {
  const known = new Set(records.flatMap((r) => r.rows.map((row) => `${row.start}:${row.end}`)))
  const sourceOf = (pkg) => Object.keys(importTags).find((k) => importTags[k].includes(pkg))
  const by = new Map()
  for (const e of entries) {
    const source = sourceOf(e.appPackage)
    if (!source || e.endTimeMillis == null || known.has(`${e.startTimeMillis}:${e.endTimeMillis}`)) continue
    const key = `${source}|${e.contentType}|${e.languageProfileId ?? ''}`
    const g = by.get(key) || { key, source, type: e.contentType, languageProfileId: e.languageProfileId ?? null, rows: [] }
    g.rows.push({ project: '', description: e.mediaTitle, start: e.startTimeMillis, end: e.endTimeMillis })
    by.set(key, g)
  }
  return [...by.values()]
    .map((g) => ({ ...g, count: g.rows.length, ms: g.rows.reduce((n, r) => n + r.end - r.start, 0),
      first: Math.min(...g.rows.map((r) => r.start)), last: Math.max(...g.rows.map((r) => r.end)) }))
    .sort((a, b) => a.source.localeCompare(b.source) || b.ms - a.ms)
}

/** The imports made before history was kept, pieced back together (the phone's ImportHistory.reconstruct).
 *  Entry ids grow with time, so one import's entries are one unbroken run of ids from its source; any
 *  other entry in between ends it. Dated by its first id (milliseconds x 1000) - when it was saved here.
 *  Groups are where its sessions went, named by [label](type, languageProfileId). */
export function reconstruct(records, entries, importTags, label) {
  const known = new Set(records.flatMap((r) => r.rows.map((row) => `${row.start}:${row.end}`)))
  const sourceOf = (pkg) => Object.keys(importTags).find((k) => importTags[k].includes(pkg))
  const sorted = [...entries].filter((e) => e.endTimeMillis != null).sort((a, b) => a.id - b.id)
  const runs = []
  let cur = null
  for (const e of sorted) {
    const source = sourceOf(e.appPackage)
    if (!source || known.has(`${e.startTimeMillis}:${e.endTimeMillis}`)) { if (!source) cur = null; continue }
    if (!cur || cur.source !== source) { cur = { source, entries: [] }; runs.push(cur) }
    cur.entries.push(e)
  }
  return runs.map(({ source, entries: list }) => {
    const by = new Map()
    for (const e of list) {
      const lang = e.contentType === LISTENING ? null : e.languageProfileId ?? null
      const key = `${e.contentType}|${lang ?? ''}`
      if (!by.has(key)) by.set(key, { type: e.contentType, lang, items: [] })
      by.get(key).items.push(e)
    }
    const groups = [...by.values()]
    const minId = Math.min(...list.map((e) => e.id))
    return {
      id: `early-${minId}`,
      source,
      atMillis: Math.floor(minId / 1000),
      fileCount: 0,
      fileNames: [],
      reconstructed: true,
      groups: groups.map((g) => ({ project: label(g.type, g.lang), type: g.type, languageProfileId: g.lang })),
      rows: groups.flatMap((g) => g.items.map((e) => ({ project: label(g.type, g.lang), description: e.mediaTitle || '', start: e.startTimeMillis, end: e.endTimeMillis }))),
    }
  })
}
