import { useEffect, useRef, useState } from 'preact/hooks'
import { createPortal } from 'preact/compat'
import { GRADIENTS, LANGUAGE_COLORS, LANGUAGE_COLORS_BRIGHT, languageFill, luminance, withAlpha, deepened, isDarkFor } from '../model/theme.js'
import { getState } from '../store.js'
import { MOMENTUM_TIERS, momentumTier } from '../model/rules.js'
import { ICONS } from './icons.js'

/** [hideScrollbar]: still scrolls, just without the bar (profiles, which are mostly pictures). */
export function Dialog({ title, onClose, children, actions, wide, sheet = true, hideScrollbar = false }) {
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
      <div ref={ref} class={`dialog ${wide ? 'wide' : ''} ${hideScrollbar ? 'no-scrollbar' : ''}`} role="dialog" aria-label={typeof title === 'string' ? title : undefined}>
        {title && <h2>{title}</h2>}
        {children}
        {actions && <div class="dialog-actions">{actions}</div>}
      </div>
    </div>,
    document.body,
  )
}

/** First day of the week for this browser's locale (1 = Monday ... 7 = Sunday). */
function firstDayOfWeek() {
  try {
    const loc = new Intl.Locale(navigator.language)
    const info = loc.getWeekInfo?.() || loc.weekInfo
    if (info?.firstDay) return info.firstDay
  } catch { /* older browsers */ }
  return /^en-(US|CA)|^ja|^ko|^zh-TW|^he|^pt-BR/.test(navigator.language) ? 7 : 1
}

/** The app's own calendar for picking a past day (the phone's DayPickerDialog): the picked day
 *  filled, today ringed, future days greyed out, a dot under every day in `logged` (day-start
 *  millis), arrows or a sideways swipe to change month, and tapping a day picks it and closes. */
export function DayPicker({ selected, today, logged, onPick, onClose }) {
  const first = firstDayOfWeek() % 7 // as JS getDay(): 0 = Sunday
  const t = new Date(today)
  const thisMonth = t.getFullYear() * 12 + t.getMonth()
  const sel = new Date(selected)
  const [month, setMonth] = useState(Math.min(sel.getFullYear() * 12 + sel.getMonth(), thisMonth))
  const y = Math.floor(month / 12), m = month % 12
  const canForward = month < thisMonth
  const lead = (new Date(y, m, 1).getDay() - first + 7) % 7
  const length = new Date(y, m + 1, 0).getDate()
  const names = [...Array(7)].map((_, i) => new Date(2024, 0, 7 + first + i).toLocaleDateString(undefined, { weekday: 'narrow' }))
  const title = new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const swipe = useRef(null)
  useEffect(() => {
    // Capture, so Escape closes only the calendar and not the dialog underneath it.
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return createPortal(
    <div class="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="dialog day-picker" role="dialog" aria-label="Pick a day">
        <h2>Pick a day</h2>
        <div class="row dp-month">
          <span class="grow">{title}</span>
          <button class="icon-btn" title="Previous month" onClick={() => setMonth(month - 1)}><Icon name="keyboard_arrow_left" /></button>
          <button class="icon-btn" title="Next month" disabled={!canForward} onClick={() => setMonth(month + 1)}><Icon name="keyboard_arrow_right" /></button>
        </div>
        <div class="dp-grid dp-names">{names.map((n, i) => <span key={i}>{n}</span>)}</div>
        <div class="dp-grid"
          onPointerDown={(e) => { swipe.current = e.clientX }}
          onPointerUp={(e) => {
            const dx = swipe.current == null ? 0 : e.clientX - swipe.current
            swipe.current = null
            if (dx > 56) setMonth(month - 1)
            else if (dx < -56 && canForward) setMonth(month + 1)
          }}>
          {[...Array(42)].map((_, i) => {
            const d = i - lead + 1
            if (d < 1 || d > length) return <span key={i} />
            const ms = new Date(y, m, d).getTime()
            const future = ms > today
            const cls = ['dp-day', ms === selected && 'on', ms === today && 'today', logged?.has(ms) && 'logged'].filter(Boolean).join(' ')
            return <button key={i} class={cls} disabled={future} onClick={() => onPick(ms)}>{d}</button>
          })}
        </div>
        <div class="dialog-actions" style="justify-content:space-between">
          <button class="btn text" onClick={() => onPick(today)}>Today</button>
          <button class="btn text" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

const drawableEmoji = new Map()
/** [emoji] as this browser can actually draw it. A joined emoji (🐻‍❄️ is 🐻 + an invisible joiner +
 *  ❄️) comes out as its separate pieces - "🐻❄️" - where the device's emoji font is older than the
 *  emoji itself; then just its first piece is shown, which reads far better than the pieces in a
 *  row. Told apart by width: drawn as one glyph it's about as wide as its first piece alone. */
export function displayEmoji(emoji) {
  const e = (emoji || '').trim()
  if (!e) return e
  let shown = drawableEmoji.get(e)
  if (shown != null) return shown
  shown = e
  const points = [...e]
  if (points.length > 1 && /‍/.test(e)) {
    try {
      const ctx = document.createElement('canvas').getContext('2d')
      ctx.font = '32px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", system-ui, sans-serif'
      const first = points[0] + (points[1] === '️' ? '️' : '')
      if (ctx.measureText(e).width > ctx.measureText(first).width * 1.4) shown = first
    } catch { /* no canvas - show it as it is */ }
  }
  drawableEmoji.set(e, shown)
  return shown
}

/** The first whole emoji (grapheme) in [text] - so joined emoji like 🐻‍❄️ or 🧑‍🚀 aren't cut in half. */
export function firstGrapheme(text) {
  const t = (text || '').trim()
  if (!t) return ''
  try { return new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(t)[Symbol.iterator]().next().value?.segment || '' } catch { return [...t].slice(0, 2).join('') }
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
      <button class="toast-close" title="Dismiss" aria-label="Dismiss" onClick={() => setT(null)}><Icon name="close" size={18} /></button>
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

/** One settings row, as on the phone: a tinted icon badge, a title with a hint, a trailing control
 *  (or a chevron when the whole row opens something). [icon] is an icon name or any node. */
export function SettingRow({ icon, title, hint, children, onClick }) {
  return (
    <div class={`setting ${onClick ? 'clickable' : ''}`} onClick={onClick}>
      {icon && <div class="badge-ico">{typeof icon === 'string' ? <Icon name={icon} size={22} /> : icon}</div>}
      <div class="grow">
        <div class="s-title">{title}</div>
        {hint && <div class="muted small">{hint}</div>}
      </div>
      {children ?? (onClick && <span class="chev"><Icon name="chevron_right" /></span>)}
    </div>
  )
}

/** Which collapsible blocks are open, by title - kept while the app is open, like the phone. */
const openBlocks = new Set()

/** The phone's SettingsBlock: a rounded tinted block with a primary-coloured heading. A
 *  [collapsible] one is instead a row of its own - its name over [summary] (what's inside), with
 *  a chevron - that opens its rows in place, in the usual tinted block just beneath. */
// [onOpen]: a section that's just a way into its own screen - its row goes straight there, no dropdown.
export function Block({ title, action, collapsible = false, summary, onOpen, icon, children }) {
  const [open, setOpen] = useState(() => openBlocks.has(title))
  if (!collapsible) {
    return (
      <div class="block">
        {title && <div class="block-title"><span>{title}</span>{action}</div>}
        {children}
      </div>
    )
  }
  const toggle = () => {
    if (open) openBlocks.delete(title); else openBlocks.add(title)
    setOpen(!open)
  }
  return (
    <div class="fold">
      <div class="fold-row" onClick={onOpen || toggle}>
        {icon && <div class="badge-ico" style="margin-right:6px">{typeof icon === 'string' ? <Icon name={icon} size={22} /> : icon}</div>}
        <div class="grow">
          <div class="fold-title">{title}</div>
          {summary && <div class="fold-summary">{summary}</div>}
        </div>
        {/* The row's own action (the "+") mustn't also open or close it. */}
        {action && <span onClick={(e) => e.stopPropagation()}>{action}</span>}
        {onOpen ? <span class="block-chev"><Icon name="chevron_right" /></span> : <span class={`block-chev${open ? ' open' : ''}`}><Icon name="expand_more" /></span>}
      </div>
      {open && !onOpen && <div class="block fold-body">{children}</div>}
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

/** The phone's LanguageFilterChip: a faint wash and outline of the language's colour, filled
 *  solid when selected. */
export function LanguageFilterChip({ profile, selected, onClick }) {
  const stops = gradientStopsOf(profile)
  const fill = stops ? `linear-gradient(90deg, ${stops.join(', ')})` : profile.colorHex
  const wash = stops ? `linear-gradient(90deg, ${stops.map((c) => withAlpha(c, 0.12)).join(', ')})` : withAlpha(profile.colorHex, 0.12)
  const ink = onLight() ? deepened(profile.colorHex, 0.42) : profile.colorHex
  return (
    <button class="lang-filter" onClick={onClick}
      style={selected
        ? { background: fill, color: luminance(profile.colorHex) > 0.45 ? '#16171C' : '#fff', borderColor: profile.colorHex }
        : { background: wash, color: ink, borderColor: profile.colorHex }}>
      {profile.name}
    </button>
  )
}
const gradientStopsOf = (p) => (p?.gradientColors ? p.gradientColors.split(',').map((x) => x.trim()).filter(Boolean) : null)

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

/** A Material icon by name (see icons.js), drawn in the current text colour. */
export function Icon({ name, size = 24, color = 'currentColor', style }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill={color} aria-hidden="true"
    style={{ flex: 'none', verticalAlign: '-0.18em', ...style }} dangerouslySetInnerHTML={{ __html: ICONS[name] || '' }} />
}

export const NavIcon = ({ name, size = 22 }) => <Icon name={name} size={size} />

// The phone's content-type glyphs (ContentTypeIcon.kt).
const TYPE_ICON = { PODCAST: 'headphones', READING: 'menu_book', ANKI: 'style', LISTENING: 'music_note' }

/** A content type's icon - headphones (listening), open book (reading), cards (Anki), note (music). */
export const TypeIcon = ({ type, size = 18, color, style }) => <Icon name={TYPE_ICON[type]} size={size} color={color || 'currentColor'} style={style} />

/** "<icon> Label" in one line. */
export function TypeLabel({ type, children, size = 16 }) {
  return <span class="row" style="gap:6px;display:inline-flex"><TypeIcon type={type} size={size} />{children}</span>
}

/** The leading mark of an entry row: its type icon in the language's colour (the phone's ICON
 *  label style). */
export function TypeBadge({ type, profile }) {
  return <TypeIcon type={type} size={18} color={profile?.colorHex || '#BFBFCC'} />
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

/** The Momentum ⚡ (the phone's GoldenBolt/MutedBolt): colour-corrected to gold with a soft gold
 *  glow when Momentum is lit, grey and faded below that. */
/** The ⚡, tinted to a Momentum tier's colour (`tier`: 'bronze' | 'silver' | 'gold' | 'diamond'),
 *  or grey when `muted`. `gold` is shorthand for tier 'gold'. */
export function Bolt({ gold = false, tier, muted = false, size }) {
  const style = { fontSize: size ? `${size}px` : undefined, lineHeight: 1 }
  const t = tier || (gold ? 'gold' : null)
  return <span class={`bolt ${t ? `tier-${t}` : ''} ${muted ? 'muted' : ''}`} style={style}>⚡</span>
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

/** The phone's StreakBadge: the current run (green, after a flame) and the best when it's higher. */
export function StreakBadge({ streak }) {
  const cur = streak.current > 0
  const rec = cur ? streak.current < streak.record : streak.record > 0
  if (!cur && !rec) return <div class="streak" style="visibility:hidden">0d</div>
  return (
    <div class="streak">
      {cur && <><span style="font-size:12px">🔥</span><span class="cur">{streak.current}d</span></>}
      {rec && <><span style={{ width: cur ? 6 : 0 }} /><Icon name="emoji_events" size={12} color="var(--on-surface-variant)" /><span class="rec">{streak.record}d</span></>}
    </div>
  )
}

/** The phone's GoldenStreakPill: today's progress toward 1 hour as a thin ring round the bolt
 *  (just the bolt once today is done), then the days - all in the tier's colour (bronze while
 *  it's still building). */
export function MomentumPill({ days, progress, onClick }) {
  const tier = momentumTier(days)
  const lit = !!tier
  const p = Math.max(0, Math.min(1, progress))
  const r = 12.75, c = 2 * Math.PI * r
  return (
    <button class={`momentum tier-${tier?.id || 'bronze'} ${lit ? 'lit' : ''}`} onClick={onClick} title={`Momentum · ${days} days`}>
      <span style="position:relative;width:28px;height:28px;display:grid;place-items:center">
        {p < 1 && (
          <svg width="28" height="28" style="position:absolute;inset:0;transform:rotate(-90deg)">
            <circle cx="14" cy="14" r={r} fill="none" stroke="color-mix(in srgb, var(--surface-variant) 60%, transparent)" stroke-width="2.5" />
            {p > 0 && <circle cx="14" cy="14" r={r} fill="none" stroke="var(--tier)" stroke-opacity={lit ? 0.75 : 0.52} stroke-width="2.5" stroke-linecap="round" stroke-dasharray={`${c * p} ${c}`} />}
          </svg>
        )}
        <Bolt tier={tier?.id} muted={!lit} size={12} />
      </span>
      <span class="days">{days}d</span>
    </button>
  )
}


/** MomentumTierTable (StreakBadge.kt): every tier - bolt, name, the days it takes and (with
 *  `showHolo`, the Zoo's egg rates) its holo chance - with `current` (the tier reached, if any)
 *  picked out in its own colour. `topTierFirst` lists Diamond at the top. */
export function MomentumTierTable({ current, topTierFirst = false, showHolo = true }) {
  return (
    <div class="tier-table">
      {(topTierFirst ? [...MOMENTUM_TIERS].reverse() : MOMENTUM_TIERS).map((t) => (
        <div key={t.id} class={`tier-row tier-${t.id} ${current?.id === t.id ? 'reached' : ''}`}>
          <Bolt tier={t.id} size={15} />
          <span class="name">{t.name}</span>
          <span class="muted small">{t.minDays}d</span>
          {showHolo && <><b class="small">{t.holoPercent}%</b><span class="holo-chip compact">✦ Holo</span></>}
        </div>
      ))}
    </div>
  )
}
