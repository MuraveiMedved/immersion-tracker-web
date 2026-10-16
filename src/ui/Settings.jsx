import { useEffect, useMemo, useState } from 'preact/hooks'
import { useStore, upsertProfile, deleteProfile, newProfile, setSetting, importEntries, replaceState, getState, PODCAST, READING, ANKI, LISTENING } from '../store.js'
import { PRESETS, presetLabel, schemeFor, isLightPreset, languageFill, LANGUAGE_COLORS } from '../model/theme.js'
import { parseToggl, parsePolyLogger, looksLikePolyLogger, guessMapping, toEntries, exportBackup, readJsonBackup, readPhoneBackup } from '../model/imports.js'
import { formatHm } from '../model/time.js'
import { Ring, RING_STYLES, RING_LABEL } from './Ring.jsx'
import { AccountSection } from './Account.jsx'
import { Dialog, Confirm, Switch, SettingRow, ColorPicker, LanguageChip, Spinner, toast } from './common.jsx'

const SCRIPTS = [
  ['CYRILLIC_RUSSIAN', 'Russian', 'Cyrillic script'], ['CYRILLIC_UKRAINIAN', 'Ukrainian', 'і, ї, є, ґ'], ['JAPANESE_KANA', 'Japanese', 'hiragana / katakana'],
  ['HAN_CHINESE', 'Chinese', 'Han characters, no kana'], ['SPANISH_MARKERS', 'Spanish', '¿, ¡, ñ'], ['KOREAN_HANGUL', 'Korean', 'Hangul characters'],
  ['THAI_SCRIPT', 'Thai', 'Thai script'], ['LATIN_ENGLISH', 'English', 'plain Latin, no accents'],
]

export function Settings({ params, nav }) {
  const s = useStore()
  const [editing, setEditing] = useState(null)
  const [importKind, setImportKind] = useState(null)
  const [phone, setPhone] = useState(null)
  const [restore, setRestore] = useState(null)
  const languages = s.profiles.filter((p) => !p.isAnki).sort((a, b) => a.sortOrder - b.sortOrder)

  useEffect(() => {
    if (params?.addLanguage) setEditing('new')
    else if (params?.language != null) setEditing(params.language)
  }, [params])

  const pickFile = (accept, multiple, fn) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.onchange = () => input.files.length && fn([...input.files])
    input.click()
  }

  return (
    <>
      <h1 style="font-size:26px;margin-bottom:16px">Settings</h1>

      <div class="section-title"><h2>Languages</h2><button class="btn tonal small" onClick={() => setEditing('new')}>＋ Add language</button></div>
      <div class="card" style="padding:6px 12px">
        {!languages.length && <div class="muted small" style="padding:10px 4px">No languages yet - tap + to add one.</div>}
        {languages.map((p, i) => (
          <SettingRow key={p.id} icon={<span class="dot" style={{ width: 22, height: 22, background: languageFill(p, 135) }} />} title={<span>{p.name}{p.isMain && <span class="muted small"> · main</span>}</span>}
            hint={[p.podcastGoalMinutes && `🎧 ${p.podcastGoalMinutes}m`, p.readingGoalMinutes && `📖 ${p.readingGoalMinutes}m`].filter(Boolean).join(' · ') || 'No daily goal'}
            onClick={() => setEditing(p.id)}>
            <div class="row" style="gap:0">
              <button class="icon-btn" title="Move up" disabled={i === 0} onClick={(e) => { e.stopPropagation(); swap(languages, i, i - 1) }}>↑</button>
              <button class="icon-btn" title="Move down" disabled={i === languages.length - 1} onClick={(e) => { e.stopPropagation(); swap(languages, i, i + 1) }}>↓</button>
            </div>
          </SettingRow>
        ))}
      </div>

      <AccountSection />

      <div class="section-title section"><h2>Tracking</h2></div>
      <div class="card" style="padding:6px 12px">
        <SettingRow icon="📁" title="Uncategorized logs" hint="Allow sessions with no language and collect them in an Uncategorized folder on Home.">
          <Switch checked={s.settings.logUncategorized} onChange={(v) => setSetting('logUncategorized', v)} />
        </SettingRow>
        <SettingRow icon="⏱" title="Entry threshold" hint={`Don't save entries shorter than ${s.settings.entryThresholdSeconds} seconds.`}>
          <Switch checked={s.settings.entryThresholdEnabled} onChange={(v) => setSetting('entryThresholdEnabled', v)} />
        </SettingRow>
        {s.settings.entryThresholdEnabled && (
          <div class="row" style="padding:0 4px 12px 58px">
            <span class="muted small grow">Minimum length</span>
            <button class="icon-btn filled" onClick={() => setSetting('entryThresholdSeconds', Math.max(5, s.settings.entryThresholdSeconds - 5))}>−</button>
            <b style="width:48px;text-align:center">{s.settings.entryThresholdSeconds}s</b>
            <button class="icon-btn filled" onClick={() => setSetting('entryThresholdSeconds', Math.min(600, s.settings.entryThresholdSeconds + 5))}>＋</button>
          </div>
        )}
        <SettingRow icon="🗂️" title="Show Anki on Home" hint="Today's Anki time as its own card. Anki is still tracked when this is off.">
          <Switch checked={s.settings.showAnkiOnHome} onChange={(v) => setSetting('showAnkiOnHome', v)} />
        </SettingRow>
        <div class="muted tiny" style="padding:8px 4px 10px">On the web, sessions are started and stopped by hand (or logged afterwards) - a browser can't see what other apps are playing, so automatic tracking stays on the Android app.</div>
      </div>

      <div class="section-title section"><h2>App</h2></div>
      <div class="card" style="padding:6px 12px">
        <SettingRow icon="🏁" title="Social tab" hint="Show races and friends as a tab.">
          <Switch checked={s.settings.showRaceTab} onChange={(v) => setSetting('showRaceTab', v)} />
        </SettingRow>
        <SettingRow icon="🦊" title="Zoo tab" hint="Collect animal cards with your immersion hours.">
          <Switch checked={s.settings.showZooTab} onChange={(v) => setSetting('showZooTab', v)} />
        </SettingRow>
      </div>

      <Appearance />

      <div class="section-title section"><h2>Import</h2></div>
      <div class="card" style="padding:6px 12px">
        <SettingRow icon="📱" title="From the Android app" hint="Pick “Immersion Tracker backup.zip” from your phone's backup folder (Settings › Backup on the phone).">
          <button class="btn tonal small" onClick={() => pickFile('.zip,application/zip', false, async ([f]) => {
            try { setPhone({ loading: true }); setPhone(await readPhoneBackup(f)) } catch (err) { setPhone(null); toast(err.message || 'Couldn\'t read that backup') }
          })}>Choose…</button>
        </SettingRow>
        <SettingRow icon="⏲" title="Import from Toggl Track" hint="Reports → Detailed → Export CSV (one year per file). Pick several at once.">
          <button class="btn tonal small" onClick={() => pickFile('.csv,text/csv', true, (files) => setImportKind({ kind: 'toggl', files }))}>Choose…</button>
        </SettingRow>
        <SettingRow icon="🗒" title="Import from PolyLogger" hint="The CSV PolyLogger exports (Activity, Language, Activity Type, Time, Date).">
          <button class="btn tonal small" onClick={() => pickFile('.csv,text/csv', true, (files) => setImportKind({ kind: 'polylogger', files }))}>Choose…</button>
        </SettingRow>
      </div>

      <div class="section-title section"><h2>Backup</h2></div>
      <div class="card" style="padding:6px 12px">
        <div class="muted small" style="padding:10px 4px">{s.sync.token ? 'Your data is also saved to your account. A downloaded file is an extra copy you keep yourself.' : 'Everything lives in this browser only. Download a backup now and then, or create an account above - clearing the browser\'s site data, or a private window, loses it otherwise.'}</div>
        <SettingRow icon="💾" title="Download a backup" hint={`${s.entries.length} entries, ${languages.length} languages, races, friends and Zoo`}>
          <button class="btn tonal small" onClick={exportBackup}>Download</button>
        </SettingRow>
        <SettingRow icon="♻️" title="Restore…" hint="Replaces everything here with a web backup file.">
          <button class="btn tonal small" onClick={() => pickFile('.json,application/json', false, async ([f]) => {
            try { setRestore(await readJsonBackup(f)) } catch (err) { toast(err.message) }
          })}>Choose…</button>
        </SettingRow>
      </div>

      <div class="section-title section"><h2>About</h2></div>
      <div class="card small muted">
        <p style="margin-top:0"><b style="color:var(--on-surface)">Immersion Tracker for the web.</b> Works in any modern browser and offline once opened.</p>
        <p><b style="color:var(--on-surface)">iPhone / iPad:</b> open this page in Safari → Share → <i>Add to Home Screen</i>. <b style="color:var(--on-surface)">Mac / PC:</b> in Chrome or Edge use the install icon in the address bar (Safari on Mac: File → Add to Dock).</p>
        <p style="margin-bottom:0">Races and friends use the same server as the phone app, so you can race and befriend Android users.</p>
      </div>

      {editing != null && <LanguageEdit id={editing} onClose={() => setEditing(null)} />}
      {importKind && <ImportDialog kind={importKind.kind} files={importKind.files} onClose={() => setImportKind(null)} />}
      {phone && <PhoneImportDialog data={phone} onClose={() => setPhone(null)} />}
      {restore && <Confirm title="Restore this backup?" text="Everything in this browser will be replaced with the backup." confirmLabel="Restore" danger onConfirm={() => { replaceState(restore); toast('Backup restored') }} onClose={() => setRestore(null)} />}
    </>
  )
}

function swap(list, a, b) {
  const pa = list[a], pb = list[b]
  const oa = pa.sortOrder, ob = pb.sortOrder === oa ? oa + 1 : pb.sortOrder
  upsertProfile({ ...pa, sortOrder: ob })
  upsertProfile({ ...pb, sortOrder: oa })
}

function LanguageEdit({ id, onClose }) {
  const s = useStore()
  const existing = id === 'new' ? null : s.profiles.find((p) => p.id === id)
  const used = new Set(s.profiles.map((p) => p.colorHex))
  const [p, setP] = useState(() => existing ? { ...existing } : { name: '', colorHex: LANGUAGE_COLORS.find((c) => !used.has(c)) || LANGUAGE_COLORS[0], gradientColors: null, scriptDetectors: [], keywords: [], podcastGoalMinutes: 30, readingGoalMinutes: 30, isMain: !s.profiles.some((x) => x.isMain && !x.isAnki) })
  const [kw, setKw] = useState('')
  const [del, setDel] = useState(false)
  const set = (k, v) => setP((x) => ({ ...x, [k]: v }))
  const save = () => {
    if (!p.name.trim()) return
    if (existing) upsertProfile({ ...p, name: p.name.trim() })
    else {
      const created = newProfile({ ...p, name: p.name.trim() })
      upsertProfile(created)
    }
    onClose()
  }
  if (id !== 'new' && !existing) return null
  return (
    <Dialog title={existing ? 'Edit language' : 'New language'} onClose={onClose} actions={<>
      {existing && <button class="btn text danger" onClick={() => setDel(true)}>Delete language</button>}
      <span class="spacer" />
      <button class="btn text" onClick={onClose}>Cancel</button>
      <button class="btn" disabled={!p.name.trim()} onClick={save}>Done</button>
    </>}>
      <div class="col" style="gap:16px">
        <label class="field">Name<input class="input" value={p.name} autoFocus={!existing} placeholder="e.g. Japanese, Spanish, Korean…" onInput={(e) => set('name', e.currentTarget.value)} /></label>
        <div class="col"><div style="font-weight:600">Color</div><ColorPicker colorHex={p.colorHex} gradientColors={p.gradientColors} onChange={(c, g) => setP((x) => ({ ...x, colorHex: c, gradientColors: g }))} /></div>
        <div class="col">
          <div style="font-weight:600">Daily goals</div>
          <div class="row">
            <label class="field grow">🎧 Listening (minutes)<input class="input" inputMode="numeric" value={p.podcastGoalMinutes} onInput={(e) => set('podcastGoalMinutes', Number(e.currentTarget.value.replace(/\D/g, '')) || 0)} /></label>
            <label class="field grow">📖 Reading (minutes)<input class="input" inputMode="numeric" value={p.readingGoalMinutes} onInput={(e) => set('readingGoalMinutes', Number(e.currentTarget.value.replace(/\D/g, '')) || 0)} /></label>
          </div>
          <div class="muted small">Set either to 0 to hide that ring.</div>
        </div>
        <SettingRow title="Main language" hint="Pre-selected by default whenever you start a manual entry."><Switch checked={!!p.isMain} onChange={(v) => set('isMain', v)} /></SettingRow>
        <details>
          <summary class="muted small clickable">Recognition rules (shared with the phone app)</summary>
          <div class="col" style="margin-top:10px">
            <div class="muted small">Used by the phone to auto-detect this language, and here to match imported projects. Kept when you import or restore.</div>
            <div class="chips">
              {SCRIPTS.map(([k, name, hint]) => (
                <button key={k} title={hint} class={`chip ${p.scriptDetectors.includes(k) ? 'on' : ''}`} onClick={() => set('scriptDetectors', p.scriptDetectors.includes(k) ? p.scriptDetectors.filter((x) => x !== k) : [...p.scriptDetectors, k])}>{name}</button>
              ))}
            </div>
            <div class="row">
              <input class="input grow" placeholder="Keyword, e.g. NHK, J-Pop" value={kw} onInput={(e) => setKw(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter' && kw.trim()) { set('keywords', [...p.keywords, kw.trim()]); setKw('') } }} />
              <button class="btn tonal" disabled={!kw.trim()} onClick={() => { set('keywords', [...p.keywords, kw.trim()]); setKw('') }}>Add</button>
            </div>
            <div class="chips">{p.keywords.map((k) => <button key={k} class="chip" onClick={() => set('keywords', p.keywords.filter((x) => x !== k))}>{k} ✕</button>)}</div>
          </div>
        </details>
      </div>
      {del && <Confirm title="Delete this language?" text={`"${p.name}" will be permanently deleted, along with its goals. Entries already logged under it stay in your history, but lose their language. This can't be undone.`}
        confirmLabel="Delete" danger onConfirm={() => { deleteProfile(existing.id); onClose() }} onClose={() => setDel(false)} />}
    </Dialog>
  )
}

function Appearance() {
  const s = useStore()
  const main = s.profiles.find((p) => p.isMain && !p.isAnki) || s.profiles.find((p) => !p.isAnki)
  const color = main?.colorHex || '#2A9D8F'
  const stops = main?.gradientColors ? main.gradientColors.split(',') : null
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
  const pick = (key, options) => (
    <div class="chips">{options.map(([v, l]) => <button key={v} class={`chip ${s.settings[key] === v ? 'on' : ''}`} onClick={() => setSetting(key, v)}>{l}</button>)}</div>
  )
  return (
    <>
      <div class="section-title section"><h2>Appearance</h2></div>
      <div class="card col" style="gap:16px">
        <div>
          <div style="font-weight:600;margin-bottom:4px">UI Color</div>
          <div class="muted small" style="margin-bottom:10px">Pick how dark or light the app itself looks - applies everywhere.</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:8px">
            {PRESETS.map((p) => {
              const v = schemeFor(p, isLightPreset(p) ? false : dark !== false)
              const on = s.settings.uiColorPreset === p
              return (
                <button key={p} onClick={() => setSetting('uiColorPreset', p)} style={{ background: v['--bg'], color: v['--on-surface'], border: `2px solid ${on ? v['--primary'] : v['--outline-variant']}`, borderRadius: 14, padding: '10px 8px', textAlign: 'left' }}>
                  <div style={{ height: 22, borderRadius: 7, background: v['--c-high'], marginBottom: 6, display: 'flex', alignItems: 'center', padding: '0 6px' }}><span class="dot" style={{ background: v['--primary'] }} /></div>
                  <div style="font-size:12px;font-weight:650">{presetLabel(p)}</div>
                </button>
              )
            })}
          </div>
        </div>
        <div>
          <div style="font-weight:600;margin-bottom:4px">Ring Style</div>
          <div class="muted small" style="margin-bottom:10px">How your goal rings look, both in progress and once complete.</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px">
            {RING_STYLES.map((r) => (
              <button key={r} onClick={() => setSetting('ringStyle', r)} class="col" style={{ alignItems: 'center', background: 'var(--c-high)', border: `2px solid ${s.settings.ringStyle === r ? 'var(--primary)' : 'transparent'}`, borderRadius: 14, padding: 8, gap: 4 }}>
                <div class="row" style="gap:2px"><Ring progress={0.62} color={color} stops={stops} ringStyle={r} size={44} /><Ring progress={1} color={color} stops={stops} ringStyle={r} size={44} /></div>
                <span class="small" style="font-weight:600">{RING_LABEL[r]}</span>
              </button>
            ))}
          </div>
        </div>
        <div><div style="font-weight:600;margin-bottom:8px">"Immersion Tracker" title style</div>{pick('titleStyleMode', [['DEFAULT', 'Default'], ['GRADIENT', 'Gradient'], ['CURRENT_LANGUAGE', 'Language color'], ['THEME_COLOR', 'Theme color']])}</div>
        <div><div style="font-weight:600;margin-bottom:8px">Goal card background</div>{pick('goalCardStyleMode', [['LANGUAGE_COLOR', 'Language color'], ['GREY_TINT', 'Grey tint']])}</div>
        <div><div style="font-weight:600;margin-bottom:8px">Entry language label</div>{pick('entryLabelStyle', [['ICON', 'Icons'], ['CHIP', 'Colored label'], ['DOT', 'Colored dot']])}</div>
      </div>
    </>
  )
}

const TYPE_OPTIONS = [[null, 'Skip'], [PODCAST, '🎧 Listening'], [READING, '📖 Reading'], [ANKI, '🗂️ Anki'], [LISTENING, '🎵 Music']]

function ImportDialog({ kind, files, onClose }) {
  const s = useStore()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [mapping, setMapping] = useState({})
  useEffect(() => {
    (async () => {
      try {
        const all = []
        for (const f of files) {
          const text = await f.text()
          all.push(...(kind === 'polylogger' || looksLikePolyLogger(text) ? parsePolyLogger(text) : parseToggl(text)))
        }
        if (!all.length) throw new Error('empty')
        const m = {}
        for (const r of all) if (!(r.project in m)) m[r.project] = guessMapping(r.project, getState().profiles)
        setMapping(m)
        setRows(all)
      } catch {
        setError(kind === 'polylogger'
          ? 'No PolyLogger sessions found. Pick the CSV PolyLogger exports (columns Activity, Language, Activity Type, Time (minutes), Date).'
          : 'No Toggl time entries found. In Toggl, export them from Reports → Detailed → Export CSV (one year per file).')
      }
    })()
  }, [])
  const projects = useMemo(() => {
    if (!rows) return []
    const by = new Map()
    for (const r of rows) {
      const p = by.get(r.project) || { name: r.project, count: 0, ms: 0 }
      p.count++
      p.ms += r.end - r.start
      by.set(r.project, p)
    }
    return [...by.values()].sort((a, b) => b.ms - a.ms)
  }, [rows])
  const languages = s.profiles.filter((p) => !p.isAnki)
  const anki = s.profiles.find((p) => p.isAnki)
  const entries = rows ? toEntries(rows, mapping) : []
  const run = () => {
    const added = importEntries(entries)
    toast(`Added ${added} entries. Anything imported before was skipped.`)
    onClose()
  }
  return (
    <Dialog wide title={kind === 'polylogger' ? 'Import from PolyLogger' : 'Import from Toggl Track'} onClose={onClose} actions={<>
      <button class="btn text" onClick={onClose}>Cancel</button>
      <button class="btn" disabled={!entries.length} onClick={run}>Import {entries.length} entries</button>
    </>}>
      {error ? <p class="err">{error}</p> : !rows ? <div class="row"><Spinner /> Reading files…</div> : (
        <div class="col" style="gap:12px">
          <p class="muted small" style="margin:0">{rows.length} entries in {projects.length} {kind === 'polylogger' ? 'groups' : 'projects'} from {files.length} file{files.length > 1 ? 's' : ''}. Check how each one should come in.{kind === 'polylogger' ? ' PolyLogger keeps no time of day, so each day\'s sessions are placed back to back from noon.' : ''}</p>
          {projects.map((p) => {
            const m = mapping[p.name] || { type: null, languageProfileId: null }
            const setM = (patch) => setMapping({ ...mapping, [p.name]: { ...m, ...patch } })
            return (
              <div key={p.name} class="card" style="padding:12px">
                <div class="row"><b class="grow ellipsis">{p.name || '(No project)'}</b><span class="muted small">{p.count} entries · {formatHm(p.ms)}</span></div>
                <div class="chips" style="margin-top:8px">
                  {TYPE_OPTIONS.map(([t, l]) => <button key={String(t)} class={`chip ${m.type === t ? 'on' : ''}`} onClick={() => setM({ type: t, languageProfileId: t === ANKI ? anki?.id ?? null : m.languageProfileId })}>{l}</button>)}
                </div>
                {m.type && m.type !== ANKI && (
                  <div class="chips" style="margin-top:8px">
                    {languages.map((l) => <button key={l.id} class={`chip ${m.languageProfileId === l.id ? 'on' : ''}`} onClick={() => setM({ languageProfileId: l.id })}><span class="dot" style={{ background: l.colorHex }} />{l.name}</button>)}
                    <button class={`chip ${m.languageProfileId == null ? 'on' : ''}`} onClick={() => setM({ languageProfileId: null })}>Uncategorized</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Dialog>
  )
}

function PhoneImportDialog({ data, onClose }) {
  const [keepIdentity, setKeepIdentity] = useState(false)
  if (data.loading) return <Dialog title="Reading backup…" onClose={onClose} sheet={false}><div class="row"><Spinner /> Opening the phone's database…</div></Dialog>
  const { summary } = data
  return (
    <Dialog title="Import from the Android app" onClose={onClose} actions={<>
      <button class="btn text" onClick={onClose}>Cancel</button>
      <button class="btn danger" onClick={() => { data.apply({ keepIdentity }); toast('Phone data imported'); onClose() }}>Replace and import</button>
    </>}>
      <div class="col" style="gap:12px">
        <p style="margin:0">This backup has <b>{summary.entries}</b> entries, <b>{summary.profiles}</b> languages and <b>{Math.max(0, summary.animals)}</b> animals.</p>
        <p class="muted small" style="margin:0">Everything currently in this browser (entries, languages, Zoo) is replaced by the phone's copy. Your settings here stay.</p>
        <SettingRow title={`Race as the same person${summary.raceName ? ` (${summary.raceName})` : ''}`}
          hint="Only if you're moving to the web for good. If the phone keeps racing too, leave this off - two devices reporting as one racer overwrite each other's totals.">
          <Switch checked={keepIdentity} onChange={setKeepIdentity} />
        </SettingRow>
      </div>
    </Dialog>
  )
}
