import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultState, replaceState, getState, startManualEntry, pauseRunningEntry, resumePaused, dismissPaused, discardPaused, pausedEntry, restorePaused, PODCAST, READING } from '../src/store.js'
import { remapIds } from '../src/model/ids.js'

let clock = 1_800_000_000_000
Date.now = () => clock
const running = () => getState().entries.filter((e) => e.endTimeMillis == null)

test('pause stops counting, resume carries on the same entry without the gap', () => {
  replaceState(defaultState())
  const id = startManualEntry(READING, null, 'A book')
  clock += 30_000
  pauseRunningEntry(READING)
  assert.equal(running().length, 0)
  assert.equal(pausedEntry().id, id)
  clock += 600_000
  resumePaused(READING)
  const [e] = running()
  assert.equal(e.id, id)
  assert.equal(getState().entries.length, 1)
  assert.equal(clock - e.startTimeMillis, 30_000)
  assert.equal(pausedEntry(), null)
})

test('stop and discard while paused, Undo, and a new session replacing it', () => {
  replaceState(defaultState())
  const id = startManualEntry(PODCAST, null, 'Show')
  clock += 120_000
  pauseRunningEntry(PODCAST)
  const paused = { ...pausedEntry() }
  dismissPaused(PODCAST)
  assert.equal(pausedEntry(), null)
  assert.equal(getState().entries.length, 1)
  restorePaused(paused)
  assert.equal(pausedEntry().id, id)
  discardPaused(PODCAST)
  assert.equal(getState().entries.length, 0)
  restorePaused(paused)
  assert.equal(pausedEntry().id, id)
  startManualEntry(READING, null, 'Book')
  assert.equal(pausedEntry(), null)
  assert.equal(getState().entries.length, 2)
})

test('a pause from an older version (no entry id) resumes as a new session', () => {
  const s = defaultState()
  s.paused = { [PODCAST]: { title: 'Old', languageProfileId: null } }
  replaceState(s)
  assert.equal(pausedEntry().mediaTitle, 'Old')
  resumePaused(PODCAST)
  assert.equal(running()[0].mediaTitle, 'Old')
})

test('re-id moves a paused entry id along', () => {
  const s = defaultState()
  s.entries = [{ id: 3, startTimeMillis: 0, endTimeMillis: 10, contentType: PODCAST }]
  s.paused = { [PODCAST]: { entryId: 3, title: '', languageProfileId: null } }
  const out = remapIds(s)
  assert.equal(out.paused[PODCAST].entryId, out.entries[0].id)
})
