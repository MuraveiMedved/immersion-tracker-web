import { render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import './styles.css'
import { loadState, useStore, getState, flush, update, subscribe } from './store.js'
import { applyTheme } from './model/theme.js'
import { sync, syncIfStale, shouldReport, raceConfigured, runningForRace, raceStatus } from './model/race.js'
import { ensureBase, recordEarnedEggs, backfillHoloMomentum } from './model/zoo.js'
import * as syncModule from './model/sync.js'
import { Home, TabTitle } from './ui/Home.jsx'
import { Entries } from './ui/Entries.jsx'
import { Challenges } from './ui/Sprints.jsx'
import { Social } from './ui/Social.jsx'
import { Zoo } from './ui/Zoo.jsx'
import { Settings } from './ui/Settings.jsx'
import { ToastHost, NavIcon } from './ui/common.jsx'

// Same icons as the phone's bottom bar.
const TABS = [
  ['home', 'home', 'Home'],
  ['entries', 'list', 'Entries'],
  ['social', 'groups', 'Social'],
  ['zoo', 'pets', 'Zoo'],
  ['settings', 'settings', 'Settings'],
]

/** Like the phone's bar: a wash of whatever language is being tracked (listening, then music, then
 *  reading), over the plain surface. */
function navTint(s) {
  const order = ['PODCAST', 'LISTENING', 'READING']
  const running = order.map((t) => s.entries.find((e) => e.endTimeMillis == null && e.contentType === t)).find((e) => e && e.languageProfileId != null)
  const color = running && s.profiles.find((p) => p.id === running.languageProfileId)?.colorHex
  return color ? { '--nav-bg': `color-mix(in srgb, ${color} 22%, var(--surface))` } : undefined
}

function App() {
  const s = useStore()
  const [route, setRoute] = useState(() => ({ tab: location.hash.slice(1) || 'home', params: null }))
  const nav = (tab, params = null) => {
    setRoute({ tab, params })
    history.replaceState(null, '', '#' + tab)
    window.scrollTo(0, 0)
  }
  useEffect(() => applyTheme(s.settings.uiColorPreset), [s.settings.uiColorPreset])
  useEffect(() => {
    const onHash = () => setRoute({ tab: location.hash.slice(1) || 'home', params: null })
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    const on = () => applyTheme(getState().settings.uiColorPreset)
    mq?.addEventListener?.('change', on)
    return () => mq?.removeEventListener?.('change', on)
  }, [])
  const tabs = TABS.filter(([t]) => (t !== 'social' || s.settings.showRaceTab) && (t !== 'zoo' || s.settings.showZooTab))
  // Challenges is a page of its own, opened from Home - not in the nav bar.
  const tab = route.tab === 'challenges' || tabs.some(([t]) => t === route.tab) ? route.tab : 'home'
  return (
    <div class="shell">
      <nav class="nav" style={navTint(s)}>
        {tabs.map(([t, ico, label]) => (
          <button key={t} class={tab === t ? 'on' : ''} onClick={() => nav(t)} title={label} aria-label={label}><NavIcon name={ico} /></button>
        ))}
      </nav>
      <main class="page">
        {tab === 'home' && <Home nav={nav} />}
        {tab === 'entries' && <Entries params={route.params} />}
        {tab === 'challenges' && <Challenges nav={nav} />}
        {tab === 'social' && <Social />}
        {tab === 'zoo' && <Zoo />}
        {tab === 'settings' && <Settings params={route.params} nav={nav} />}
      </main>
      <ToastHost />
      <TabTitle />
    </div>
  )
}

/** Reports to races the way the phone does: shortly after tracking starts or stops, then every 10
 *  minutes while something is running, and on a slow timer otherwise. */
function startBackgroundWork() {
  let lastRunning = ''
  let lastSync = 0
  let reportTimer = null
  // Starting or stopping tracking is reported straight away (a beat later, so a quick switch from
  // one session to another goes up as one report), so your green tag shows for everyone at once.
  const runningKey = () => {
    const r = runningForRace(getState().entries)
    return r ? `${r.id}:${r.contentType}` : ''
  }
  // A start or stop that doesn't get through (offline for a moment) is tried again soon -
  // otherwise everyone keeps seeing the old green tag.
  const reportWithRetry = async (tries) => {
    if (!shouldReport()) return
    await sync()
    if (raceStatus.error && tries > 0) reportTimer = setTimeout(() => reportWithRetry(tries - 1), 30000)
  }
  const checkRunning = () => {
    const key = runningKey()
    if (key === lastRunning) return false
    lastRunning = key
    lastSync = Date.now()
    clearTimeout(reportTimer)
    reportTimer = setTimeout(() => reportWithRetry(4), 1500)
    return true
  }
  lastRunning = runningKey()
  subscribe(checkRunning)
  const tick = () => {
    const s = getState()
    const running = runningKey()
    const now = Date.now()
    if (checkRunning()) {
      // reported above
    } else if (shouldReport() && now - lastSync > (running ? 5 : 30) * 60 * 1000) {
      lastSync = now
      sync()
    }
    if (s.zoo.base) recordEarnedEggs()
    backfillHoloMomentum()
  }
  setInterval(tick, 20000)
  tick()
  if (raceConfigured()) sync()
}

// Dev only: lets the browser console inspect and seed data.
if (import.meta.env.DEV) window.__tracker = { getState, update, sync: syncModule }

loadState().then(() => {
  applyTheme(getState().settings.uiColorPreset)
  ensureBase()
  render(<App />, document.getElementById('app'))
  startBackgroundWork()
  syncModule.startAutoSync()
})

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush()
  else syncIfStale() // back in focus: start the race updating now, not only once Social is open
})
window.addEventListener('focus', () => syncIfStale())
syncIfStale()
window.addEventListener('pagehide', () => flush())

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {})
}

