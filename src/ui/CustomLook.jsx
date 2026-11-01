import { useEffect, useRef, useState } from 'preact/hooks'
import { useStore, getState, setSetting, uuid, readExtra, writeExtra } from '../store.js'
import { schemeFor, customScheme, customPreset, isDarkFor } from '../model/theme.js'
import { Dialog, Seg, Icon, toast } from './common.jsx'

// The image is kept apart from the rest of the saved state: it's big, and this device's own.
const BACKGROUND_KEY = 'app-background'
const MAX_SIDE = 1920
const FITS = [['FILL', 'Fill'], ['FIT', 'Fit'], ['STRETCH', 'Stretch'], ['CENTER', 'Center'], ['TILE', 'Tile']]
const FIT_STYLE = {
  FILL: { backgroundSize: 'cover' },
  FIT: { backgroundSize: 'contain' },
  STRETCH: { backgroundSize: '100% 100%' },
  CENTER: { backgroundSize: 'auto' },
  TILE: { backgroundSize: 'auto', backgroundRepeat: 'repeat', backgroundPosition: 'top left' },
}

/** The picture behind everything, with the page colour laid over it to keep text readable. */
export function AppBackground() {
  const { bgImage, bgFit, bgDim } = useStore().settings
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let live = true
    if (bgImage) readExtra(BACKGROUND_KEY).then((saved) => { if (live) setUrl(saved) })
    else setUrl(null)
    return () => { live = false }
  }, [bgImage])
  useEffect(() => {
    const root = document.documentElement
    if (url) root.dataset.bgimage = ''
    else delete root.dataset.bgimage
  }, [url])
  if (!url) return null
  return (
    <div class="app-bg" style={{ backgroundImage: `url(${url})`, ...FIT_STYLE[bgFit] }}>
      <div style={{ opacity: bgDim }} />
    </div>
  )
}

async function shrunk(file) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.85)
}

/** Appearance's background image: choose or remove one, how it's placed, how far it's dimmed. */
export function BackgroundImage() {
  const { bgImage, bgFit, bgDim } = useStore().settings
  const input = useRef(null)
  const choose = async (e) => {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    try {
      await writeExtra(BACKGROUND_KEY, await shrunk(file))
      setSetting('bgImage', Date.now())
    } catch {
      toast("Couldn't read that image")
    }
  }
  const remove = async () => {
    await writeExtra(BACKGROUND_KEY, null)
    setSetting('bgImage', 0)
  }
  return (
    <div class="bg-section">
      <div class="title-small">Background image</div>
      <div class="body-small muted">A picture of your own behind the app, on this device.</div>
      <input ref={input} type="file" accept="image/*" hidden onChange={choose} />
      <div class="row">
        <button class="btn outline" onClick={() => input.current.click()}>{bgImage ? 'Change image' : 'Choose image'}</button>
        {!!bgImage && <button class="btn outline" onClick={remove}>Remove</button>}
      </div>
      {!!bgImage && <>
        <div style="margin-top:12px"><Seg options={FITS} value={bgFit} onChange={(v) => setSetting('bgFit', v)} /></div>
        <label class="body-small muted" style="display:block;margin-top:12px">
          Dim, to keep text readable
          <input type="range" min="0" max="0.9" step="0.01" value={bgDim} onInput={(e) => setSetting('bgDim', Number(e.target.value))} />
        </label>
      </>}
    </div>
  )
}

function ThemeSwatch({ theme }) {
  const v = customScheme(theme)
  return (
    <span class="cos-swatch" style={{ background: v['--bg'] }}>
      <span style={{ background: v['--c-high'], border: `1px solid ${v['--outline-variant']}`, display: 'grid', placeItems: 'center' }}>
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: v['--primary'] }} />
      </span>
    </span>
  )
}

function saveTheme(theme) {
  const themes = getState().settings.customThemes
  setSetting('customThemesTouched', true)
  setSetting('customThemes', themes.some((t) => t.id === theme.id) ? themes.map((t) => (t.id === theme.id ? theme : t)) : [...themes, theme])
  setSetting('uiColorPreset', customPreset(theme))
}

function deleteTheme(theme) {
  const s = getState().settings
  setSetting('customThemesTouched', true)
  setSetting('customThemes', s.customThemes.filter((t) => t.id !== theme.id))
  if (s.uiColorPreset === customPreset(theme)) setSetting('uiColorPreset', 'SLATE')
}

function ThemeEditor({ start, onClose }) {
  const scheme = schemeFor(getState().settings.uiColorPreset, isDarkFor(getState().settings.uiColorPreset))
  const [name, setName] = useState(start?.name ?? '')
  const [page, setPage] = useState(start?.page ?? scheme['--bg'])
  const [accent, setAccent] = useState(start?.accent ?? scheme['--primary'])
  const [id] = useState(start?.id ?? uuid())
  const theme = { id, name: name.trim() || 'My theme', page: page.toUpperCase(), accent: accent.toUpperCase() }
  return (
    <Dialog normalLook title={start ? 'Edit theme' : 'New theme'} onClose={onClose} actions={<>
      {start && <button class="btn text" style="color:var(--error, #e5484d)" onClick={() => { deleteTheme(start); onClose() }}>Delete</button>}
      <button class="btn text" onClick={onClose}>Cancel</button>
      <button class="btn text" onClick={() => { saveTheme(theme); onClose() }}>Save</button>
    </>}>
      <input class="input" placeholder="Name" maxLength={30} value={name} onInput={(e) => setName(e.target.value)} />
      <div class="theme-colors">
        <ThemeSwatch theme={theme} />
        <label>Page<input type="color" value={page} onInput={(e) => setPage(e.target.value)} /></label>
        <label>Accent<input type="color" value={accent} onInput={(e) => setAccent(e.target.value)} /></label>
      </div>
      <p class="body-small muted">Everything else is worked out from these two, and text stays readable. A light page makes a light theme.</p>
    </Dialog>
  )
}

/** Your own themes as tiles, then the one that makes another. */
export function CustomThemeTiles() {
  const s = useStore()
  const [editing, setEditing] = useState(null) // null | 'new' | a theme
  return <>
    {s.settings.customThemes.map((t) => (
      <div key={t.id} class="cos-tile-wrap">
        <button class={`cos-tile ${s.settings.uiColorPreset === customPreset(t) ? 'on' : ''}`} onClick={() => setSetting('uiColorPreset', customPreset(t))}>
          <ThemeSwatch theme={t} />
          <span class="label-large">{t.name}</span>
        </button>
        <button class="cos-tile-edit" aria-label="Edit theme" title="Edit theme" onClick={() => setEditing(t)}><Icon name="edit" size={18} /></button>
      </div>
    ))}
    <button class="cos-tile cos-new" onClick={() => setEditing('new')}>
      <span class="cos-swatch" style="background:none"><Icon name="add" size={28} /></span>
      <span class="label-large">New theme</span>
    </button>
    {editing && <ThemeEditor start={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
  </>
}
