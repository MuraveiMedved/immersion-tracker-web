// UI colour presets, computed exactly like the phone's Theme.kt: each preset shifts the neutral
// surfaces' HSV brightness, and the tinted ones re-hue surfaces and the accent.

export const PRESETS = [
  'OBSIDIAN', 'MIDNIGHT', 'SLATE', 'DUSK', 'FOG', 'AMOLED', 'MAROON', 'OXBLOOD', 'FOREST', 'OCEAN',
  'AMETHYST', 'SAKURA', 'ESPRESSO', 'SYNTHWAVE', 'PAPER', 'IVORY', 'PEARL', 'MINT',
]
export const presetLabel = (p) => (p === 'AMOLED' ? 'AMOLED' : p[0] + p.slice(1).toLowerCase())
export const isLightPreset = (p) => p === 'PAPER' || p === 'IVORY' || p === 'PEARL' || p === 'MINT'

const DELTA = {
  OBSIDIAN: -0.085, MIDNIGHT: -0.045, SLATE: 0, DUSK: 0.06, FOG: 0.11, AMOLED: -0.125, MAROON: 0, OXBLOOD: -0.05,
  FOREST: 0, OCEAN: 0, AMETHYST: 0, SAKURA: 0.02, ESPRESSO: 0, SYNTHWAVE: 0, PAPER: 0.035, IVORY: 0.03, PEARL: 0.03, MINT: 0.025,
}
const TINT = {
  AMOLED: { surfaceSat: 0 },
  MAROON: { surfaceHue: 350, surfaceSat: 1.1, accentHue: 352 },
  OXBLOOD: { surfaceHue: 356, surfaceSat: 1.3, accentHue: 0, lightSat: 0.09 },
  FOREST: { surfaceHue: 145, surfaceSat: 0.8, accentHue: 130 },
  OCEAN: { surfaceHue: 190, surfaceSat: 1.1, accentHue: 178 },
  AMETHYST: { surfaceHue: 272, accentHue: 285 },
  SAKURA: { surfaceHue: 325, surfaceSat: 0.8, accentHue: 335, lightSat: 0.08 },
  ESPRESSO: { surfaceHue: 25, surfaceSat: 0.7, accentHue: 32 },
  SYNTHWAVE: { surfaceHue: 265, surfaceSat: 1.3, accentHue: 315 },
  PAPER: { surfaceSat: 0.5 },
  IVORY: { surfaceHue: 42, surfaceSat: 1.4, accentHue: 28, lightSat: 0.1 },
  PEARL: { surfaceHue: 222, lightSat: 0.05 },
  MINT: { surfaceHue: 150, accentHue: 168, lightSat: 0.08 },
}

const DARK = {
  background: '#0F1220', surface: '#1A1D2E', surfaceVariant: '#242742', containerLowest: '#0B0D18', containerLow: '#14172A',
  container: '#191C30', containerHigh: '#212443', containerHighest: '#2A2D52', onSurface: '#F2F2F7', onSurfaceVariant: '#C7C9DA',
  outline: '#4A4D6B', outlineVariant: '#33364F', primary: '#6FA8C9', primaryContainer: '#1E3A4A', onPrimaryContainer: '#CDEAF7',
  secondary: '#8AB4C8', secondaryContainer: '#24384A', tertiary: '#EFC078', tertiaryContainer: '#4A3A1E', onPrimary: '#1A1B3A',
}
const LIGHT = {
  background: '#EDEAE6', surface: '#F6F4F1', surfaceVariant: '#E2DFDA', containerLowest: '#FBFAF8', containerLow: '#F3F1EE',
  container: '#EEEBE7', containerHigh: '#E8E5E0', containerHighest: '#E2DFDA', onSurface: '#1A1B3A', onSurfaceVariant: '#5B5D74',
  outline: '#B8B6C4', outlineVariant: '#D8D6E0', primary: '#2F6B8C', primaryContainer: '#D2E7F2', onPrimaryContainer: '#0B2430',
  secondary: '#457B9D', secondaryContainer: '#D3E8F2', tertiary: '#B4790E', tertiaryContainer: '#FFDFAD', onPrimary: '#FFFFFF',
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase()
}
function rgbToHsv([r, g, b]) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [h, max ? d / max : 0, max]
}
function hsvToRgb([h, s, v]) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c
  let rgb = [0, 0, 0]
  if (h < 60) rgb = [c, x, 0]
  else if (h < 120) rgb = [x, c, 0]
  else if (h < 180) rgb = [0, c, x]
  else if (h < 240) rgb = [0, x, c]
  else if (h < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return rgb.map((u) => (u + m) * 255)
}
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v))

function withBrightness(hex, delta) {
  if (!delta) return hex
  const hsv = rgbToHsv(hexToRgb(hex))
  hsv[2] = clamp(hsv[2] + delta)
  return rgbToHex(hsvToRgb(hsv))
}
function withTint(hex, hue, satScale = 1, minSat = 0) {
  if (hue == null && satScale === 1) return hex
  const hsv = rgbToHsv(hexToRgb(hex))
  if (hue != null) hsv[0] = hue
  hsv[1] = clamp(Math.max(hsv[1] * satScale, hue != null ? minSat : 0))
  return rgbToHex(hsvToRgb(hsv))
}

/** CSS custom properties for [preset] in dark or light mode. */
export function schemeFor(preset, dark) {
  const t = TINT[preset] || {}
  const base = dark ? DARK : LIGHT
  let d = DELTA[preset] || 0
  if (!dark && preset === 'AMOLED') d = 0
  const sat = t.surfaceSat ?? 1
  const n = (hex, delta = d) => withBrightness(withTint(hex, t.surfaceHue, sat, dark ? 0 : t.lightSat ?? 0.07), delta)
  const a = (hex) => withTint(hex, t.accentHue, 1)
  return {
    '--bg': n(base.background),
    '--surface': n(base.surface),
    '--surface-variant': n(base.surfaceVariant),
    '--c-lowest': n(base.containerLowest),
    '--c-low': n(base.containerLow),
    '--c': n(base.container),
    '--c-high': n(base.containerHigh),
    '--c-highest': n(base.containerHighest),
    '--on-surface': dark ? base.onSurface : withTint(base.onSurface, t.surfaceHue),
    '--on-surface-variant': dark ? n(base.onSurfaceVariant, 0) : withTint(base.onSurfaceVariant, t.surfaceHue),
    '--outline': n(base.outline, d * 0.5),
    '--outline-variant': n(base.outlineVariant, d * 0.5),
    '--primary': a(base.primary),
    '--on-primary': base.onPrimary,
    '--primary-container': a(base.primaryContainer),
    '--on-primary-container': a(base.onPrimaryContainer),
    '--secondary': a(base.secondary),
    '--secondary-container': a(base.secondaryContainer),
    '--tertiary': base.tertiary,
    '--tertiary-container': base.tertiaryContainer,
  }
}

export function isDarkFor(preset) {
  if (isLightPreset(preset)) return false
  return !window.matchMedia || window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function applyTheme(preset) {
  const dark = isDarkFor(preset)
  const vars = schemeFor(preset, dark)
  const root = document.documentElement
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
  root.dataset.theme = dark ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', vars['--bg'])
}

export const luminance = (hex) => {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    v /= 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** [hex] darkened to at most HSV value [maxV] - language colours as text on light cards. */
export function deepened(hex, maxV = 0.42) {
  const hsv = rgbToHsv(hexToRgb(hex))
  hsv[2] = Math.min(hsv[2], maxV)
  return rgbToHex(hsvToRgb(hsv))
}

export function mix(hexA, hexB, t) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB)
  return rgbToHex(a.map((v, i) => v + (b[i] - v) * t))
}

export const withAlpha = (hex, alpha) => {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r},${g},${b},${alpha})`
}

export const LANGUAGE_COLORS = ['#DB434F', '#EC8F51', '#E4B444', '#389466', '#2C9696', '#4370A3', '#8B77C5', '#D3699E']
export const LANGUAGE_COLORS_BRIGHT = ['#FA3F2E', '#FF8D0A', '#FFD400', '#29C25C', '#00C7AC', '#1476FF', '#9A5FDD', '#FF3388']
export const GRADIENTS = [
  ['#FF9500', '#FF00FF', '#00E5FF'], ['#FF0043', '#FF8A00', '#FFD500'], ['#00C9FF', '#7B2FF7', '#F72585'], ['#00F5A0', '#00D9F5'],
  ['#8E2DE2', '#FF6EC7'], ['#14B8A6', '#38EF7D'], ['#A8EDEA', '#C3B5FF', '#FFC7E5'], ['#CCFF00', '#00FF87', '#00D4FF'],
  ['#FF512F', '#DD2476'], ['#6A3DBF', '#D76D77', '#FFAF7B'], ['#0EA5E9', '#48C9B0'], ['#E5335C', '#8338EC'],
  ['#FFB88C', '#FF7EB3'], ['#38BDF8', '#818CF8'], ['#DCE35B', '#45B649'], ['#F6D365', '#FDA085'], ['#F093FB', '#F5576C'],
  ['#00E3AE', '#9BE15D'], ['#4568DC', '#F7B733'], ['#FF9A56', '#FF6B9D', '#6B5CE7'], ['#9D4EDD', '#1BCEDF'],
  ['#FF5ACD', '#FBDA61'], ['#00D2FF', '#FF4B6E'], ['#FF6CAB', '#7366FF'], ['#00F2FE', '#4FACFE'],
]

export const gradientStops = (profile) => (profile?.gradientColors ? profile.gradientColors.split(',').map((s) => s.trim()).filter(Boolean) : null)

/** A CSS background for a language: its gradient, or its flat colour. */
export function languageFill(profile, angle = 90) {
  const stops = gradientStops(profile)
  return stops && stops.length > 1 ? `linear-gradient(${angle}deg, ${stops.join(', ')})` : profile?.colorHex || '#888'
}

/** The phone's dimGradientColorsFor: a language colour taken down to a card background - its hue,
 *  scaled saturation, and very low value on dark themes (or very high, toward white, on light). */
export function dimColor(hex, satScale = 0.6, valScale = 0.18, towardWhite = false, minSat = 0.5) {
  const [h, s0, v0] = rgbToHsv(hexToRgb(hex))
  const v = towardWhite ? 1 - (1 - v0) * valScale : v0 * valScale
  let s
  if (s0 < 0.08) s = s0 * satScale
  else if (towardWhite) s = Math.max(s0 * satScale * 0.4, 0.1)
  else s = Math.max(s0 * satScale, minSat)
  return rgbToHex(hsvToRgb([h, Math.min(1, s), Math.max(0, Math.min(1, v))]))
}
