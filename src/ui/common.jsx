import { useEffect, useRef, useState } from 'preact/hooks'
import { createPortal } from 'preact/compat'
import { GRADIENTS, LANGUAGE_COLORS, LANGUAGE_COLORS_BRIGHT, languageFill, luminance, withAlpha, deepened, isDarkFor } from '../model/theme.js'
import { getState } from '../store.js'

export function Dialog({ title, onClose, children, actions, wide, sheet = true }) {
  const ref = useRef(null)
  // autofocus only works on page load - focus the dialog's own field when it opens.
  useEffect(() => { ref.current?.querySelector('[autofocus]')?.focus() }, [])
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div class={`scrim ${sheet ? 'sheet' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={ref} class={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-label={typeof title === 'string' ? title : undefined}>
        {title && <h2>{title}</h2>}
        {children}
        {actions && <div class="dialog-actions">{actions}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function Confirm({ title, text, confirmLabel = 'OK', danger, onConfirm, onClose }) {
  return (
    <Dialog title={title} onClose={onClose} sheet={false} actions={<>
      <button class="btn text" onClick={onClose}>Cancel</button>
      <button class={`btn ${danger ? 'danger' : ''}`} onClick={() => { onConfirm(); onClose() }}>{confirmLabel}</button>
    </>}>
      {text && <p class="muted" style="margin:0">{text}</p>}
    </Dialog>
  )
}

let toastSetter = null
export function toast(message, action) {
  toastSetter?.({ message, action, at: Date.now() })
}
export function ToastHost() {
  const [t, setT] = useState(null)
  toastSetter = setT
  useEffect(() => {
    if (!t) return
    const timer = setTimeout(() => setT(null), t.action ? 6000 : 3200)
    return () => clearTimeout(timer)
  }, [t])
  if (!t) return null
  return (
    <div class="toast">
      <span>{t.message}</span>
      {t.action && <button class="btn text small" onClick={() => { t.action.run(); setT(null) }}>{t.action.label}</button>}
    </div>
  )
}

export function Switch({ checked, onChange }) {
  return (
    <label class="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span />
    </label>
  )
}

export function SettingRow({ icon, title, hint, children, onClick }) {
  return (
    <div class={`setting ${onClick ? 'clickable' : ''}`} onClick={onClick}>
      {icon && <div class="badge-ico">{icon}</div>}
      <div class="grow">
        <div style="font-weight:600">{title}</div>
        {hint && <div class="muted small">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

export function Seg({ options, value, onChange }) {
  return (
    <div class="seg">
      {options.map(([v, label]) => (
        <button key={v} class={value === v ? 'on' : ''} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  )
}

const onLight = () => !isDarkFor(getState().settings.uiColorPreset)

/** A language as a little coloured chip. */
export function LanguageChip({ profile, filled = true }) {
  if (!profile) return <span class="lang-chip" style="border:1px solid var(--outline);color:var(--on-surface-variant)">Uncategorized</span>
  const fill = languageFill(profile)
  const dark = luminance(profile.colorHex) > 0.45
  return filled
    ? <span class="lang-chip" style={{ background: fill, color: dark ? '#111' : '#fff' }}>{profile.name}</span>
    : <span class="lang-chip" style={{ border: `1px solid ${profile.colorHex}`, color: onLight() ? deepened(profile.colorHex, 0.5) : profile.colorHex }}>{profile.name}</span>
}

export function LanguageDot({ profile, size = 10 }) {
  return <span class="dot" style={{ width: size, height: size, background: profile ? languageFill(profile, 135) : 'var(--outline)' }} />
}

/** How an entry's language is labelled, by the "Entry language label" setting. */
export function EntryLabel({ profile, type }) {
  const style = getState().settings.entryLabelStyle
  if (style === 'DOT') return <span class="row" style="gap:6px"><LanguageDot profile={profile} /><span class="muted small">{profile?.name || 'Uncategorized'}</span></span>
  if (style === 'CHIP' || !profile) return <LanguageChip profile={profile} />
  return <span class="small" style={{ color: onLight() ? deepened(profile.colorHex, 0.5) : profile.colorHex, fontWeight: 650 }}>{profile.name}</span>
}

// The phone's own glyphs (Material icons: Headphones, MenuBook, Style, MusicNote - see the app's
// ContentTypeIcon.kt), drawn here as SVG so both apps look the same.
const TYPE_PATHS = {
  PODCAST: ['M12 3a9 9 0 0 0-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1c0-3.87 3.13-7 7-7s7 3.13 7 7v1h-4v8h4c1.1 0 2-.9 2-2v-7a9 9 0 0 0-9-9z'],
  READING: [
    'M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z',
    'M17.5 10.5c.88 0 1.73.09 2.5.26V9.24c-.79-.15-1.64-.24-2.5-.24-1.7 0-3.24.29-4.5.83v1.66c1.13-.64 2.7-.99 4.5-.99zM13 12.49v1.66c1.13-.64 2.7-.99 4.5-.99.88 0 1.73.09 2.5.26V11.9c-.79-.15-1.64-.24-2.5-.24-1.7 0-3.24.3-4.5.83zm4.5 1.84c-1.7 0-3.24.29-4.5.83v1.66c1.13-.64 2.7-.99 4.5-.99.88 0 1.73.09 2.5.26v-1.52c-.79-.16-1.64-.24-2.5-.24z',
  ],
  ANKI: ['m2.53 19.65 1.34.56v-9.03l-2.43 5.86c-.41 1.02.08 2.19 1.09 2.61zm19.5-3.7L17.07 3.98a2.013 2.013 0 0 0-1.81-1.23c-.26 0-.53.04-.79.15L7.1 5.95a1.999 1.999 0 0 0-1.08 2.6l4.96 11.97a1.998 1.998 0 0 0 2.6 1.08l7.36-3.05a1.994 1.994 0 0 0 1.09-2.6zM7.88 8.75c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-2 11c0 1.1.9 2 2 2h1.45l-3.45-8.34v6.34z'],
  LISTENING: ['M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z'],
}

/** A content type's icon - headphones (listening), open book (reading), cards (Anki), note (music). */
export function TypeIcon({ type, size = 18, color = 'currentColor', style }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={color} aria-hidden="true" style={{ flex: 'none', verticalAlign: '-0.18em', ...style }}>
      {(TYPE_PATHS[type] || []).map((d) => <path key={d.slice(0, 12)} d={d} />)}
    </svg>
  )
}

/** "<icon> Label" in one line. */
export function TypeLabel({ type, children, size = 16 }) {
  return <span class="row" style="gap:6px;display:inline-flex"><TypeIcon type={type} size={size} />{children}</span>
}

export function TypeBadge({ type, profile }) {
  const c = profile?.colorHex || '#888'
  return <div class="type-ico" style={{ background: withAlpha(c, 0.18), color: c }}><TypeIcon type={type} size={20} /></div>
}

/** Solid colours (muted + vivid rows) and gradients. */
export function ColorPicker({ colorHex, gradientColors, onChange }) {
  const current = gradientColors || colorHex
  return (
    <div class="col" style="gap:12px">
      <div class="small muted">Solids</div>
      <div class="swatches">
        {[...LANGUAGE_COLORS, ...LANGUAGE_COLORS_BRIGHT].map((c) => (
          <button key={c} class={`swatch ${!gradientColors && colorHex === c ? 'on' : ''}`} style={{ background: c }} onClick={() => onChange(c, null)} aria-label={c} />
        ))}
        <label class="swatch" style="background:conic-gradient(red,yellow,lime,cyan,blue,magenta,red);cursor:pointer" title="Any colour">
          <input type="color" value={colorHex} style="opacity:0;width:0;height:0" onInput={(e) => onChange(e.currentTarget.value.toUpperCase(), null)} />
        </label>
      </div>
      <div class="small muted">Gradients</div>
      <div class="swatches">
        {GRADIENTS.map((g) => {
          const v = g.join(',')
          return <button key={v} class={`swatch ${current === v ? 'on' : ''}`} style={{ background: `linear-gradient(135deg, ${g.join(', ')})` }} onClick={() => onChange(g[0], v)} />
        })}
      </div>
    </div>
  )
}

export function Flame({ gold = false, muted = false }) {
  return <span class={`flame ${muted ? 'muted' : ''}`} style={gold ? 'filter: sepia(1) saturate(3) hue-rotate(-10deg) brightness(1.1)' : ''}>🔥</span>
}

export function Spinner() { return <span class="spin" /> }

/** Hours + minutes inputs. */
export function DurationInput({ hours, minutes, onHours, onMinutes, autoFocus }) {
  return (
    <div class="row">
      <label class="field grow">Hours<input class="input" inputMode="numeric" value={hours} autoFocus={autoFocus} onInput={(e) => onHours(e.currentTarget.value.replace(/\D/g, '').slice(0, 3))} placeholder="0" /></label>
      <label class="field grow">Minutes<input class="input" inputMode="numeric" value={minutes} onInput={(e) => onMinutes(e.currentTarget.value.replace(/\D/g, '').slice(0, 4))} placeholder="0" /></label>
    </div>
  )
}
export const hmToMillis = (h, m) => ((Number(h) || 0) * 60 + (Number(m) || 0)) * 60000

export function copyText(text, done = 'Copied') {
  navigator.clipboard?.writeText(text).then(() => toast(done), () => toast('Couldn\'t copy'))
}

export async function share(text, title) {
  if (navigator.share) {
    try { await navigator.share({ text, title }); return } catch { /* cancelled */ }
  }
  copyText(text)
}
