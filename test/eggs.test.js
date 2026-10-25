import test from 'node:test'
import assert from 'node:assert/strict'
import { eggEntries, eggsToTakeBack } from '../src/model/zoo.js'
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
