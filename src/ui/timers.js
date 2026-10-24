// Every start / stop / switch / discard of a live timer goes through here, so each one is a single
// tap with an Undo in its toast instead of a confirm dialog - timers get started and stopped many
// times a day, and a mis-tap should cost one more tap, not a trip into the entry list.
import { getState, isHiddenManualSession, startManualEntry, stopRunningEntry, deleteRunningEntry, reopenEntry, discardEntry, profileById, runningEntry, pauseRunningEntry, resumePaused, dismissPaused, discardPaused, restorePaused, WEB_APP, PODCAST, READING, ANKI } from '../store.js'
import { durationOf } from '../model/rules.js'
import { formatHm } from '../model/time.js'
import { toast } from './common.jsx'

const KIND = { [PODCAST]: 'listening', [READING]: 'reading', [ANKI]: 'study' }

/** "Japanese listening", "Japanese study", "Uncategorized reading". */
export function sessionName(type, languageProfileId) {
  return `${profileById(languageProfileId)?.name || 'Uncategorized'} ${KIND[type] || 'music'}`
}

/** The title a fresh session gets - "Manual Japanese session", as the phone names one. Repeating
 *  an earlier session (same title) is what the Start again list is for. */
export function defaultTitle(languageProfileId) {
  return `Manual ${profileById(languageProfileId)?.name || 'Uncategorized'} session`
}

/** The last few distinct manual sessions of [type] (by title + language), newest first - each one
 *  a one-click way to start it again. Tracked ones (from the phone or a computer) aren't offered. */
export function recentSessions(type, limit = 4) {
  const seen = new Set()
  const out = []
  for (const e of [...getState().entries].sort((a, b) => b.startTimeMillis - a.startTimeMillis)) {
    if (e.contentType !== type || !e.mediaTitle || !e.isManual) continue
    const key = `${e.mediaTitle}|${e.languageProfileId}`
    if (seen.has(key)) continue
    seen.add(key)
    if (isHiddenManualSession(e)) continue
    out.push(e)
    if (out.length >= limit) break
  }
  return out
}

/** Starts a timer. Whatever was running is closed first (and said so) - one session at a time;
 *  Undo takes the new one back and lets the old one run on. */
export function startTimer(type, languageProfileId, title = defaultTitle(languageProfileId)) {
  // Only one session runs at a time, so whatever's running (of any type) is what this replaces.
  const replaced = getState().entries.find((e) => e.endTimeMillis == null)
  const snapshot = replaced && { ...replaced }
  const id = startManualEntry(type, languageProfileId, title)
  const name = sessionName(type, languageProfileId)
  const switched = snapshot && (snapshot.contentType !== type || snapshot.languageProfileId !== languageProfileId || snapshot.mediaTitle !== title)
  toast(switched ? `Switched to ${name}` : `${name[0].toUpperCase()}${name.slice(1)} started`, {
    label: 'Undo',
    run: () => { discardEntry(id); if (snapshot) reopenEntry(snapshot) },
  })
}

/** A session the phone is tracking (synced here while it runs), not a timer started in the web app. */
export const fromPhone = (entry) => entry.appPackage !== WEB_APP

/** Stops a running timer and saves it; Undo lets it run on as if never stopped. */
export function stopTimer(entry) {
  const snapshot = { ...entry }
  const ms = durationOf(entry)
  stopRunningEntry(entry.contentType)
  const saved = ms < 60000 ? 'Stopped - too short to count' : `${formatHm(ms)} of ${sessionName(entry.contentType, entry.languageProfileId)} saved`
  // The phone only hears about the stop on its next sync - until then it still shows it running.
  toast(fromPhone(entry) ? `${saved} · the phone stops it when it next syncs` : saved, {
    label: 'Undo',
    run: () => reopenEntry(snapshot),
  })
}

/** Pauses a running timer: its time stops counting, and Resume carries on with the same session
 *  (the paused gap never counts). No toast - the banner itself turns into the paused one. */
export function pauseTimer(entry) {
  pauseRunningEntry(entry.contentType)
}

export function resumeTimer(entry) {
  resumePaused(entry.contentType)
}

/** Stop on a paused timer: saved as it is; Undo leaves it paused. */
export function stopPausedTimer(entry) {
  const snapshot = { ...entry }
  const ms = durationOf(entry)
  dismissPaused(entry.contentType)
  if (entry.id == null) return
  toast(ms < 60000 ? 'Stopped - too short to count' : `${formatHm(ms)} of ${sessionName(entry.contentType, entry.languageProfileId)} saved`, {
    label: 'Undo',
    run: () => restorePaused(snapshot),
  })
}

/** Discard on a paused timer; Undo brings it back, still paused. */
export function discardPausedTimer(entry) {
  const snapshot = { ...entry }
  discardPaused(entry.contentType)
  if (entry.id == null) return
  toast('Session discarded', { label: 'Undo', run: () => restorePaused(snapshot) })
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

/** Settings > Tracking > Resume button: minutes after a session ends that Resume still offers it,
 *  shortest first; 0 = always (as the phone's TrackingRepository.RESUME_HIDE_CHOICES). Per device. */
export const RESUME_HIDE_CHOICES = [15, 30, 60, 180, 0]
export const resumeHideLabel = (m) => (m === 0 ? 'Always' : m % 60 === 0 ? `${m / 60}h` : `${m}m`)

/** The most recent web-app session that can be resumed in one tap, when nothing's running. Sessions
 *  synced from the phone are skipped - the Resume bar only offers what was tracked here. Once the
 *  Resume button setting's time has passed since it ended, there's none. */
export function lastSession(now = Date.now()) {
  const hideMinutes = getState().settings.resumeHideMinutes ?? 60
  let best = null
  for (const e of getState().entries) {
    if (e.endTimeMillis == null || e.appPackage !== WEB_APP || (e.contentType !== PODCAST && e.contentType !== READING && e.contentType !== ANKI)) continue
    if (!best || e.endTimeMillis > best.endTimeMillis) best = e
  }
  if (best && hideMinutes > 0 && now - best.endTimeMillis >= hideMinutes * 60000) return null
  return best
}
