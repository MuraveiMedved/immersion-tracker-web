import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultState, ANKI_ID } from '../src/store.js'
import { collect, diff, applyRecords } from '../src/model/sync.js'
import { remapIds } from '../src/model/ids.js'

function sample() {
  const s = defaultState()
  s.profiles = [{ id: 1, name: 'Anki', isAnki: true }, { id: 2, name: 'Japanese', isAnki: false }]
  s.entries = [{ id: 1, languageProfileId: 2, startTimeMillis: 0, endTimeMillis: 10, contentType: 'PODCAST' }]
  s.zoo.openings = [{ id: 1, animalId: 'moose' }]
  s.zoo.grants = [{ id: 1, rarity: 'BLUE', source: 'trade' }]
  s.zoo.tradeIns = [{ id: 1, animalId: 'moose', grantId: 1, openingId: 1 }]
  s.zoo.eggs = { 'grant:1': { earnedAt: 5 }, 'box:1': { earnedAt: 3 } }
  return s
}

test('re-id keeps every reference and gives Anki the shared id', () => {
  const s = remapIds(sample())
  const ja = s.profiles.find((p) => p.name === 'Japanese')
  assert.equal(s.profiles.find((p) => p.isAnki).id, ANKI_ID)
  assert.ok(ja.id > 1e12)
  assert.equal(s.entries[0].languageProfileId, ja.id)
  assert.equal(s.zoo.tradeIns[0].openingId, s.zoo.openings[0].id)
  assert.equal(s.zoo.tradeIns[0].grantId, s.zoo.grants[0].id)
  assert.ok(s.zoo.eggs[`grant:${s.zoo.grants[0].id}`])
  assert.ok(s.zoo.eggs['box:1'])
})

test('diff finds new, changed and deleted records', () => {
  const s = sample()
  const snap = Object.fromEntries(Object.entries(collect(s)).map(([c, m]) => [c, Object.fromEntries(m)]))
  assert.equal(diff(collect(s), snap).length, 0)
  s.entries[0].mediaTitle = 'x'
  s.entries.push({ id: 9 })
  s.zoo.openings = []
  const changes = diff(collect(s), snap)
  assert.deepEqual(changes.map((c) => `${c.coll}:${c.id}:${c.deleted}`).sort(), ['entry:1:false', 'entry:9:false', 'opening:1:true'])
})

test('applying records adds, replaces, deletes and keeps one running session per type', () => {
  const s = sample()
  applyRecords(s, [
    { coll: 'entry', id: '1', deleted: true },
    { coll: 'entry', id: '5', deleted: false, data: { id: 5, contentType: 'READING', startTimeMillis: 100, endTimeMillis: null } },
    { coll: 'entry', id: '6', deleted: false, data: { id: 6, contentType: 'READING', startTimeMillis: 200, endTimeMillis: null } },
    { coll: 'prefs', id: 'race', deleted: false, data: { name: 'Shared' } },
    { coll: 'egg', id: 'box:1', deleted: true },
  ])
  assert.deepEqual(s.entries.map((e) => e.id).sort(), [5, 6])
  assert.equal(s.entries.find((e) => e.id === 5).endTimeMillis, 200)
  assert.equal(s.entries.find((e) => e.id === 6).endTimeMillis, null)
  assert.equal(s.race.name, 'Shared')
  assert.ok(s.race.userId) // other race fields kept
  assert.equal(s.zoo.eggs['box:1'], undefined)
})

test('an imported copy of the same session is matched up, not doubled', async () => {
  const { dedupeAgainst } = await import('../src/model/sync.js')
  const s = sample()
  dedupeAgainst(s, [
    { coll: 'profile', id: '900', deleted: false, data: { id: 900, name: ' japanese ', isAnki: false } },
    { coll: 'entry', id: '901', deleted: false, data: { id: 901, startTimeMillis: 0, endTimeMillis: 10, contentType: 'PODCAST', languageProfileId: 900 } },
  ])
  applyRecords(s, [
    { coll: 'profile', id: '900', deleted: false, data: { id: 900, name: 'Japanese', isAnki: false } },
    { coll: 'entry', id: '901', deleted: false, data: { id: 901, startTimeMillis: 0, endTimeMillis: 10, contentType: 'PODCAST', languageProfileId: 900 } },
  ])
  assert.deepEqual(s.entries.map((e) => e.id), [901])
  assert.deepEqual(s.profiles.filter((p) => !p.isAnki).map((p) => p.id), [900])
})

test('an entry stopped since it was agreed running is sent marked closes', () => {
  const s = sample()
  s.entries.push({ id: 2, languageProfileId: 2, startTimeMillis: 100, endTimeMillis: null, contentType: 'PODCAST' })
  const snap = Object.fromEntries(Object.entries(collect(s)).map(([c, m]) => [c, Object.fromEntries(m)]))
  s.entries[1].endTimeMillis = 500
  s.entries[0].mediaTitle = 'renamed'
  const changes = diff(collect(s), snap)
  assert.equal(changes.find((c) => c.id === '2').closes, true)
  assert.equal(changes.find((c) => c.id === '1').closes, undefined)
})

test('server: the first stop of a running session stands', async () => {
  const vm = await import('node:vm')
  const { readFileSync } = await import('node:fs')
  const ctx = vm.createContext({ Date, JSON, Math, Number, String, Object, Array, Error, isFinite })
  vm.runInContext(readFileSync(new URL('../sync-backend/Code.gs', import.meta.url), 'utf8'), ctx)
  const entry = (end, extra = {}) => ({ coll: 'entry', id: '7', deleted: false, data: { id: 7, startTimeMillis: 100, endTimeMillis: end, contentType: 'PODCAST' }, ...extra })
  const docWith = (rec) => ({ rev: 1, records: { 'entry:7': { ...rec, rev: 1 } } })

  // The web stopped it at 300; the phone, not having heard, stops it at 900 - the web's stop stays.
  let doc = docWith({ ...entry(300), updatedAt: 1000 })
  assert.equal(ctx.merge_(doc, [{ ...entry(900, { closes: true }), updatedAt: 2000 }], 3000), 0)
  assert.equal(doc.records['entry:7'].data.endTimeMillis, 300)
  // Discarded in the web app: the phone's stop doesn't bring it back.
  doc = docWith({ coll: 'entry', id: '7', deleted: true, data: null, updatedAt: 1000 })
  assert.equal(ctx.merge_(doc, [{ ...entry(900, { closes: true }), updatedAt: 2000 }], 3000), 0)
  assert.equal(doc.records['entry:7'].deleted, true)
  // The phone stopped it earlier than the web did: the phone's stop is taken (and stored unmarked).
  doc = docWith({ ...entry(300), updatedAt: 1000 })
  assert.equal(ctx.merge_(doc, [{ ...entry(200, { closes: true }), updatedAt: 2000 }], 3000), 1)
  assert.equal(doc.records['entry:7'].data.endTimeMillis, 200)
  assert.equal('closes' in doc.records['entry:7'], false)
  // Still running on the account: the stop is taken.
  doc = docWith({ ...entry(null), updatedAt: 1000 })
  assert.equal(ctx.merge_(doc, [{ ...entry(900, { closes: true }), updatedAt: 2000 }], 3000), 1)
  // An older app (no mark) merges as before: newest edit wins.
  doc = docWith({ ...entry(300), updatedAt: 1000 })
  assert.equal(ctx.merge_(doc, [{ ...entry(900), updatedAt: 2000 }], 3000), 1)
  assert.equal(doc.records['entry:7'].data.endTimeMillis, 900)
})

test('server: a stale read of the account file loses nothing and never moves revisions back', async () => {
  const vm = await import('node:vm')
  const { readFileSync } = await import('node:fs')
  const props = new Map()
  let file = JSON.stringify({ rev: 0, records: {} })
  let stale = null // what Drive hands back for the next few reads, if set
  let staleReads = 0
  const ctx = vm.createContext({
    Date, JSON, Math, Number, String, Object, Array, Error, isFinite,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, String(v)) }) },
    DriveApp: { getFileById: () => ({ getBlob: () => ({ getDataAsString: () => (staleReads-- > 0 ? stale : file) }), setContent: (t) => { file = t } }) },
    Utilities: { sleep: () => {} },
  })
  vm.runInContext(readFileSync(new URL('../sync-backend/Code.gs', import.meta.url), 'utf8'), ctx)
  const device = { accountId: 'a', fileId: 'f' }
  const rec = (id) => ({ coll: 'entry', id, updatedAt: 1000, deleted: false, data: { id, startTimeMillis: 1, endTimeMillis: 2, contentType: 'PODCAST' } })

  ctx.pushInto_(device, { changes: [rec('1'), rec('2')] }, 2000)
  const before = file
  ctx.pushInto_(device, { changes: [rec('3')] }, 2000)
  // Drive returns the copy from before '3' for two reads: the push waits it out and keeps '3'.
  stale = before
  staleReads = 2
  ctx.pushInto_(device, { changes: [rec('4')] }, 2000)
  let doc = JSON.parse(file)
  assert.deepEqual(Object.keys(doc.records).sort(), ['entry:1', 'entry:2', 'entry:3', 'entry:4'])
  assert.equal(doc.rev, 4)
  // Stale for longer than it waits: revisions still go forward, and the noted one never drops.
  staleReads = 99
  ctx.pushInto_(device, { changes: [rec('5')] }, 2000)
  doc = JSON.parse(file)
  assert.equal(doc.records['entry:5'].rev, 5)
  assert.equal(props.get('rev:a'), '5')
  staleReads = 99
  ctx.pushInto_(device, { changes: [] }, 2000)
  assert.equal(props.get('rev:a'), '5')
})

test('missing records: lost ones are sent again, skipped ones are taken, local edits win', async () => {
  const { reconcile } = await import('../src/model/sync.js')
  const s = sample()
  s.entries.push({ id: 2, languageProfileId: 2, startTimeMillis: 20, endTimeMillis: 30, contentType: 'PODCAST' })
  const snap = Object.fromEntries(Object.entries(collect(s)).map(([c, m]) => [c, Object.fromEntries(m)]))
  s.entries[0].mediaTitle = 'edited here'
  const server = [
    ...Object.entries(snap).flatMap(([coll, m]) => Object.entries(m).map(([id, json]) => ({ coll, id, deleted: false, data: JSON.parse(json) }))),
  ].filter((r) => !(r.coll === 'entry' && r.id === '2')) // the account lost entry 2
  server.find((r) => r.coll === 'entry' && r.id === '1').data.mediaTitle = 'edited elsewhere'
  server.push({ coll: 'entry', id: '3', deleted: false, data: { id: 3, languageProfileId: 2, startTimeMillis: 40, endTimeMillis: 50, contentType: 'READING' } })
  const { lost, take } = reconcile(server, collect(s), snap)
  assert.deepEqual(lost, [['entry', '2']])
  assert.deepEqual(take.map((r) => `${r.coll}:${r.id}`), ['entry:3']) // entry 1 was edited here - that goes up instead
})

test('Anki on the retired Anki profile goes to the main language; Anki goals survive an older record', async () => {
  const { uncategorizeLegacyAnki } = await import('../src/store.js')
  const s = sample()
  s.entries.push({ id: 2, languageProfileId: 1, startTimeMillis: 20, endTimeMillis: 30, contentType: 'ANKI', detectionReason: 'Tracked app' })
  assert.equal(uncategorizeLegacyAnki(s), true)
  assert.equal(s.entries[1].languageProfileId, 2) // the only (so the main) language
  assert.equal(s.entries[1].detectionReason, null)
  assert.equal(s.entries[1].contentType, 'ANKI')
  assert.equal(s.entries[0].languageProfileId, 2)
  assert.equal(uncategorizeLegacyAnki(s), false)
  s.profiles[1].ankiGoalMinutes = 20
  applyRecords(s, [{ coll: 'profile', id: '2', deleted: false, data: { id: 2, name: 'Japanese', isAnki: false, podcastGoalMinutes: 40 } }])
  const ja = s.profiles.find((p) => p.id === 2)
  assert.equal(ja.podcastGoalMinutes, 40)
  assert.equal(ja.ankiGoalMinutes, 20)
  applyRecords(s, [{ coll: 'profile', id: '2', deleted: false, data: { id: 2, name: 'Japanese', isAnki: false, ankiGoalMinutes: 5 } }])
  assert.equal(s.profiles.find((p) => p.id === 2).ankiGoalMinutes, 5)
})
