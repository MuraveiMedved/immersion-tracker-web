// Run with: TZ=America/Chicago npm test
import test from 'node:test'
import assert from 'node:assert/strict'
import { goldenStreakDays, isGolden, computeStreak, counts, dailyTotalsFor, momentumTier, nextMomentumTier, PODCAST, READING, ANKI, LISTENING, GENERAL, listeningGoalOf, readingGoalOf, generalGoalOf, ankiGoalOf, hasGoal, vouchedEntries } from '../src/model/rules.js'
import { goalDayStart } from '../src/model/time.js'
import { cappedAnki, scoreFor, addSplitByDay } from '../src/model/race.js'
import { lootBoxTier, immersionReachedAt, computeCertificate, hourMarkAt } from '../src/model/zoo.js'
import { parsePolyLogger, parseToggl, csvRows, guessMapping } from '../src/model/imports.js'
import { HOUR } from '../src/model/time.js'

const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime()
const entry = (start, ms, type = PODCAST, lang = 1, extra = {}) => ({ startTimeMillis: start, endTimeMillis: start + ms, contentType: type, languageProfileId: lang, mediaTitle: '', ...extra })

test('what counts as immersion', () => {
  assert.equal(counts(PODCAST, 1), true)
  assert.equal(counts(READING, 1), true)
  assert.equal(counts(LISTENING, 1), false)
  assert.equal(counts(ANKI, 1), false)
  assert.equal(counts(PODCAST, null), false)
})

test('Momentum: today counts only once it reaches 1h', () => {
  const now = at(2026, 10, 16, 9)
  const days = [11, 12, 13, 14, 15].map((d) => entry(at(2026, 10, d, 10), HOUR))
  assert.equal(goldenStreakDays(days, now), 5)
  // Half an hour today doesn't break or add to it.
  assert.equal(goldenStreakDays([...days, entry(at(2026, 10, 16, 8), HOUR / 2)], now), 5)
  assert.equal(goldenStreakDays([...days, entry(at(2026, 10, 16, 6), HOUR)], at(2026, 10, 16, 9)), 6)
  // A short day breaks the run.
  assert.equal(goldenStreakDays([entry(at(2026, 10, 13, 10), HOUR), entry(at(2026, 10, 14, 10), HOUR / 2), entry(at(2026, 10, 15, 10), HOUR)], now), 1)
  // Music and Anki don't count.
  assert.equal(goldenStreakDays([13, 14, 15].map((d) => entry(at(2026, 10, d, 10), 3 * HOUR, ANKI))), 0)
  // Gold from ten days.
  const ten = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((d) => entry(at(2026, 10, d, 10), HOUR))
  assert.equal(isGolden(ten.slice(1), now), false)
  assert.equal(isGolden(ten, now), true)
})

test('Momentum: a deleted language\'s entries are uncategorized and stop counting', () => {
  // Deleting a language clears it from its entries on both phone and web (the phone used to keep
  // the dead id and still count them, so its streak ran longer than the web's).
  const now = at(2026, 10, 16, 9)
  const days = [11, 12, 13, 14, 15].map((d) => entry(at(2026, 10, d, 10), HOUR, PODCAST, d === 13 ? 2 : 1))
  assert.equal(goldenStreakDays(days, now), 5)
  const afterDelete = days.map((e) => (e.languageProfileId === 2 ? { ...e, languageProfileId: null } : e))
  assert.equal(goldenStreakDays(afterDelete, now), 2)
  // Given a language again, it counts again.
  assert.equal(goldenStreakDays(afterDelete.map((e) => ({ ...e, languageProfileId: e.languageProfileId ?? 1 })), now), 5)
})

test('Momentum splits sessions across midnight', () => {
  const now = at(2026, 10, 16, 12)
  // 22:00 -> 02:00 is 2h on the 14th and 2h on the 15th.
  const list = [entry(at(2026, 10, 14, 22), 4 * HOUR)]
  assert.equal(goldenStreakDays(list, now), 2)
})

test('goal streaks: missed today does not break, a missed day does', () => {
  const now = at(2026, 10, 16, 9)
  const list = [12, 14, 15].map((d) => entry(at(2026, 10, d, 10), 30 * 60000))
  const r = computeStreak(dailyTotalsFor(list, 1, PODCAST, now), 30 * 60000, now)
  assert.deepEqual(r, { current: 2, record: 2 })
})

test('Anki counts up to 10% of immersion, the rest is banked', () => {
  const r = cappedAnki(new Map([[20261001, 10 * HOUR], [20261002, 0]]), new Map([[20261001, 3 * HOUR], [20261002, 0]]))
  assert.equal(r.counted, HOUR)
  assert.equal(r.banked, 2 * HOUR)
  const later = cappedAnki(new Map([[20261001, 10 * HOUR], [20261002, 10 * HOUR]]), new Map([[20261001, 3 * HOUR]]))
  assert.equal(later.counted, 2 * HOUR)
  assert.equal(later.countedByDay.get(20261002), HOUR)
})

test('race days start at 4am', () => {
  const m = new Map()
  addSplitByDay(m, at(2026, 10, 15, 23), at(2026, 10, 16, 5))
  assert.equal(m.get(20261015), 5 * HOUR)
  assert.equal(m.get(20261016), HOUR)
})

test('race score: only the window, no music, reading split out', () => {
  const event = { id: 'e', startMillis: at(2026, 10, 10, 0), endMillis: at(2026, 10, 12, 0) }
  const list = [
    entry(at(2026, 10, 9, 23), 2 * HOUR), // 1h inside
    entry(at(2026, 10, 10, 12), HOUR, READING),
    entry(at(2026, 10, 10, 13), HOUR, LISTENING),
    entry(at(2026, 10, 10, 14), HOUR, PODCAST, null),
  ]
  const s = scoreFor(event, list, at(2026, 10, 20))
  assert.equal(s.millis, 2 * HOUR)
  assert.equal(s.readingMillis, HOUR)
  assert.equal(s.windowEnd, event.endMillis)
  assert.equal(s.active, false)
})

test('loot box odds table', () => {
  assert.equal(lootBoxTier(0), 'RAINBOW')
  assert.equal(lootBoxTier(1), 'ORANGE')
  assert.equal(lootBoxTier(5), 'ORANGE')
  assert.equal(lootBoxTier(6), 'PURPLE')
  assert.equal(lootBoxTier(15), 'PURPLE')
  assert.equal(lootBoxTier(16), 'BLUE')
  assert.equal(lootBoxTier(45), 'BLUE')
  assert.equal(lootBoxTier(46), 'GREEN')
  assert.equal(lootBoxTier(99), 'GREEN')
})

test('certificates: hour mark, native language, latest title', () => {
  const list = [entry(at(2026, 10, 1, 10), 5 * HOUR, PODCAST, 1, { mediaTitle: 'A' }), entry(at(2026, 10, 2, 10), 6 * HOUR, READING, 2, { mediaTitle: 'B' })]
  const profiles = [{ id: 1, name: 'Japanese', colorHex: '#111111' }, { id: 2, name: 'Russian', colorHex: '#222222' }]
  assert.equal(immersionReachedAt(list, 10 * HOUR, Date.now()), at(2026, 10, 2, 15))
  const c = computeCertificate(list, profiles, at(2026, 10, 3))
  assert.equal(c.hourMark, 11)
  assert.equal(c.languageName, 'Russian')
  assert.equal(c.mediaTitle, 'B')
})

test('CSV with quotes and line breaks', () => {
  assert.deepEqual(csvRows('a,"b,c","d""e"\n"multi\nline",x'), [['a', 'b,c', 'd"e'], ['multi\nline', 'x']])
})

test('PolyLogger: back to back from noon, in logged order', () => {
  const csv = 'Activity,Language,Activity Type,Time (minutes),Date\nShow B,Japanese,Listening,30,2026-10-01\nShow A,Japanese,Listening,60,2026-10-01\n'
  const rows = parsePolyLogger(csv)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].description, 'Show A')
  assert.equal(rows[0].start, at(2026, 10, 1, 12))
  assert.equal(rows[1].start, at(2026, 10, 1, 13))
  assert.equal(rows[0].project, 'Japanese · Listening')
})

test('Toggl detailed export', () => {
  const csv = 'Project,Description,Start date,Start time,End date,End time,Duration\nJP Reading,Book,2026-10-01,09:00:00,2026-10-01,10:30:00,01:30:00\n'
  const rows = parseToggl(csv)
  assert.equal(rows[0].end - rows[0].start, 90 * 60000)
  const m = guessMapping('JP Reading', [{ id: 3, name: 'Japanese', scriptDetectors: ['JAPANESE_KANA'], isAnki: false }])
  assert.deepEqual(m, { type: READING, languageProfileId: 3 })
})

test('time of day leaves out PolyLogger imports from the web and from the phone', async () => {
  const { timeOfDay } = await import('../src/model/stats.js')
  const entries = [
    entry(at(2026, 3, 1, 12), HOUR, PODCAST, 1, { appPackage: 'import:polylogger' }),
    entry(at(2026, 3, 2, 12), HOUR, PODCAST, 1, { appPackage: 'polylogger-import' }),
    entry(at(2026, 3, 3, 20), HOUR, PODCAST, 1, { appPackage: 'manual' }),
  ]
  const hours = timeOfDay(entries, null, at(2026, 3, 10)).get(1)
  assert.equal(hours[12], 0)
  assert.equal(hours[20], HOUR)
})

test('goal days run from 4 AM: a late night counts for the day before', () => {
  // 2 AM on the 16th belongs to the 15th's goal day; 5 AM is the 16th's.
  assert.equal(goalDayStart(at(2026, 10, 16, 2)), at(2026, 10, 15, 4))
  assert.equal(goalDayStart(at(2026, 10, 16, 5)), at(2026, 10, 16, 4))
  // 30 min at 11 PM on the 14th + 30 min at 1 AM on the 15th meet the 14th's 1 h goal, and at
  // 3 AM on the 15th the 14th is still "today", so the streak is 1 with nothing more needed.
  const list = [entry(at(2026, 10, 14, 23), HOUR / 2), entry(at(2026, 10, 15, 1), HOUR / 2)]
  assert.equal(computeStreak(dailyTotalsFor(list, 1, PODCAST, at(2026, 10, 15, 3)), HOUR, at(2026, 10, 15, 3)).current, 1)
})

test('Momentum tiers: Bronze 10 / Silver 30 / Gold 60 / Diamond 100 days, holo 10/20/25/30%', () => {
  const at = (d) => momentumTier(d)?.id ?? null
  assert.deepEqual([0, 9, 10, 29, 30, 59, 60, 99, 100, 400].map(at), [null, null, 'bronze', 'bronze', 'silver', 'silver', 'gold', 'gold', 'diamond', 'diamond'])
  assert.deepEqual([10, 30, 60, 100].map((d) => momentumTier(d).holoPercent), [10, 20, 25, 30])
  assert.equal(nextMomentumTier(null).id, 'bronze')
  assert.equal(nextMomentumTier(momentumTier(100)), null)
})

test('General goal: listening and reading together, replacing the separate goals', () => {
  const p = { podcastGoalMinutes: 30, readingGoalMinutes: 20, generalGoal: true, generalGoalMinutes: 45 }
  assert.deepEqual([listeningGoalOf(p), readingGoalOf(p), generalGoalOf(p), hasGoal(p)], [0, 0, 45, true])
  const off = { ...p, generalGoal: false }
  assert.deepEqual([listeningGoalOf(off), readingGoalOf(off), generalGoalOf(off)], [30, 20, 0])
  assert.equal(hasGoal({ podcastGoalMinutes: 30, generalGoal: true, generalGoalMinutes: 0 }), false)
  const day = at(2026, 10, 20)
  const entries = [entry(day, 20 * 60000, PODCAST), entry(day + HOUR, 25 * 60000, READING), entry(day + 2 * HOUR, 60 * 60000, LISTENING), entry(day + 3 * HOUR, 10 * 60000, ANKI), entry(day, 5 * 60000, READING, 2)]
  const totals = dailyTotalsFor(entries, 1, GENERAL, day + 5 * HOUR)
  assert.equal(totals.get(goalDayStart(day)), 45 * 60000)
  assert.equal(computeStreak(totals, 45 * 60000, day + 5 * HOUR).current, 1)
})

test('General goal changes only goal progress: race score and stats read the same', async () => {
  // Bars, quick stats and time of day take entries and language ids only - no goals - so the
  // heatmap (the one stats view given the profiles) and the race score are what can differ.
  const { heatmap } = await import('../src/model/stats.js')
  const now = at(2026, 10, 20, 20)
  const day = at(2026, 10, 20)
  const list = [entry(day, 20 * 60000, PODCAST), entry(day + HOUR, 25 * 60000, READING), entry(day + 2 * HOUR, 60 * 60000, LISTENING), entry(day - 24 * HOUR, 40 * 60000, READING), entry(day + 3 * HOUR, 10 * 60000, ANKI, 3)]
  const separate = [{ id: 1, name: 'Japanese', colorHex: '#DB434F', podcastGoalMinutes: 30, readingGoalMinutes: 20 }, { id: 3, name: 'Anki', colorHex: '#888888', isAnki: true }]
  const general = separate.map((p) => (p.id === 1 ? { ...p, generalGoal: true, generalGoalMinutes: 45 } : p))
  const langs = new Set([1])
  // (Its legend hands back the profiles themselves - compare which languages, not their goal fields.)
  const map = (profiles) => { const h = heatmap(list, langs, profiles, now); return { ...h, legend: h.legend.map((p) => p.id) } }
  assert.deepEqual(map(general), map(separate))
  // The race counts every listening and reading minute once, by its real type (it takes no profiles).
  const s = scoreFor({ id: 'e', startMillis: day - 48 * HOUR, endMillis: null }, list.filter((e) => e.contentType !== ANKI), now)
  assert.equal(s.millis, (20 + 25 + 40) * 60000)
  assert.equal(s.readingMillis, (25 + 40) * 60000)
})

test('a phone session still running here is not reported from the web until its stop syncs', () => {
  const now = at(2026, 10, 22, 22)
  const event = { id: 'e', startMillis: at(2026, 10, 22, 0), endMillis: null }
  const done = entry(at(2026, 10, 22, 9), 2 * HOUR, PODCAST, 1, { appPackage: 'com.spotify.music' })
  // Started on the phone at 10:00 and never heard to stop: counted to "now" it would be 12 hours.
  const stale = { ...entry(at(2026, 10, 22, 10), 0, PODCAST, 1, { appPackage: 'com.spotify.music' }), endTimeMillis: null }
  // A timer running in this browser is this browser's own, so it still counts.
  const mine = { ...entry(at(2026, 10, 22, 21), 0, READING, 1, { appPackage: 'web' }), endTimeMillis: null }
  const kept = vouchedEntries([done, stale, mine])
  assert.deepEqual(kept, [done, mine])
  assert.equal(scoreFor(event, kept, now).millis, 3 * HOUR)
})

test('a certificate\'s hour is total immersion hours at unlock, from the first session', () => {
  const start = at(2025, 1, 1)
  const history = [entry(start, 300 * HOUR), entry(start + 400 * HOUR, 5 * HOUR, LISTENING), entry(start + 410 * HOUR, 2 * HOUR, PODCAST, null), entry(start + 500 * HOUR, 12 * HOUR)]
  assert.equal(hourMarkAt(history, start + 506 * HOUR), 306)
  assert.equal(hourMarkAt(history, start + 600 * HOUR), 312)
  assert.equal(hourMarkAt([], start), null)
})

test('Anki is a mode of each language: its own goal, never immersion, never the General goal', () => {
  const ja = { id: 1, name: 'Japanese', podcastGoalMinutes: 0, readingGoalMinutes: 0, ankiGoalMinutes: 15 }
  assert.equal(hasGoal(ja), true)
  assert.equal(ankiGoalOf(ja), 15)
  assert.equal(ankiGoalOf({ ...ja, isAnki: true }), 0)
  assert.equal(hasGoal({ ...ja, ankiGoalMinutes: 0 }), false)
  assert.equal(counts(ANKI, 1), false)
  // Toggl: an Anki project goes to the language it names, never the retired Anki profile.
  const profiles = [{ id: 3, name: 'Japanese', scriptDetectors: ['JAPANESE_KANA'], isAnki: false }, { id: 9, name: 'Anki', isAnki: true }]
  assert.deepEqual(guessMapping('JP Anki', profiles), { type: ANKI, languageProfileId: 3 })
  assert.deepEqual(guessMapping('Vocabulary', profiles), { type: ANKI, languageProfileId: null })
  // An Anki goal streak counts Anki only.
  const day = at(2026, 10, 1)
  const entries = [entry(day, 20 * 60000, ANKI), entry(day, 60 * 60000, PODCAST)]
  const streak = computeStreak(dailyTotalsFor(entries, 1, ANKI, day + HOUR), 15 * 60000, day + HOUR)
  assert.equal(streak.current, 1)
})

test('race Anki counts the same whether it is on a language, the old Anki profile or none', () => {
  const start = at(2026, 10, 1, 8)
  const event = { id: 'e', startMillis: start, endMillis: start + 48 * HOUR, standings: [] }
  const now = start + 20 * HOUR
  const with_ = (lang) => scoreFor(event, [entry(start + HOUR, 8 * HOUR, PODCAST, 1), entry(start + 10 * HOUR, 2 * HOUR, ANKI, lang)], now)
  const legacy = with_(9)
  for (const lang of [1, null]) {
    const score = with_(lang)
    for (const k of ['millis', 'readingMillis', 'ankiMillis', 'ankiBankedMillis']) assert.equal(score[k], legacy[k], k)
    assert.deepEqual(score.dailyAnki, legacy.dailyAnki)
  }
  assert.equal(legacy.ankiMillis, 8 * HOUR / 10)
})
