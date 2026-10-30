import test from 'node:test'
import assert from 'node:assert/strict'
import { eggEntries, eggsToTakeBack, sameFinishCount } from '../src/model/zoo.js'
import { missingCount } from '../src/model/sync.js'

const HOUR = 3600000
const session = (start, end) => ({ startTimeMillis: start, endTimeMillis: end, contentType: 'PODCAST', languageProfileId: 1 })

test('only immersion from 2 October 2026 earns eggs', () => {
  const from = new Date(2026, 9, 2).getTime()
  const counted = eggEntries([
    session(from - 50 * HOUR, from - 40 * HOUR), // an imported year - not counted
    session(from - HOUR, from + 2 * HOUR), // crosses the start: only 2 h count
    session(from + 5 * HOUR, from + 6 * HOUR),
  ], from)
  assert.equal(counted.reduce((t, e) => t + e.endTimeMillis - e.startTimeMillis, 0), 3 * HOUR)
})

test('the latest extra eggs, and trade-ups made from them, are taken back', () => {
  const box = (id, at) => ({ id, rarity: 'BOX', animalId: `a${id}`, atMillis: at, upgradeKey: false })
  // Six boxes opened, four earned. Box 5 went into a trade-up with boxes 1-4, whose copy (10) was
  // traded up again (grant 2 -> 11). Same case as the phone's ZooRulesTest.
  const openings = [1, 2, 3, 4, 5, 6].map((i) => box(i, i * 100))
    .concat([{ id: 10, rarity: 'BLUE', animalId: 'b', atMillis: 700, upgradeKey: true }, { id: 11, rarity: 'PURPLE', animalId: 'c', atMillis: 900, upgradeKey: true }])
  const grants = [{ id: 1, rarity: 'BLUE', source: 'trade', atMillis: 650 }, { id: 2, rarity: 'PURPLE', source: 'trade', atMillis: 800 }]
  const tradeIns = [1, 2, 3, 4, 5].map((i) => ({ id: i, animalId: `a${i}`, grantId: 1, atMillis: 650, openingId: i }))
    .concat([{ id: 20, animalId: 'b', grantId: 2, atMillis: 800, openingId: 10 }])
  const gone = eggsToTakeBack(4, openings, grants, tradeIns)
  assert.deepEqual([...gone.openings].sort((a, b) => a - b), [5, 6, 10, 11])
  assert.deepEqual([...gone.grants].sort(), [1, 2])
  assert.deepEqual([...gone.tradeIns].sort((a, b) => a - b), [1, 2, 3, 4, 5, 20])
  assert.equal(eggsToTakeBack(6, openings, grants, tradeIns).openings.size, 0)
})

test('taking eggs back never counts as missing records', () => {
  const snapshot = { opening: Object.fromEntries([...Array(40).keys()].map((i) => [String(i), JSON.stringify({ animalId: `a${i}`, atMillis: i })])) }
  const deletes = [...Array(35).keys()].map((i) => ({ coll: 'opening', id: String(i + 5), deleted: true }))
  assert.equal(missingCount(deletes, { opening: new Map() }, snapshot), 0)
})

test('a Toggl import of old history loses the eggs it hatched, once, and says so for other devices', async () => {
  const { defaultState, replaceState, getState } = await import('../src/store.js')
  const { takeBackEarlyEggs } = await import('../src/model/zoo.js')
  const from = new Date(2026, 9, 2).getTime()
  const s = defaultState()
  s.profiles = [{ id: 1, name: 'Japanese', isAnki: false }]
  // 25 h tracked since 2 Oct (two eggs' worth), then a Toggl file with 600 h from 2024.
  s.entries = [
    { id: 1, startTimeMillis: from + HOUR, endTimeMillis: from + 26 * HOUR, contentType: 'PODCAST', languageProfileId: 1, appPackage: 'web' },
    ...[...Array(60).keys()].map((i) => ({ id: 100 + i, startTimeMillis: from - (400 - i) * 24 * HOUR, endTimeMillis: from - (400 - i) * 24 * HOUR + 10 * HOUR, contentType: 'PODCAST', languageProfileId: 1, appPackage: 'import:toggl' })),
  ]
  // Two eggs hatched before the import, then 58 straight after it.
  s.zoo.openings = [...Array(60).keys()].map((i) => ({ id: i + 1, rarity: 'BOX', animalId: `a${i}`, atMillis: from + (i < 2 ? i : 100 + i) * HOUR, upgradeKey: false }))
  s.zoo.eggs = Object.fromEntries([...Array(60).keys()].map((i) => [`box:${i + 1}`, { earnedAt: from }]))
  s.sync.token = null
  replaceState(s)
  assert.equal(takeBackEarlyEggs(), true)
  const after = getState()
  assert.deepEqual(after.zoo.openings.map((o) => o.id), [1, 2])
  assert.deepEqual(Object.keys(after.zoo.eggs).sort(), ['box:1', 'box:2'])
  assert.equal(after.zoo.eggsTakenBack, true)
  // Never again - here, or on a device that heard about it through sync.
  assert.equal(takeBackEarlyEggs(), false)
})

test('a Zoo with no imported old history is never touched', async () => {
  const { defaultState, replaceState, getState } = await import('../src/store.js')
  const { takeBackEarlyEggs } = await import('../src/model/zoo.js')
  const from = new Date(2026, 9, 2).getTime()
  const s = defaultState()
  s.profiles = [{ id: 1, name: 'Japanese', isAnki: false }]
  // Only 5 h since 2 Oct, but 3 eggs (a race head start, say) and old hours tracked by hand.
  s.entries = [
    { id: 1, startTimeMillis: from + HOUR, endTimeMillis: from + 6 * HOUR, contentType: 'PODCAST', languageProfileId: 1, appPackage: 'web' },
    { id: 2, startTimeMillis: from - 30 * 24 * HOUR, endTimeMillis: from - 30 * 24 * HOUR + 50 * HOUR, contentType: 'PODCAST', languageProfileId: 1, appPackage: 'web' },
  ]
  s.zoo.openings = [1, 2, 3].map((i) => ({ id: i, rarity: 'BOX', animalId: `a${i}`, atMillis: from + i * HOUR, upgradeKey: false }))
  s.sync.token = null
  replaceState(s)
  assert.equal(takeBackEarlyEggs(), false)
  assert.equal(getState().zoo.openings.length, 3)
})

test('a holo and a plain copy are not counted together', () => {
  const plain = { id: 'a', cert: null }
  const holo = { id: 'b', cert: { foil: true } }
  assert.equal(sameFinishCount([holo, plain], true), 1)
  assert.equal(sameFinishCount([holo, plain], false), 1)
  assert.equal(sameFinishCount([holo, plain, { id: 'c' }], false), 2)
})
