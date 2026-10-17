import { render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import './styles.css'
import { loadState, useStore, getState, flush, update } from './store.js'
import { applyTheme } from './model/theme.js'
import { sync, shouldReport, raceConfigured } from './model/race.js'
import { ensureBase, recordEarnedEggs } from './model/zoo.js'
import * as syncModule from './model/sync.js'
import { Home } from './ui/Home.jsx'
import { Entries } from './ui/Entries.jsx'
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
  const tab = tabs.some(([t]) => t === route.tab) ? route.tab : 'home'
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
        {tab === 'social' && <Social />}
        {tab === 'zoo' && <Zoo />}
        {tab === 'settings' && <Settings params={route.params} nav={nav} />}
      </main>
      <ToastHost />
    </div>
  )
}

/** Reports to races the way the phone does: shortly after tracking starts or stops, then every 10
 *  minutes while something is running, and on a slow timer otherwise. */
function startBackgroundWork() {
  let lastRunning = ''
  let lastSync = 0
  const tick = () => {
    const s = getState()
    const running = s.entries.filter((e) => e.endTimeMillis == null && e.languageProfileId != null && e.contentType !== 'LISTENING').map((e) => e.id).join(',')
    const now = Date.now()
    if (running !== lastRunning) {
      lastRunning = running
      setTimeout(() => shouldReport() && sync(), 3000)
      lastSync = now
    } else if (shouldReport() && now - lastSync > (running ? 10 : 30) * 60 * 1000) {
      lastSync = now
      sync()
    }
    if (s.zoo.base) recordEarnedEggs()
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

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
window.addEventListener('pagehide', () => flush())

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {})
}

