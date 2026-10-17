import { useEffect, useState } from 'preact/hooks'
import { useStore, useNow, update } from '../store.js'
import { createAccount, joinAccount, linkCode, listDevices, unlinkDevice, signOut, syncNow, syncStatus, onSyncStatus, DEFAULT_SYNC_URL } from '../model/sync.js'
import { agoText } from '../model/time.js'
import { Dialog, Confirm, SettingRow, Spinner, copyText, toast } from './common.jsx'

function useSyncStatus() {
  const [, setV] = useState(0)
  useEffect(() => onSyncStatus(() => setV((v) => v + 1)), [])
  return syncStatus
}

/** Settings > Account & sync. */
export function AccountSection() {
  const s = useStore()
  const status = useSyncStatus()
  const now = useNow(30000)
  const [dialog, setDialog] = useState(null)
  const [confirmOut, setConfirmOut] = useState(false)
  const signed = !!s.sync.token

  return (
    <>
      <div class="section-title section"><h2>Account &amp; sync</h2></div>
      <div class="card" style="padding:6px 12px">
        {!signed ? (
          <>
            <div class="muted small" style="padding:10px 4px">
              Save your history online and use it on several devices - an iPhone and a laptop, say. Without an account, everything stays in this browser only. (This is for the web app - the Android app doesn't use accounts; bring its history in with Import below.)
            </div>
            <SettingRow icon="☁️" title="Create an account" hint="Start here on your first device - no code needed. It saves what's on this device.">
              <button class="btn small" onClick={() => setDialog('create')}>Create</button>
            </SettingRow>
            <SettingRow icon="🔗" title="I already have one" hint="You made an account in the web app on another device - get a code there (Settings › Account & sync › Add another device), or use your recovery key.">
              <button class="btn tonal small" onClick={() => setDialog('join')}>Sign in</button>
            </SettingRow>
          </>
        ) : (
          <>
            <SettingRow icon={status.busy ? <Spinner /> : s.sync.error ? '⚠️' : '✅'} title={status.busy ? 'Syncing…' : s.sync.error ? 'Sync problem' : 'Synced'}
              hint={s.sync.error || (s.sync.lastSync ? `Last synced ${agoText(s.sync.lastSync, now)}` : 'Not synced yet')}>
              <button class="btn tonal small" disabled={status.busy} onClick={() => syncNow()}>Sync now</button>
            </SettingRow>
            <SettingRow icon="📲" title="Add another device" hint="Shows a code to type on the new device - good for 10 minutes.">
              <button class="btn tonal small" onClick={() => setDialog('code')}>Get code</button>
            </SettingRow>
            <SettingRow icon="🔑" title="Recovery key" hint="Signs in without another device. Keep it somewhere safe - anyone with it can see your data.">
              <button class="btn tonal small" onClick={() => setDialog('key')}>Show</button>
            </SettingRow>
            <SettingRow icon="💻" title="Devices" hint="Everything signed in to this account.">
              <button class="btn tonal small" onClick={() => setDialog('devices')}>View</button>
            </SettingRow>
            <SettingRow icon="🚪" title="Sign out of this device" hint="Your data stays here; it just stops syncing.">
              <button class="btn text danger small" onClick={() => setConfirmOut(true)}>Sign out</button>
            </SettingRow>
          </>
        )}
      </div>
      {dialog === 'create' && <SignInDialog mode="create" onClose={() => setDialog(null)} />}
      {dialog === 'join' && <SignInDialog mode="join" onClose={() => setDialog(null)} />}
      {dialog === 'code' && <LinkCodeDialog onClose={() => setDialog(null)} />}
      {dialog === 'key' && <RecoveryKeyDialog token={s.sync.token} onClose={() => setDialog(null)} />}
      {dialog === 'devices' && <DevicesDialog onClose={() => setDialog(null)} />}
      {confirmOut && <Confirm title="Sign out of this device?" text="Your data stays in this browser, but stops syncing. Sign in again with a code from another device or your recovery key."
        confirmLabel="Sign out" danger onConfirm={() => signOut().then(() => toast('Signed out'))} onClose={() => setConfirmOut(false)} />}
    </>
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

function SignInDialog({ mode, onClose }) {
  const s = useStore()
  const [url, setUrl] = useState(s.sync.url)
  const [code, setCode] = useState('')
  const [key, setKey] = useState('')
  const [useKey, setUseKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const needUrl = !DEFAULT_SYNC_URL && !url
  const go = async () => {
    setBusy(true)
    setError('')
    try {
      if (url !== s.sync.url) update((st) => { st.sync.url = url })
      if (mode === 'create') await createAccount(url)
      else await joinAccount(useKey ? { key, url } : { code, url })
      toast(mode === 'create' ? 'Account created - your data is syncing' : 'Signed in - your data is syncing')
      onClose()
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }
  const ready = !needUrl && (mode === 'create' || (useKey ? key.trim().length >= 32 : code.trim().length >= 6))
  return (
    <Dialog title={mode === 'create' ? 'Create an account' : 'Sign in'} onClose={busy ? undefined : onClose} actions={<>
      <button class="btn text" disabled={busy} onClick={onClose}>Cancel</button>
      <button class="btn" disabled={!ready || busy} onClick={go}>{busy ? <Spinner /> : mode === 'create' ? 'Create' : 'Sign in'}</button>
    </>}>
      <div class="col" style="gap:14px">
        {mode === 'create' ? (
          <p class="muted small" style="margin:0">Everything on this device - entries, languages, goals, Zoo, race name - is saved to your account. Afterwards, add your other devices with a code.</p>
        ) : (
          <>
            <p class="muted small" style="margin:0">Your account's data comes to this device, and anything already here is added to it.{s.race.name ? ' Your race name and settings become the account\'s.' : ''}</p>
            {useKey
              ? <label class="field">Recovery key<input class="input" value={key} autoFocus onInput={(e) => setKey(e.currentTarget.value)} /></label>
              : <label class="field">Code shown on your other device's web app (Settings › Account &amp; sync › Add another device). Not a code from the Android app.
                <input class="input" style="text-transform:uppercase;letter-spacing:3px;font-weight:700" value={code} autoFocus onInput={(e) => setCode(e.currentTarget.value.toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && ready && go()} />
              </label>}
            <button class="btn text small" style="align-self:flex-start;padding:0" onClick={() => setUseKey(!useKey)}>{useKey ? 'Use a code instead' : 'Use a recovery key instead'}</button>
          </>
        )}
        <ServerField value={url} onChange={setUrl} />
        {error && <div class="err small">{error}</div>}
      </div>
    </Dialog>
  )
}

function LinkCodeDialog({ onClose }) {
  const now = useNow(1000)
  const [res, setRes] = useState(null)
  const [error, setError] = useState('')
  const get = () => { setRes(null); setError(''); linkCode().then(setRes, (e) => setError(e.message)) }
  useEffect(get, [])
  const left = res ? Math.max(0, res.expiresAt - now) : 0
  return (
    <Dialog title="Add another device" onClose={onClose} sheet={false} actions={<>
      {res && left === 0 && <button class="btn tonal" onClick={get}>New code</button>}
      <button class="btn" onClick={onClose}>Done</button>
    </>}>
      <p class="muted small" style="margin-top:0">On the new device, open the web app (muraveimedved.github.io/immersion-tracker-web) → Settings → Account &amp; sync → I already have one, and type:</p>
      {error ? <div class="err">{error}</div> : !res ? <Spinner /> : (
        <div class="center">
          <div class="code-pill" style="display:inline-block;font-size:28px;padding:10px 18px">{res.code}</div>
          <div class="muted small" style="margin-top:8px">{left > 0 ? `Expires in ${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}` : 'Expired'}</div>
        </div>
      )}
    </Dialog>
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

function DevicesDialog({ onClose }) {
  const [list, setList] = useState(null)
  const [error, setError] = useState('')
  const load = () => listDevices().then(setList, (e) => setError(e.message))
  useEffect(() => { load() }, [])
  return (
    <Dialog title="Devices" onClose={onClose} sheet={false} actions={<button class="btn" onClick={onClose}>Done</button>}>
      {error ? <div class="err">{error}</div> : !list ? <Spinner /> : (
        <div class="list">
          {list.map((d) => (
            <div key={d.id} class="entry" style="cursor:default">
              <div class="grow">
                <b>{d.name}</b>{d.thisDevice && <span class="muted small"> · this device</span>}
                <div class="muted tiny">Last seen {agoText(d.lastSeen)}</div>
              </div>
              {!d.thisDevice && <button class="btn text danger small" onClick={() => unlinkDevice(d.id).then(load, (e) => setError(e.message))}>Sign out</button>}
            </div>
          ))}
        </div>
      )}
    </Dialog>
  )
}
