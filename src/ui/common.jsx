import { useEffect, useRef, useState } from 'preact/hooks'
import { createPortal } from 'preact/compat'
import { GRADIENTS, LANGUAGE_COLORS, LANGUAGE_COLORS_BRIGHT, languageFill, luminance, withAlpha, deepened, isDarkFor } from '../model/theme.js'
import { typeIcon } from '../model/rules.js'
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

export function TypeBadge({ type, profile }) {
  const c = profile?.colorHex || '#888'
  return <div class="type-ico" style={{ background: withAlpha(c, 0.18), color: c }}>{typeIcon(type)}</div>
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
