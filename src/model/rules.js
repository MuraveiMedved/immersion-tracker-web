// What counts as immersion, goal streaks and Momentum (the golden streak) - ported one-to-one
// from the phone's Immersion.kt and StreakCalculator.kt so both give the same numbers.
import { epochDay, goalEpochDay, goalEpochDayStart, goalDayStart, HOUR } from './time.js'

export const LISTENING = 'LISTENING' // music
export const PODCAST = 'PODCAST' // spoken listening - "Listening" in the UI
export const READING = 'READING'
export const ANKI = 'ANKI'
/** Not an entry type: the General goal's ring - listening and reading together (∞ icon). */
export const GENERAL = 'GENERAL'

/* ------------------------------------------------------------------------------------------------
 * The user's own categories (the phone's CustomCategory.kt / CustomCategories): kinds of activity
 * next to Listening, Reading and Study, each { id, name, icon, immersion }. A session in one has the
 * type "CUSTOM_<id>" - kept even after the category is deleted on another device ("Other" then).
 * The list lives in settings.customCategories (synced as the prefs record 'categories'); the store
 * mirrors it here with setCustomCategories, for the rules that have no state at hand (counts,
 * fillsGoal, typeLabel) - like the phone's CustomCategories object.
 * --------------------------------------------------------------------------------------------- */
export const CUSTOM_PREFIX = 'CUSTOM_'
export const CATEGORY_NAME_MAX = 24
export const DEFAULT_CATEGORY_ICON = 'school'
/** The icons a category can have, in the picker's order (CategoryIcons.KEYS; the SVGs are CATEGORY_ICONS in ui/icons.js). */
export const CATEGORY_ICON_KEYS = [
  'school', 'translate', 'edit_note', 'spellcheck', 'quiz', 'psychology',
  'lightbulb', 'auto_stories', 'article', 'newspaper', 'mic', 'record_voice_over',
  'hearing', 'chat', 'forum', 'groups', 'movie', 'tv',
  'live_tv', 'sports_esports', 'theater_comedy', 'piano', 'draw', 'brush',
  'keyboard', 'laptop', 'public', 'flight', 'local_cafe', 'self_improvement',
]

let customCategories = []
/** Only the store (and tests) set it. */
export function setCustomCategories(list) { customCategories = Array.isArray(list) ? list : [] }
export const getCustomCategories = () => customCategories

export const customType = (id) => CUSTOM_PREFIX + id
export const isCustomType = (type) => typeof type === 'string' && type.startsWith(CUSTOM_PREFIX) && type.length > CUSTOM_PREFIX.length
export const customIdOf = (type) => (isCustomType(type) ? type.slice(CUSTOM_PREFIX.length) : null)
/** [type]'s category while it exists - null for the built-in types and deleted categories. */
export function categoryOf(type, categories = customCategories) {
  const id = customIdOf(type)
  return id == null ? null : categories.find((c) => c.id === id) || null
}
/** The type itself is immersion (whatever the language): Listening, Reading, or a category that counts as immersion. */
export const isImmersionType = (type, categories = customCategories) =>
  type === PODCAST || type === READING || (isCustomType(type) && categoryOf(type, categories)?.immersion === true)

/** One category from synced/stored JSON, or null (CustomCategory.fromJson): an id of letters and digits,
 *  a name trimmed and cut to 24, the icon kept as sent (blank: school), immersion true unless it says false. */
export function categoryFromJson(o) {
  if (!o || typeof o !== 'object') return null
  const id = String(o.id ?? '').trim()
  const name = String(o.name ?? '').trim()
  if (!id || !name || !/^[\p{L}\p{N}]+$/u.test(id)) return null
  const icon = String(o.icon ?? '').trim() ? String(o.icon) : DEFAULT_CATEGORY_ICON
  return { id, name: name.slice(0, CATEGORY_NAME_MAX), icon, immersion: typeof o.immersion === 'boolean' ? o.immersion : true }
}
/** A list of them, bad ones and repeated ids left out (CustomCategory.listFromJson). */
export function categoriesFromJson(list) {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const out = []
  for (const o of list) {
    const c = categoryFromJson(o)
    if (!c || seen.has(c.id)) continue
    seen.add(c.id)
    out.push(c)
  }
  return out
}
/** The JSON sent for a category, fields in the phone's order (CustomCategory.toJson). */
export const categoryToJson = (c) => ({ id: c.id, name: c.name, icon: c.icon, immersion: !!c.immersion })
/** A fresh id: 8 letters and digits (it's part of the stored type name). */
export function newCategoryId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return id
}
/** The icon key to draw for [type]'s category: its own if it's one of ours, else school (deleted, or unknown). */
export function categoryIconOf(type, categories = customCategories) {
  const icon = categoryOf(type, categories)?.icon
  return CATEGORY_ICON_KEYS.includes(icon) ? icon : DEFAULT_CATEGORY_ICON
}
export const categoryIconKey = (icon) => (CATEGORY_ICON_KEYS.includes(icon) ? icon : DEFAULT_CATEGORY_ICON)

/** A language's category goals (category id -> minutes), only positive whole minutes, ids sorted -
 *  the shape synced as a language record's customGoals (the phone's encodeCustomGoals). */
export function cleanCustomGoals(goals) {
  const out = {}
  if (!goals || typeof goals !== 'object') return out
  for (const id of Object.keys(goals).sort()) {
    const m = Math.floor(Number(goals[id]) || 0)
    if (m > 0 && id.trim()) out[id] = m
  }
  return out
}
/** [category]'s goal in effect for language [p] (LanguageProfile.customGoal): none for an immersion
 *  category while the General goal replaces the separate ones (it counts toward General then), and
 *  none on the retired Anki profile. Kept apart categories keep theirs, like Study. */
export const customGoalOf = (p, category) =>
  p.isAnki || (p.generalGoal && category.immersion) ? 0 : Math.max(0, Math.floor(Number(p.customGoals?.[category.id]) || 0))

/** A language's goals in effect (LanguageProfile.listeningGoal / readingGoal / generalGoalOrZero):
 *  with [generalGoal] on, one General goal replaces the separate listening and reading ones. */
export const listeningGoalOf = (p) => (p.generalGoal ? 0 : p.podcastGoalMinutes || 0)
export const readingGoalOf = (p) => (p.generalGoal ? 0 : p.readingGoalMinutes || 0)
export const generalGoalOf = (p) => (p.generalGoal ? p.generalGoalMinutes || 0 : 0)
/** The language's daily Anki goal (LanguageProfile.ankiGoal) - Anki is a third mode of each
 *  language, never part of the General goal; the retired Anki profile has none. */
export const ankiGoalOf = (p) => (p.isAnki ? 0 : p.ankiGoalMinutes || 0)
/** Any goal at all in effect - what puts a language's card on Home (a category goal too). */
export const hasGoal = (p, categories = customCategories) =>
  listeningGoalOf(p) > 0 || readingGoalOf(p) > 0 || generalGoalOf(p) > 0 || ankiGoalOf(p) > 0 || categories.some((c) => customGoalOf(p, c) > 0)
/** Whether an entry type fills a goal ring of [goalType] - GENERAL takes every kind of immersion
 *  (listening, reading and the categories that count). */
export const fillsGoal = (goalType, type) => (goalType === GENERAL ? isImmersionType(type) : type === goalType)

export const GOLDEN_DAYS = 10
export const GOLDEN_DAILY_MILLIS = HOUR
const MAX_GOLDEN_LOOKBACK_DAYS = 400

export const durationOf = (e, now = Date.now()) => Math.max(0, (e.endTimeMillis ?? now) - e.startTimeMillis)

/** Waiting to be given a language. Music never is: it isn't tracked by language (TimeEntry.isUnresolved). */
export const isUnresolved = (e) => e.languageProfileId == null && e.contentType !== LISTENING

/** Immersion is spoken listening or reading, with a language - not music, not Anki. A category
 *  counts when it says so. */
export const counts = (type, languageProfileId, categories = customCategories) => languageProfileId != null && isImmersionType(type, categories)

/** Immersion per goal day (epoch-day numbers, days from 4 AM like the goal rings) for the last [days]
 *  days up to [now] - a running session counts up to now, and one crossing 4 AM is split between its days. */
export function dailyMillis(entries, now, days = GOLDEN_DAYS + 1) {
  const today = goalEpochDay(now)
  const firstDay = today - (days - 1)
  const windowStart = goalEpochDayStart(firstDay)
  const totals = new Map()
  for (const e of entries) {
    if (!counts(e.contentType, e.languageProfileId)) continue
    const end = Math.min(e.endTimeMillis ?? now, now)
    if (end <= windowStart) continue
    let start = e.startTimeMillis
    while (start < end) {
      const day = goalEpochDay(start)
      const partEnd = Math.min(end, goalEpochDayStart(day + 1))
      if (day >= firstDay && day <= today) totals.set(day, (totals.get(day) || 0) + (partEnd - start))
      start = partEnd
    }
  }
  return totals
}

/** Days in a row with 1+ hour - today counts once it reaches that, otherwise up to yesterday. */
export function goldenStreakDays(entries, now = Date.now()) {
  const daily = dailyMillis(entries, now, MAX_GOLDEN_LOOKBACK_DAYS)
  const today = goalEpochDay(now)
  const met = (d) => (daily.get(d) || 0) >= GOLDEN_DAILY_MILLIS
  let day = met(today) ? today : today - 1
  let run = 0
  while (run < MAX_GOLDEN_LOOKBACK_DAYS - 1 && met(day)) { run++; day-- }
  return run
}

export const isGolden = (entries, now = Date.now()) => goldenStreakDays(entries, now) >= GOLDEN_DAYS

/** Momentum's tiers (MomentumTier.kt): days in a row of an hour each, and the holo chance eggs
 *  earned at that tier get. Bronze starts at GOLDEN_DAYS. */
export const MOMENTUM_TIERS = [
  { id: 'bronze', name: 'Bronze', minDays: 10, holoPercent: 10 },
  { id: 'silver', name: 'Silver', minDays: 30, holoPercent: 20 },
  { id: 'gold', name: 'Gold', minDays: 60, holoPercent: 25 },
  { id: 'diamond', name: 'Diamond', minDays: 100, holoPercent: 30 },
]

/** The tier a run of `days` has reached - null below Bronze. */
export function momentumTier(days) {
  let tier = null
  for (const t of MOMENTUM_TIERS) if (days >= t.minDays) tier = t
  return tier
}

/** The tier after `tier` (Bronze after none), or null at Diamond. */
export const nextMomentumTier = (tier) => (tier ? MOMENTUM_TIERS[MOMENTUM_TIERS.indexOf(tier) + 1] || null : MOMENTUM_TIERS[0])

export function goldenTodayMillis(entries, now = Date.now()) {
  return dailyMillis(entries, now, 1).get(goalEpochDay(now)) || 0
}

/** Goal streak from per-day totals keyed by goal day (see dailyTotalsFor). Any missed day breaks
 *  it; today (the goal day, from 4 AM) not being met yet doesn't. */
export function computeStreak(dailyTotals, goalMillis, now = Date.now()) {
  if (goalMillis <= 0) return { current: 0, record: 0 }
  const metDays = []
  for (const [dayMs, total] of dailyTotals) if (total >= goalMillis) metDays.push(epochDay(dayMs))
  if (!metDays.length) return { current: 0, record: 0 }
  metDays.sort((a, b) => a - b)
  const set = new Set(metDays)
  let record = 0, run = 0, prev = null
  for (const d of metDays) {
    if (d === prev) continue
    run = prev != null && d === prev + 1 ? run + 1 : 1
    record = Math.max(record, run)
    prev = d
  }
  let current = 0
  let cursor = epochDay(goalDayStart(now))
  if (!set.has(cursor)) cursor--
  while (set.has(cursor)) { current++; cursor-- }
  return { current, record }
}

/** Per-goal-day totals (keyed by the 4 AM start of the goal day a session started in, like the
 *  phone) for one language and content type (or GENERAL: listening and reading together). */
export function dailyTotalsFor(entries, profileId, type, now = Date.now()) {
  const totals = new Map()
  for (const e of entries) {
    if (e.languageProfileId !== profileId || !fillsGoal(type, e.contentType)) continue
    const d = goalDayStart(e.startTimeMillis)
    totals.set(d, (totals.get(d) || 0) + durationOf(e, now))
  }
  return totals
}

/** All-time immersion, a running session counting up to now. */
/**
 * [entries] as this browser can vouch for them: a session from another device (the phone, a
 * computer) that still looks running here is left out until its stop syncs. That device reports
 * its own live time; counted here up to "now", it grew without limit whenever the stop never
 * arrived (the phone offline, the app killed) - and the race report and profile sent from here
 * then showed friends hours that were never done. Used for everything sent or credited from here
 * (race scores, the profile, Zoo eggs, challenges), not for what's shown on screen.
 */
/** [entries] without those of languages left out of races (a language's excludeFromRaces) - what races and Challenges
 *  total (the phone's countedInRaces). */
export function raceEntries(entries, profiles) {
  const left = new Set((profiles || []).filter((p) => p.excludeFromRaces).map((p) => p.id))
  return left.size ? entries.filter((e) => !left.has(e.languageProfileId)) : entries
}

export const vouchedEntries = (entries) => entries.filter((e) => e.endTimeMillis != null || e.appPackage === 'web')

export function immersionTotal(entries, now = Date.now()) {
  let t = 0
  for (const e of entries) if (counts(e.contentType, e.languageProfileId)) t += durationOf(e, now)
  return t
}

/** A type's name: the built-in four, a category's own name, "Other" for a deleted category's. */
export function typeLabel(t) {
  const builtIn = { [PODCAST]: 'Listening', [READING]: 'Reading', [ANKI]: 'Study', [LISTENING]: 'Music' }[t]
  if (builtIn) return builtIn
  if (isCustomType(t)) return categoryOf(t)?.name || 'Other'
  return t
}

/** Names a category can't have: the built-in kinds' (so two kinds never read the same). */
export const BUILT_IN_TYPE_NAMES = ['Listening', 'Reading', 'Study', 'Music']
