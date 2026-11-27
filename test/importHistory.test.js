import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeRecord, summaries, totals, withGroup, toEntries, earlierGroups } from '../src/model/importHistory.js'
import { PODCAST, READING, LISTENING } from '../src/model/rules.js'

const H = 3_600_000
const rows = [
  { project: 'RU Listening', description: 'YouTube', start: 0, end: 3 * H, source: 'toggl' },
  { project: 'RU Reading', description: 'a book', start: 10 * H, end: 11 * H, source: 'toggl' },
  { project: 'Work', description: '', start: 20 * H, end: 28 * H, source: 'toggl' },
  { project: 'RU Listening', description: '', start: 30 * H, end: 31 * H, source: 'toggl' },
]
const mapping = {
  'RU Listening': { type: PODCAST, languageProfileId: 3 },
  'RU Reading': { type: READING, languageProfileId: 3 },
  Work: { type: null, languageProfileId: 3 },
}
const record = makeRecord({ source: 'toggl', fileCount: 2, rows, mapping, at: 1000 })

test('a record keeps every row and each group with where it went', () => {
  assert.equal(record.rows.length, 4)
  assert.deepEqual(record.groups.find((g) => g.project === 'Work'), { project: 'Work', type: null, languageProfileId: null })
})

test('summaries put counted groups first, then the biggest (like the phone)', () => {
  const s = summaries(record)
  assert.deepEqual(s.map((x) => x.group.project), ['RU Listening', 'RU Reading', 'Work'])
  assert.equal(s[0].count, 2)
  assert.equal(s[0].ms, 4 * H)
  assert.equal(s[0].last, 31 * H)
})

test('totals by destination, biggest first', () => {
  assert.deepEqual(totals(record), [[null, 8 * H], [PODCAST, 4 * H], [READING, H]])
})

test('withGroup changes only that group', () => {
  const moved = withGroup(record, { project: 'Work', type: READING, languageProfileId: null })
  assert.equal(moved.groups.find((g) => g.project === 'Work').type, READING)
  assert.equal(record.groups.find((g) => g.project === 'Work').type, null)
})

test('music never gets a language; a blank description takes the group name', () => {
  const r = record.rows.filter((x) => x.project === 'RU Listening')
  assert.equal(toEntries('toggl', r, LISTENING, 3)[0].languageProfileId, null)
  const e = toEntries('polylogger', r, PODCAST, 3)
  assert.equal(e[1].mediaTitle, 'RU Listening')
  assert.equal(e[0].appPackage, 'import:polylogger')
  assert.equal(e[0].detectionReason, 'Imported from PolyLogger')
})

test('earlier imports: sessions no record holds, by source and destination', () => {
  const tags = { toggl: ['import:toggl', 'toggl-import'], polylogger: ['import:polylogger', 'polylogger-import'] }
  const entries = [
    { appPackage: 'toggl-import', startTimeMillis: 0, endTimeMillis: 3 * H, contentType: PODCAST, languageProfileId: 3 }, // in the record
    { appPackage: 'toggl-import', startTimeMillis: 50 * H, endTimeMillis: 52 * H, contentType: PODCAST, languageProfileId: 3, mediaTitle: 'x' },
    { appPackage: 'import:polylogger', startTimeMillis: 60 * H, endTimeMillis: 61 * H, contentType: READING, languageProfileId: null, mediaTitle: 'y' },
    { appPackage: 'web', startTimeMillis: 70 * H, endTimeMillis: 71 * H, contentType: READING, languageProfileId: null },
  ]
  const g = earlierGroups([record], entries, tags)
  assert.deepEqual(g.map((x) => [x.source, x.type, x.count, x.ms]), [['polylogger', READING, 1, H], ['toggl', PODCAST, 1, 2 * H]])
})

test('reconstruct: one record per unbroken run of ids from a source', async () => {
  const { reconstruct } = await import('../src/model/importHistory.js')
  const tags = { toggl: ['import:toggl', 'toggl-import'], polylogger: ['import:polylogger', 'polylogger-import'] }
  const e = (id, pkg, start, type = PODCAST) => ({ id, appPackage: pkg, startTimeMillis: start, endTimeMillis: start + H, contentType: type, languageProfileId: 3, mediaTitle: '' })
  const entries = [
    e(1000_001, 'toggl-import', 0), e(1000_002, 'toggl-import', H, READING),
    e(1000_003, 'polylogger-import', 2 * H),
    e(2000_000, 'web', 3 * H),
    e(5000_000, 'import:toggl', 4 * H),
  ]
  const out = reconstruct([], entries, tags, (t, l) => `${t}/${l}`)
  assert.deepEqual(out.map((r) => [r.source, r.rows.length, r.atMillis]), [['toggl', 2, 1000], ['polylogger', 1, 1000], ['toggl', 1, 5000]])
  assert.ok(out.every((r) => r.reconstructed))
})
