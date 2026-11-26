// The user's own categories (the phone's CustomCategory.kt): immersion, goals, races and sync.
import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  PODCAST, READING, ANKI, LISTENING, GENERAL, counts, isImmersionType, fillsGoal, customGoalOf, hasGoal, typeLabel, categoryIconOf,
  setCustomCategories, customType, categoriesFromJson, cleanCustomGoals, dailyTotalsFor, immersionTotal, goldenTodayMillis, isUnresolved,
} from '../src/model/rules.js'
import { scoreFor, runningForRace } from '../src/model/race.js'
import { defaultState, replaceState, getState, saveCustomCategory, deleteCustomCategory, startManualEntry, logCompletedManualEntry, newProfile, upsertProfile } from '../src/store.js'
import { collect, applyRecords } from '../src/model/sync.js'
import { parseCustomGoals } from '../src/model/imports.js'
import { HOUR } from '../src/model/time.js'

const WATCH = { id: 'watch123', name: 'Watching', icon: 'movie', immersion: true }
const GRAMMAR = { id: 'gram4567', name: 'Grammar', icon: 'edit_note', immersion: false }
const W = customType(WATCH.id)
const G = customType(GRAMMAR.id)
const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime()
const entry = (start, ms, type, lang = 1) => ({ startTimeMillis: start, endTimeMillis: start + ms, contentType: type, languageProfileId: lang, mediaTitle: '' })

afterEach(() => setCustomCategories([]))

test('a category counts as immersion only when it says so, and only while it exists', () => {
  setCustomCategories([WATCH, GRAMMAR])
  assert.equal(isImmersionType(W), true)
  assert.equal(isImmersionType(G), false)
  assert.equal(counts(W, 1), true)
  assert.equal(counts(W, null), false)
  assert.equal(counts(G, 1), false)
  assert.equal(counts(PODCAST, 1), true)
  assert.equal(counts(ANKI, 1), false)
  // Deleted on another device: its sessions stay as they are, labelled "Other", and no longer count.
  assert.equal(counts(customType('gone0000'), 1), false)
  assert.equal(typeLabel(customType('gone0000')), 'Other')
  assert.equal(categoryIconOf(customType('gone0000')), 'school')
  assert.equal(typeLabel(W), 'Watching')
  assert.equal(categoryIconOf(W), 'movie')
  // An explicit list wins over the registry.
  assert.equal(isImmersionType(G, [{ ...GRAMMAR, immersion: true }]), true)
  // Music is untouched: never waiting for a language; a category without one is.
  assert.equal(isUnresolved({ contentType: LISTENING, languageProfileId: null }), false)
  assert.equal(isUnresolved({ contentType: W, languageProfileId: null }), true)
})

test('immersion totals and Momentum take immersion categories, not the others', () => {
  setCustomCategories([WATCH, GRAMMAR])
  const now = at(2026, 11, 20, 20)
  const list = [entry(at(2026, 11, 20, 9), HOUR, W), entry(at(2026, 11, 20, 11), HOUR, G), entry(at(2026, 11, 20, 13), HOUR, PODCAST)]
  assert.equal(immersionTotal(list, now), 2 * HOUR)
  assert.equal(goldenTodayMillis(list, now), 2 * HOUR)
})

test('the General goal takes immersion categories too', () => {
  setCustomCategories([WATCH, GRAMMAR])
  assert.equal(fillsGoal(GENERAL, W), true)
  assert.equal(fillsGoal(GENERAL, G), false)
  assert.equal(fillsGoal(GENERAL, ANKI), false)
  assert.equal(fillsGoal(W, W), true)
  assert.equal(fillsGoal(PODCAST, W), false)
  const now = at(2026, 11, 20, 20)
  const list = [entry(at(2026, 11, 20, 9), HOUR, W), entry(at(2026, 11, 20, 11), HOUR, G), entry(at(2026, 11, 20, 13), HOUR, READING)]
  const totals = dailyTotalsFor(list, 1, GENERAL, now)
  assert.equal([...totals.values()].reduce((a, b) => a + b, 0), 2 * HOUR)
  assert.equal([...dailyTotalsFor(list, 1, G, now).values()][0], HOUR)
})

test('a category goal is in effect unless General replaces it (immersion ones only)', () => {
  setCustomCategories([WATCH, GRAMMAR])
  const p = { podcastGoalMinutes: 0, readingGoalMinutes: 0, generalGoal: false, generalGoalMinutes: 0, ankiGoalMinutes: 0, customGoals: { [WATCH.id]: 20, [GRAMMAR.id]: 15 } }
  assert.equal(customGoalOf(p, WATCH), 20)
  assert.equal(customGoalOf(p, GRAMMAR), 15)
  const general = { ...p, generalGoal: true, generalGoalMinutes: 60 }
  assert.equal(customGoalOf(general, WATCH), 0) // counts toward General instead
  assert.equal(customGoalOf(general, GRAMMAR), 15) // kept apart, like Study
  assert.equal(customGoalOf({ ...p, isAnki: true }, GRAMMAR), 0)
  // Only a category goal: the language still gets a card on Home.
  assert.equal(hasGoal({ ...p, customGoals: { [GRAMMAR.id]: 15 } }), true)
  assert.equal(hasGoal({ ...p, customGoals: {} }), false)
  assert.equal(hasGoal({ ...p, generalGoal: true, customGoals: { [WATCH.id]: 20 } }), false)
  // A goal for a category that's gone doesn't count.
  assert.equal(hasGoal({ ...p, customGoals: { gone0000: 30 } }), false)
})

test('races count an immersion category on the listening side, and not a kept-apart one', () => {
  setCustomCategories([WATCH, GRAMMAR])
  const event = { id: 'e', startMillis: at(2026, 11, 10, 0), endMillis: at(2026, 11, 12, 0) }
  const list = [
    entry(at(2026, 11, 10, 9), HOUR, W),
    entry(at(2026, 11, 10, 11), HOUR, G),
    entry(at(2026, 11, 10, 13), HOUR, READING),
    entry(at(2026, 11, 10, 15), HOUR, W, null), // no language
  ]
  const s = scoreFor(event, list, at(2026, 11, 20))
  assert.equal(s.millis, 2 * HOUR)
  assert.equal(s.readingMillis, HOUR)
  // The live tag shows for an immersion category too.
  const live = { startTimeMillis: at(2026, 11, 20, 9), endTimeMillis: null, contentType: W, languageProfileId: 1 }
  assert.equal(runningForRace([live]), live)
  assert.equal(runningForRace([{ ...live, contentType: G }]), null)
})

test('categories sync as their own prefs record, only once touched when empty', () => {
  const s = defaultState()
  assert.equal(collect(s).prefs.has('categories'), false)
  s.settings.customCategories = [WATCH, GRAMMAR]
  const json = collect(s).prefs.get('categories')
  assert.equal(json, JSON.stringify({ categories: [WATCH, GRAMMAR] }))
  assert.equal('customCategories' in JSON.parse(collect(s).prefs.get('settings')), false)
  s.settings.customCategories = []
  s.settings.customCategoriesTouched = true
  assert.deepEqual(JSON.parse(collect(s).prefs.get('categories')).categories, [])

  // Round trip: another device's record lands in the list, bad ones left out, names cut to 24, immersion true by default.
  const t = defaultState()
  applyRecords(t, [{ coll: 'prefs', id: 'categories', deleted: false, data: { categories: [
    ...JSON.parse(json).categories,
    { id: 'bad id!', name: 'Nope', icon: 'tv', immersion: true },
    { id: 'abc', name: '', icon: 'tv' },
    { id: 'long0000', name: '  A very long category name indeed  ', icon: '' },
    { id: 'watch123', name: 'Duplicate', icon: 'tv', immersion: false },
  ] } }])
  assert.deepEqual(t.settings.customCategories, [WATCH, GRAMMAR, { id: 'long0000', name: 'A very long category nam', icon: 'school', immersion: true }])
  assert.equal(collect(t).prefs.get('categories'), JSON.stringify({ categories: t.settings.customCategories }))
})

test('a language always sends its category goals; one without keeps the local value', () => {
  const s = defaultState()
  s.profiles = [{ id: 7, name: 'Japanese', customGoals: { zz: 10, aa: 5, gone: 0 } }, { id: 8, name: 'Old' }]
  const out = collect(s)
  assert.deepEqual(JSON.parse(out.profile.get('7')).customGoals, { aa: 5, zz: 10 })
  assert.equal(JSON.stringify(JSON.parse(out.profile.get('7')).customGoals), '{"aa":5,"zz":10}') // ids sorted, like the phone
  assert.deepEqual(JSON.parse(out.profile.get('8')).customGoals, {})

  // From a device that knows them: taken (cleaned). From an older one without the field: kept.
  applyRecords(s, [{ coll: 'profile', id: '7', deleted: false, data: { id: 7, name: 'Japanese', customGoals: { aa: 25, bb: -3 } } }])
  assert.deepEqual(s.profiles.find((p) => p.id === 7).customGoals, { aa: 25 })
  applyRecords(s, [{ coll: 'profile', id: '7', deleted: false, data: { id: 7, name: 'Japanese 2' } }])
  const p = s.profiles.find((x) => x.id === 7)
  assert.equal(p.name, 'Japanese 2')
  assert.deepEqual(p.customGoals, { aa: 25 })
  assert.deepEqual(cleanCustomGoals({ b: '3', a: 0, c: 2.7 }), { b: 3, c: 2 })
  assert.deepEqual(parseCustomGoals('watch123=20,gram4567=15,bad,x=0'), { gram4567: 15, watch123: 20 })
})

test('deleting a category moves its sessions, drops its goals everywhere and leaves the list', () => {
  let clock = 1_800_000_000_000
  const realNow = Date.now
  Date.now = () => clock
  try {
    replaceState(defaultState())
    saveCustomCategory(WATCH)
    saveCustomCategory(GRAMMAR)
    assert.equal(getState().settings.customCategoriesTouched, true)
    assert.equal(counts(W, 1), true) // the store keeps the rules' copy in step
    const lang = newProfile({ name: 'Japanese', customGoals: { [WATCH.id]: 20, [GRAMMAR.id]: 10 } })
    upsertProfile(lang)
    logCompletedManualEntry(W, lang.id, 'A film', HOUR)
    startManualEntry(W, lang.id, 'Another film')
    clock += 120_000
    deleteCustomCategory(WATCH.id, PODCAST)
    const st = getState()
    assert.deepEqual(st.settings.customCategories, [GRAMMAR])
    assert.equal(st.entries.filter((e) => e.contentType === W).length, 0)
    assert.equal(st.entries.filter((e) => e.contentType === PODCAST).length, 2)
    assert.ok(st.entries.every((e) => e.endTimeMillis != null)) // the running one ended first
    assert.deepEqual(st.profiles.find((p) => p.id === lang.id).customGoals, { [GRAMMAR.id]: 10 })
    assert.equal(counts(W, 1), false)
    // Starting in a category ends whatever else runs: one session at a time.
    startManualEntry(G, lang.id, 'Verbs')
    clock += 1000
    startManualEntry(READING, lang.id, 'A book')
    assert.equal(getState().entries.filter((e) => e.endTimeMillis == null).length, 1)
    assert.ok(categoriesFromJson([GRAMMAR]).length === 1)
  } finally {
    Date.now = realNow
    replaceState(defaultState())
  }
})
