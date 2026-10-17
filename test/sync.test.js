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
