import { useEffect, useState } from 'preact/hooks'
import { useStore, useNow, update } from '../store.js'
import { createAccount, joinAccount, linkCode, listDevices, unlinkDevice, signOut, syncNow, syncStatus, onSyncStatus, DEFAULT_SYNC_URL } from '../model/sync.js'
import { agoText } from '../model/time.js'
import { Dialog, Confirm, SettingRow, Spinner, Icon, copyText, toast } from './common.jsx'

const WEB_APP_URL = 'https://muraveimedved.github.io/immersion-tracker-web/'

function useSyncStatus() {
  const [, setV] = useState(0)
  useEffect(() => onSyncStatus(() => setV((v) => v + 1)), [])
  return syncStatus
}

/**
 * Settings > Your devices - the phone's screen of the same name, with the same words, so the
 * steps read the same on both devices.
 *
 * Not in an account yet: "Enter a code" (the history is already on the Android app or another
 * browser - that device shows the code) or "Start here" (nothing anywhere yet - this browser
 * starts the account). In one: sync status, "Add a device" with numbered steps and the code, what's
 * signed in, the recovery key and signing out.
 */
export function AccountSection() {
  const s = useStore()
  const signed = !!s.sync.token
  const [justMade, setJustMade] = useState(false)
  return signed ? <SignedIn showCode={justMade} /> : <SignedOut onCreated={() => setJustMade(true)} />
}

function SignedOut({ onCreated }) {
  const s = useStore()
  const [url, setUrl] = useState(s.sync.url)
  const [code, setCode] = useState('')
  const [key, setKey] = useState('')
  const [useKey, setUseKey] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const needUrl = !DEFAULT_SYNC_URL && !url
  const saveUrl = () => { if (url !== s.sync.url) update((st) => { st.sync.url = url }) }
  const join = async () => {
    setBusy('join'); setError('')
    try {
      saveUrl()
      await joinAccount(useKey ? { key, url } : { code, url })
      toast('Linked - your history is here and stays in sync')
    } catch (err) { setError(err.message) }
    setBusy('')
  }
  const create = async () => {
    setBusy('create'); setError('')
    try {
      saveUrl()
      await createAccount(url)
      onCreated()
      toast('Your account is ready')
    } catch (err) { setError(err.message) }
    setBusy('')
  }
  const canJoin = !needUrl && (useKey ? key.trim().length >= 32 : code.trim().length >= 6)
  return (
    <div class="col" style="gap:12px">
      <p class="muted small" style="margin:4px 4px 0">Use your history on several devices - your Android phone, an iPhone, a laptop - and keep it in sync. Without this, everything stays in this browser only.</p>

      <div class="block devices-card">
        <div class="devices-head"><Icon name="smartphone" size={22} /><h3>Enter a code</h3></div>
        <p class="muted small" style="margin-top:-4px">Your history is on the Android app or another browser? Link this one to it.</p>
        {useKey ? (
          <>
            <p class="muted small">Paste your recovery key (on the Android app or another browser: Settings › Your devices › Recovery key).</p>
            <input class="input" placeholder="Recovery key" value={key} onInput={(e) => setKey(e.currentTarget.value)} />
          </>
        ) : (
          <ol class="steps">
            <li>On that device, open <b>Settings › Your devices</b>.</li>
            <li>On the Android app tap <b>Link the web app</b>. In another browser tap <b>Add a device</b>.</li>
            <li>Type the code it shows:
              <input class="input code-input" maxLength={8} placeholder="ABC123" value={code}
                onInput={(e) => setCode(e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && canJoin && join()} />
            </li>
          </ol>
        )}
        <div class="row">
          <button class="btn text small" style="padding:0" onClick={() => setUseKey(!useKey)}>{useKey ? 'Use a code instead' : 'Use a recovery key instead'}</button>
          <span class="spacer" />
          <button class="btn" disabled={!canJoin || !!busy} onClick={join}>{busy === 'join' ? <Spinner /> : 'Link'}</button>
        </div>
      </div>

      <div class="block devices-card">
        <div class="devices-head"><Icon name="cloud" size={22} /><h3>New here? Start here</h3></div>
        <p class="muted small">Saves everything in this browser to a new account. You can add your phone or other devices any time.</p>
        <button class="btn tonal" disabled={needUrl || !!busy} onClick={create}>{busy === 'create' ? <><Spinner /> Saving your history…</> : 'Start here'}</button>
      </div>

      <ServerField value={url} onChange={setUrl} />
      {error && <div class="err small" style="margin:0 4px">{error}</div>}
    </div>
  )
}

function SignedIn({ showCode }) {
  const s = useStore()
  const status = useSyncStatus()
  const now = useNow(30000)
  const [showKey, setShowKey] = useState(false)
  const [confirmOut, setConfirmOut] = useState(false)
  return (
    <div class="col" style="gap:12px">
      {showCode && <div class="banner-ok">Your account is ready. Now add your other devices with the code below.</div>}
      <div class="block">
        <SettingRow icon={status.busy ? <Spinner /> : s.sync.error ? <Icon name="info" size={22} /> : <Icon name="check_circle" size={22} />} title={status.busy ? 'Syncing…' : s.sync.error ? 'Sync problem' : 'Synced'}
          hint={s.sync.error || (s.sync.lastSync ? `Last synced ${agoText(s.sync.lastSync, now)}` : 'Not synced yet')}>
          <button class="btn tonal small" disabled={status.busy} onClick={() => syncNow()}>Sync now</button>
        </SettingRow>
      </div>
      <AddDevice autoStart={showCode} />
      <DeviceList />
      <div class="row" style="gap:8px">
        <button class="btn tonal grow" onClick={() => setShowKey(true)}>Recovery key</button>
        <button class="btn text danger grow" onClick={() => setConfirmOut(true)}>Sign out of this browser</button>
      </div>
      {showKey && <RecoveryKeyDialog token={s.sync.token} onClose={() => setShowKey(false)} />}
      {confirmOut && <Confirm title="Stop syncing this browser?" text="Your data stays in this browser, but stops syncing with your other devices. You can link it again later with a code or your recovery key."
        confirmLabel="Sign out" danger onConfirm={() => signOut().then(() => toast('Signed out'))} onClose={() => setConfirmOut(false)} />}
    </div>
  )
}

/** "Add a device": a code, with what to do with it on the other device. */
function AddDevice({ autoStart }) {
  const now = useNow(1000)
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const get = () => { setBusy(true); setError(''); linkCode().then(setRes, (e) => setError(e.message)).finally(() => setBusy(false)) }
  // The screen switches to signed-in as soon as the account exists - a moment before it's known
  // to be brand new - so this watches for that rather than only checking once.
  useEffect(() => { if (autoStart && !res && !busy) get() }, [autoStart])
  const left = res ? Math.max(0, res.expiresAt - now) : 0
  return (
    <div class="block devices-card">
      <div class="devices-head"><Icon name="smartphone" size={22} /><h3>Add a device</h3></div>
      {!res ? (
        <>
          <p class="muted small">Your Android phone, or this web app on another iPhone, iPad or computer.</p>
          <button class="btn" disabled={busy} onClick={get}>{busy ? <Spinner /> : 'Get a code'}</button>
        </>
      ) : (
        <ol class="steps">
          <li>On the other device, open the Android app - or the web app:
            <div class="row wrap" style="gap:8px;margin-top:6px">
              <b style="color:var(--primary)">{WEB_APP_URL.replace('https://', '').replace(/\/$/, '')}</b>
              <button class="btn text small" style="padding:0 6px" onClick={() => copyText(WEB_APP_URL, 'Link copied')}>Copy link</button>
            </div>
          </li>
          <li>Go to <b>Settings › Your devices</b> and use <b>Enter a code</b>.</li>
          <li>Type this code:
            {left > 0 ? (
              <div style="margin-top:6px">
                <span class="code-pill" style="display:inline-block;font-size:28px;padding:10px 18px">{res.code}</span>
                <div class="muted small" style="margin-top:6px">Expires in {Math.floor(left / 60000)}:{String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}</div>
              </div>
            ) : <div style="margin-top:6px"><button class="btn tonal small" onClick={get}>New code</button></div>}
          </li>
        </ol>
      )}
      {error && <div class="err small">{error}</div>}
    </div>
  )
}

function DeviceList() {
  const [list, setList] = useState(null)
  const [error, setError] = useState('')
  const load = () => listDevices().then((l) => { setList(l); setError('') }, (e) => setError(e.message))
  useEffect(() => { load() }, [])
  return (
    <div class="block devices-card">
      <div class="devices-head"><Icon name="list" size={22} /><h3>Signed in</h3></div>
      {error ? <div class="err small">{error}</div> : !list ? <Spinner /> : (
        <div class="list">
          {list.map((d) => (
            <div key={d.id} class="entry" style="cursor:default">
              <Icon name={/· app$/.test(d.name) ? 'smartphone' : 'cloud'} size={20} color="var(--on-surface-variant)" />
              <div class="grow">
                <b>{d.thisDevice ? 'This browser' : d.name.replace(/ · app$/, '')}</b>
                <div class="muted tiny">Last seen {agoText(d.lastSeen)}</div>
              </div>
              {!d.thisDevice && <button class="btn text danger small" onClick={() => unlinkDevice(d.id).then(load, (e) => setError(e.message))}>Sign out</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ServerField({ value, onChange }) {
  if (DEFAULT_SYNC_URL) return null
  return (
    <label class="field">Sync server link
      <input class="input" placeholder="https://script.google.com/macros/s/…/exec" value={value} onInput={(e) => onChange(e.currentTarget.value.trim())} />
      <span class="tiny">The web app URL of the sync script (Tracker APP/web/sync-backend/SETUP.md).</span>
    </label>
  )
}

function RecoveryKeyDialog({ token, onClose }) {
  return (
    <Dialog title="Recovery key" onClose={onClose} sheet={false} actions={<>
      <button class="btn tonal" onClick={() => copyText(token, 'Recovery key copied')}>Copy</button>
      <button class="btn" onClick={onClose}>Done</button>
    </>}>
      <p class="muted small" style="margin-top:0">If you lose every signed-in device (or clear this browser), this key gets your account back. Save it in a password manager. Anyone who has it can read and change your data.</p>
      <div class="input" style="word-break:break-all;font-family:ui-monospace,monospace;font-size:13px;height:auto">{token}</div>
    </Dialog>
  )
}
