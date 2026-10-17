// Every start / stop / switch / discard of a live timer goes through here, so each one is a single
// tap with an Undo in its toast instead of a confirm dialog - timers get started and stopped many
// times a day, and a mis-tap should cost one more tap, not a trip into the entry list.
import { getState, startManualEntry, stopRunningEntry, deleteRunningEntry, reopenEntry, discardEntry, profileById, runningEntry, PODCAST, READING, ANKI } from '../store.js'
import { durationOf } from '../model/rules.js'
import { formatHm } from '../model/time.js'
import { toast } from './common.jsx'

const KIND = { [PODCAST]: 'listening', [READING]: 'reading', [ANKI]: 'Anki' }

/** "Japanese listening", "Anki", "Uncategorized reading". */
export function sessionName(type, languageProfileId) {
  if (type === ANKI) return 'Anki'
  return `${profileById(languageProfileId)?.name || 'Uncategorized'} ${KIND[type] || 'music'}`
}

/** The title a fresh session gets - "Manual Japanese session", as the phone names one. Repeating
 *  an earlier session (same title) is what the Start again list is for. */
export function defaultTitle(languageProfileId) {
  return `Manual ${profileById(languageProfileId)?.name || 'Uncategorized'} session`
}

/** The last few distinct sessions of [type] (by title + language), newest first - each one a
 *  one-click way to start it again. */
export function recentSessions(type, limit = 4) {
  const seen = new Set()
  const out = []
  for (const e of [...getState().entries].sort((a, b) => b.startTimeMillis - a.startTimeMillis)) {
    if (e.contentType !== type || !e.mediaTitle) continue
    const key = `${e.mediaTitle}|${e.languageProfileId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
    if (out.length >= limit) break
  }
  return out
}

/** Starts a timer. If one of the same type was running it's closed (and said so); Undo takes the
 *  new one back and lets the old one run on. */
export function startTimer(type, languageProfileId, title = defaultTitle(languageProfileId)) {
  const replaced = runningEntry(type)
  const snapshot = replaced && { ...replaced }
  const id = startManualEntry(type, languageProfileId, title)
  const name = sessionName(type, languageProfileId)
  const switched = snapshot && (snapshot.languageProfileId !== languageProfileId || snapshot.mediaTitle !== title)
  toast(switched ? `Switched to ${name}` : `${name[0].toUpperCase()}${name.slice(1)} started`, {
    label: 'Undo',
    run: () => { discardEntry(id); if (snapshot) reopenEntry(snapshot) },
  })
}

/** Stops a running timer and saves it; Undo lets it run on as if never stopped. */
export function stopTimer(entry) {
  const snapshot = { ...entry }
  const ms = durationOf(entry)
  stopRunningEntry(entry.contentType)
  toast(ms < 60000 ? 'Stopped - too short to count' : `${formatHm(ms)} of ${sessionName(entry.contentType, entry.languageProfileId)} saved`, {
    label: 'Undo',
    run: () => reopenEntry(snapshot),
  })
}

/** Throws a running timer away without counting it; Undo brings it back, still running. */
export function discardTimer(entry) {
  const snapshot = { ...entry }
  deleteRunningEntry(entry.contentType)
  toast('Session discarded', { label: 'Undo', run: () => reopenEntry(snapshot) })
}

/** Tapping a ring: stops that language's timer of that type if it's the one running, else starts it. */
export function toggleTimer(type, languageProfileId) {
  const r = runningEntry(type)
  if (r && r.languageProfileId === languageProfileId) stopTimer(r)
  else startTimer(type, languageProfileId)
}

/** The most recent session that can be resumed in one tap (manual or not), when nothing's running. */
export function lastSession() {
  let best = null
  for (const e of getState().entries) {
    if (e.endTimeMillis == null || (e.contentType !== PODCAST && e.contentType !== READING && e.contentType !== ANKI)) continue
    if (!best || e.endTimeMillis > best.endTimeMillis) best = e
  }
  return best
}
