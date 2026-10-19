import { useEffect, useRef } from 'preact/hooks'
import { hexToRgb } from '../model/theme.js'
import { TypeIcon } from './common.jsx'

// A port of the phone's RingProgress.kt - every style's in-progress fill, its completed disc, the
// still-tracking animations and the one-off "goal reached" burst - drawn on a canvas. Sizes are in
// CSS px, which stand in for the phone's dp.

export const RING_STYLES = ['CLASSIC', 'GRADIENT', 'SEGMENTED', 'DOTTED', 'NEON', 'LIQUID', 'BUBBLES']
export const RING_LABEL = { CLASSIC: 'Classic', GRADIENT: 'Lazer', SEGMENTED: 'Ticks', DOTTED: 'Trail', NEON: 'Neon', LIQUID: 'Liquid', BUBBLES: 'Bubbles' }

const TAU = Math.PI * 2
const SHIMMER_STOP_COUNT = 48
const SHIMMER_BAND_HALF_WIDTH = 0.12
const LIGHT_TRACK_ALPHA = 0.28
const DARK_THEME_SHADOW_ALPHA = 0.3
const LIGHT_THEME_SHADOW_ALPHA = 0.14
// Room around the ring for its shadow, aura, growing ticks and the burst (the phone's 1.6x canvas).
const PAD = 0.3

const IN_PROGRESS_MS = { CLASSIC: 1300, GRADIENT: 1300, NEON: 1800, LIQUID: 2600, BUBBLES: 3500, SEGMENTED: 3800, DOTTED: 3800 }
const COMPLETED_MS = { GRADIENT: 9000, BUBBLES: 3800, SEGMENTED: 3800, DOTTED: 3800 }
const COMPLETED_MOTION_MILLIS = 2800
const GLOW_MS = 550

/* ---------------------------------------------------------------------------------------------- */
/* Colours: [r, g, b] 0..255 with a separate alpha, like Compose's Color.                          */

const WHITE = [255, 255, 255]
const BLACK = [0, 0, 0]
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v))
const lerp = (a, b, t) => a + (b - a) * t
const lerpC = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
const css = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${clamp(a)})`
const toC = (hex) => hexToRgb(hex || '#888888')

function sampleGradient(colors, f) {
  const scaled = clamp(f) * (colors.length - 1)
  const i = clamp(Math.floor(scaled), 0, colors.length - 2)
  return lerpC(colors[i], colors[i + 1], scaled - i)
}

function shiftHue(c, deg) {
  let [r, g, b] = c.map((v) => v / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  h = (((h + deg) % 360) + 360) % 360
  const s = max ? d / max : 0, v = max
  const cc = v * s, x = cc * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - cc
  const rgb = h < 60 ? [cc, x, 0] : h < 120 ? [x, cc, 0] : h < 180 ? [0, cc, x] : h < 240 ? [0, x, cc] : h < 300 ? [x, 0, cc] : [cc, 0, x]
  return rgb.map((u) => (u + m) * 255)
}

/* ---------------------------------------------------------------------------------------------- */
/* Drawing primitives                                                                             */

const rad = (deg) => (deg * Math.PI) / 180

/** A straight-line brush across the box [x, y, w] - how every style wears a gradient language. */
function linear(ctx, colors, x, y, w) {
  const g = ctx.createLinearGradient(x, y, x + w, y + w)
  colors.forEach((c, i) => g.addColorStop(colors.length === 1 ? 0 : i / (colors.length - 1), css(c)))
  return g
}

function strokeArc(ctx, cx, cy, r, startDeg, sweepDeg, width, style, { cap = 'round', alpha = 1 } = {}) {
  if (sweepDeg <= 0 || r <= 0 || width <= 0) return
  ctx.save()
  ctx.globalAlpha = clamp(alpha)
  ctx.beginPath()
  ctx.arc(cx, cy, r, rad(startDeg), rad(startDeg + Math.min(sweepDeg, 360)))
  ctx.lineWidth = width
  ctx.lineCap = cap
  ctx.strokeStyle = style
  ctx.stroke()
  ctx.restore()
}

function fillCircle(ctx, cx, cy, r, style, alpha = 1) {
  if (r <= 0) return
  ctx.save()
  ctx.globalAlpha = clamp(alpha)
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, TAU)
  ctx.fillStyle = style
  ctx.fill()
  ctx.restore()
}

function strokeCircle(ctx, cx, cy, r, width, style, alpha = 1) {
  strokeArc(ctx, cx, cy, r, 0, 360, width, style, { cap: 'butt', alpha })
}

function line(ctx, a, b, width, style) {
  ctx.beginPath()
  ctx.moveTo(a[0], a[1])
  ctx.lineTo(b[0], b[1])
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.strokeStyle = style
  ctx.stroke()
}

/** A sweep gradient starting at 12 o'clock, with a soft band centred on [target] (0..1). */
function shimmerBrush(ctx, cx, cy, target, colorAt) {
  if (!ctx.createConicGradient) return null
  const g = ctx.createConicGradient(-Math.PI / 2, cx, cy)
  for (let i = 0; i < SHIMMER_STOP_COUNT; i++) {
    const f = i / (SHIMMER_STOP_COUNT - 1)
    let d = Math.abs(f - target)
    if (d > 0.5) d = 1 - d
    g.addColorStop(f, colorAt(clamp(1 - d / SHIMMER_BAND_HALF_WIDTH)))
  }
  return g
}

/* ---------------------------------------------------------------------------------------------- */
/* The ring                                                                                       */

/**
 * A goal ring. [progress] 0..1+ (complete from 1), drawn in [color] (or along [stops] for a
 * gradient language) in one of the phone's eight [ringStyle]s, with the content-type icon
 * ([iconType], tinted [iconColor]; white once complete) in the middle. [active] plays the style's
 * still-tracking animation.
 */
export function Ring({ progress, color, stops, ringStyle = 'CLASSIC', size = 64, iconType, iconColor = '#fff', icon, active = false, light = false }) {
  const ref = useRef(null)
  const anim = useRef(null)
  const target = Math.max(0, Math.min(1, progress || 0))
  const complete = target >= 1
  const style = RING_STYLES.includes(ringStyle) ? ringStyle : 'CLASSIC'

  if (!anim.current) {
    anim.current = { shown: target, from: target, to: target, springStart: 0, glow: active ? 1 : 0, glowFrom: active ? 1 : 0, glowTo: active ? 1 : 0, glowStart: 0, wasComplete: complete, burstStart: 0, raf: 0, props: null }
  }
  const a = anim.current

  // Progress springs to its new value (medium-bouncy, like the phone); the glow eases in and out.
  if (a.to !== target) {
    a.from = a.shown
    a.to = target
    a.springStart = performance.now()
  }
  if (a.glowTo !== (active ? 1 : 0)) {
    a.glowFrom = a.glow
    a.glowTo = active ? 1 : 0
    a.glowStart = performance.now()
  }
  // Reaching the goal while on screen plays the burst once (not when it was already met).
  if (complete && !a.wasComplete) a.burstStart = performance.now()
  a.wasComplete = complete
  a.props = { color: toC(color), stops: stops && stops.length > 1 ? stops.map(toC) : null, style, size, light, complete }

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const pad = Math.round(size * PAD)
    canvas.width = Math.round((size + pad * 2) * dpr)
    canvas.height = Math.round((size + pad * 2) * dpr)
    const ctx = canvas.getContext('2d')
    let phaseStart = performance.now()

    const frame = () => {
      a.raf = 0
      const now = performance.now()
      const p = a.props

      // Spring (dampingRatio 0.5, stiffness 200 - Compose's MediumBouncy / StiffnessLow).
      let springing = false
      if (a.springStart) {
        const t = (now - a.springStart) / 1000
        const w = Math.sqrt(200), z = 0.5, wd = w * Math.sqrt(1 - z * z)
        a.shown = a.to + (a.from - a.to) * Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t))
        if (t > 1.4) { a.shown = a.to; a.springStart = 0 } else springing = true
      }
      // FastOutSlowIn-ish ease of the active glow.
      let glowing = false
      if (a.glowStart) {
        const t = clamp((now - a.glowStart) / GLOW_MS)
        const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
        a.glow = lerp(a.glowFrom, a.glowTo, e)
        if (t >= 1) a.glowStart = 0; else glowing = true
      }
      const windingDown = a.glowTo === 1 || a.glow > 0.01
      const loop = p.complete ? (COMPLETED_MS[p.style] || COMPLETED_MOTION_MILLIS) : IN_PROGRESS_MS[p.style]
      const phase = windingDown ? ((now - phaseStart) % loop) / loop : 0
      if (!windingDown) phaseStart = now
      const burstT = a.burstStart ? (now - a.burstStart) / 1000 : -1
      if (burstT > 1.4) a.burstStart = 0

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, size + pad * 2, size + pad * 2)
      ctx.setTransform(dpr, 0, 0, dpr, pad * dpr, pad * dpr)
      if (p.complete) drawCompleted(ctx, p, a.glow, phase, a.burstStart ? burstT : -1)
      else drawInProgress(ctx, p, Math.min(1, Math.max(0, a.shown)), a.glow, phase)

      if ((windingDown || springing || glowing || a.burstStart) && !document.hidden) a.raf = requestAnimationFrame(frame)
    }
    a.kick = () => { if (!a.raf) a.raf = requestAnimationFrame(frame) }
    frame()
    const onVisible = () => !document.hidden && a.kick()
    document.addEventListener('visibilitychange', onVisible)
    return () => { cancelAnimationFrame(a.raf); a.raf = 0; document.removeEventListener('visibilitychange', onVisible) }
  }, [size])

  // New props: draw again (and keep animating if needed).
  useEffect(() => { a.kick?.() })

  const pad = Math.round(size * PAD)
  const iconSize = Math.round(size * 0.4)
  const shownIcon = iconType
    ? <TypeIcon type={iconType} size={iconSize} color={complete ? '#fff' : iconColor} />
    : icon
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <canvas ref={ref} style={{ position: 'absolute', left: -pad, top: -pad, width: size + pad * 2, height: size + pad * 2, pointerEvents: 'none' }} />
      {shownIcon && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>{shownIcon}</div>}
    </div>
  )
}

/* ---------------------------------------------------------------------------------------------- */
/* In progress                                                                                    */

function drawInProgress(ctx, p, progress, g, phase) {
  const S = p.size
  const sw = (p.style === 'NEON' ? 9 : 6) * Math.min(1, S / 48)
  const d = S - sw
  const r = d / 2
  const c = S / 2
  const tl = sw / 2
  const { color, stops, light } = p
  const brush = stops ? linear(ctx, stops, tl, tl, d) : null
  const solid = (c2) => css(c2)
  const glowArc = (width, alpha, sweep = 360) => strokeArc(ctx, c, c, r, -90, sweep, width, brush || solid(color), { alpha })
  const sweep = progress * 360

  switch (p.style) {
    case 'CLASSIC': {
      glowArc(sw, light ? LIGHT_TRACK_ALPHA : 0.15)
      if (progress <= 0) return
      const gw = lerp(1, 1.2, g), ga = lerp(1, 1.9, g)
      glowArc(sw * 2.1 * gw, Math.min(1, 0.1 * ga), sweep)
      glowArc(sw * 1.5 * gw, Math.min(1, 0.22 * ga), sweep)
      if (stops) {
        strokeArc(ctx, c, c, r, -90, sweep, sw, brush)
        if (g > 0) {
          const sh = shimmerBrush(ctx, c, c, phase, (band) => css(WHITE, band * 0.6 * g))
          if (sh) strokeArc(ctx, c, c, r, -90, sweep, sw, sh)
        }
      } else {
        strokeArc(ctx, c, c, r, -90, sweep, sw, solid(color))
        if (g > 0) {
          const hi = lerpC(color, WHITE, 0.7)
          const sh = shimmerBrush(ctx, c, c, phase, (band) => css(lerpC(color, hi, band * g)))
          if (sh) strokeArc(ctx, c, c, r, -90, sweep, sw, sh)
        }
      }
      return
    }
    case 'GRADIENT': {
      glowArc(sw, light ? LIGHT_TRACK_ALPHA : 0.15)
      if (progress <= 0) return
      const gw = lerp(1, 1.2, g), ga = lerp(1, 1.9, g)
      glowArc(sw * 1.8 * gw, Math.min(1, 0.12 * ga), sweep)
      const fill = brush || linear(ctx, [shiftHue(color, -35), color, shiftHue(color, 35)], tl, tl, d)
      strokeArc(ctx, c, c, r, -90, sweep, sw, fill)
      if (g > 0) {
        const sh = shimmerBrush(ctx, c, c, phase, (band) => css(WHITE, band * 0.55 * g))
        if (sh) strokeArc(ctx, c, c, r, -90, sweep, sw, sh)
      }
      return
    }
    case 'SEGMENTED': {
      const n = 28, gap = 4, seg = 360 / n - gap
      const filled = progress * n
      const inner = r - sw / 2
      for (let i = 0; i < n; i++) {
        const start = -90 + i * (360 / n)
        const base = stops ? sampleGradient(stops, i / (n - 1)) : color
        const fillF = clamp(filled - i)
        const ang = (i / n) * TAU
        const level = fillF > 0 ? clamp(0.5 + 0.3 * Math.sin(phase * TAU * 2 - ang * 4) + 0.2 * Math.sin(phase * TAU * 3 - ang * 8) + 0.15 * Math.sin(phase * TAU - ang * 2)) : 0
        const rest = fillF > 0 ? sw : sw * 0.7
        const width = rest * (1 + g * level * 1.1)
        const rr = inner + width / 2
        strokeArc(ctx, c, c, rr, start, seg, width, css(base, light ? 0.32 : 0.16), { cap: 'butt' })
        if (fillF > 0) strokeArc(ctx, c, c, rr, start, seg * fillF, width, css(lerpC(base, WHITE, 0.6 * level * level * g)), { cap: 'butt' })
      }
      return
    }
    case 'DOTTED': {
      const n = 40
      const baseDot = sw * 0.46
      for (let i = 0; i < n; i++) {
        const f = i / n
        const ang = rad(-90 + f * 360)
        const base = stops ? sampleGradient(stops, f) : color
        if (f <= progress) {
          const toward = progress > 0 ? clamp(f / progress) : 1
          const tail = 0.45 + 0.55 * toward * toward
          const s0 = Math.max(0, Math.sin(f * TAU * 3 - phase * TAU * 3))
          const swell = s0 * s0 * g
          const pr = r + sw * 0.3 * swell
          const al = 0.4 + 0.6 * tail
          fillCircle(ctx, c + Math.cos(ang) * pr, c + Math.sin(ang) * pr, baseDot * (0.55 + 0.45 * tail) * (1 + 0.35 * swell), css(lerpC(base, WHITE, 0.55 * swell), lerp(al, 1, 0.55 * swell)))
        } else {
          fillCircle(ctx, c + Math.cos(ang) * r, c + Math.sin(ang) * r, baseDot * 0.45, css(base, light ? 0.36 : 0.18))
        }
      }
      return
    }
    case 'NEON': {
      glowArc(sw * 0.8, light ? 0.24 : 0.12)
      if (progress <= 0) return
      const dip = Math.min(1, neonDip(phase) * 1.15) * g
      const boost = lerp(0.55, 1.25, g) * (1 - dip) * (light ? 1.6 : 1)
      glowArc(sw * 2.8, 0.08 * boost, sweep)
      glowArc(sw * 1.8, 0.18 * boost, sweep)
      strokeArc(ctx, c, c, r, -90, sweep, sw, brush || solid(color), { alpha: 1 - 0.48 * dip })
      strokeArc(ctx, c, c, r, -90, sweep, sw * 0.32, css(lerpC(color, WHITE, light ? 0.3 : 0.75), 1 - 0.75 * dip))
      return
    }
    case 'LIQUID':
    case 'BUBBLES': {
      const R = d / 2
      const left = tl, right = tl + d, bottom = tl + d
      fillCircle(ctx, c, c, R * 1.15, css(color, lerp(0.1, 0.22, g)))
      strokeCircle(ctx, c, c, R, R * 0.045, css(color, light ? 0.6 : 0.35))
      if (progress <= 0) return
      const amp = R * 0.06 * g
      const waveLen = d * 0.9
      const level = tl + d * (1 - progress)
      const step = d / 48
      const waveY = (x) => level + Math.sin(((x - left) / waveLen) * TAU + phase * TAU) * amp
      const surface = () => {
        ctx.beginPath()
        ctx.moveTo(left, waveY(left))
        for (let x = left; x < right;) { x = Math.min(right, x + step); ctx.lineTo(x, waveY(x)) }
      }
      ctx.save()
      ctx.beginPath()
      ctx.arc(c, c, R, 0, TAU)
      ctx.clip()
      surface()
      ctx.lineTo(right, bottom)
      ctx.lineTo(left, bottom)
      ctx.closePath()
      ctx.fillStyle = brush || solid(color)
      ctx.fill()
      if (p.style === 'BUBBLES' && g > 0) drawRisingBubbles(ctx, c, c, R, bottom, level, phase, g)
      surface()
      ctx.lineWidth = R * 0.05
      ctx.strokeStyle = css(lerpC(stops ? sampleGradient(stops, 0.5) : color, WHITE, 0.6))
      ctx.stroke()
      ctx.restore()
      return
    }
  }
}

const NEON_FLICKER_WINDOWS = [[0.08, 0.12, 0.8], [0.14, 0.17, 0.55], [0.52, 0.58, 0.7], [0.81, 0.83, 0.5]]
const neonDip = (local) => Math.max(...NEON_FLICKER_WINDOWS.map(([s, e, depth]) => (local >= s && local <= e ? depth * Math.sin(((local - s) / (e - s)) * Math.PI) : 0)))

const RISING_BUBBLES = [
  [-0.52, 0.07, 2, 0.05, 0.05], [-0.22, 0.11, 1, 0.55, 0.07], [0.08, 0.06, 2, 0.35, 0.04], [0.34, 0.09, 1, 0.15, 0.06],
  [0.56, 0.05, 2, 0.75, 0.04], [-0.38, 0.05, 2, 0.6, 0.03], [0.2, 0.08, 1, 0.85, 0.05],
]
const COMPLETED_BUBBLES = [
  [200, 0.66, 0.13, true], [235, 0.7, 0.06, false], [300, 0.62, 0.09, false], [335, 0.74, 0.1, true],
  [20, 0.66, 0.06, false], [60, 0.68, 0.11, false], [105, 0.72, 0.07, true], [145, 0.64, 0.1, false],
]
const AURORA_TRIANGLES = [
  [-0.55, 0.42, 1, 0.1, true], [0.35, 0.55, 1, 0.6, false], [-0.1, 0.3, 2, 0.35, true], [0.6, 0.26, 2, 0.85, true],
  [-0.4, 0.34, 2, 0.7, false], [0.12, 0.48, 1, 0.95, true], [-0.68, 0.22, 3, 0.5, false], [0.45, 0.2, 3, 0.2, true], [-0.25, 0.6, 1, 0.4, false],
]
const CLASSIC_WAVE_COUNT = 2
const classicWaveLocal = (phase, k) => (phase + k / CLASSIC_WAVE_COUNT) % 1
const classicBlink = (local) => (local > 0.94 ? ((local - 0.94) / 0.06) ** 2 : local < 0.18 ? (1 - local / 0.18) ** 2 : 0)

function drawRisingBubbles(ctx, cx, cy, radius, bottomY, topY, phase, strength) {
  if (strength <= 0 || bottomY <= topY) return
  RISING_BUBBLES.forEach(([bx, bs, speed, offset, sway], i) => {
    const p = (phase * speed + offset) % 1
    const climb = p * p * 0.35 + p * 0.65
    const y = bottomY - (bottomY - topY) * climb
    const x = cx + radius * bx + Math.sin(p * TAU * 1.5 + i) * radius * sway
    const r = radius * bs * (0.7 + 0.4 * p)
    const al = Math.min(1, p / 0.15) * Math.min(1, (1 - p) / 0.12) * strength
    if (al <= 0) return
    fillCircle(ctx, x, y, r, css(WHITE, 0.16 * al))
    strokeCircle(ctx, x, y, r, Math.max(1, r * 0.22), css(WHITE, 0.7 * al))
    fillCircle(ctx, x - r * 0.38, y - r * 0.38, r * 0.28, css(WHITE, 0.9 * al))
  })
}

/** A flat disc with a crisp, slightly darker rim. */
function premiumDisc(ctx, cx, cy, radius, color, brush) {
  fillCircle(ctx, cx, cy, radius, brush || css(color))
  strokeCircle(ctx, cx, cy, radius, radius * 0.028, css(lerpC(color, BLACK, 0.32), 0.5))
}

function drawCompleted(ctx, p, g, phase, burstT) {
  const S = p.size
  const full = S / 2
  const c = S / 2
  const { color, light, style } = p

  // The one-off burst: a scale pop, a flash toward white, two ripples and eight sparkle rays.
  let scale = 1, flash = 0
  if (burstT >= 0) {
    const ms = burstT * 1000
    if (ms < 220) { const t = ms / 220; scale = 1 + 0.32 * (1 - (1 - t) * (1 - t)) } else {
      const t = (ms - 220) / 1000, w = Math.sqrt(200), z = 0.5, wd = w * Math.sqrt(1 - z * z)
      scale = 1 + 0.32 * Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t))
    }
    flash = ms < 160 ? ms / 160 : clamp(1 - (ms - 160) / 550)
    const ringT = clamp(ms / 700), sparkT = clamp(ms / 650)
    const easeOut = (t) => 1 - (1 - t) * (1 - t)
    for (const stagger of [0, 0.28]) {
      const local = clamp((easeOut(ringT) - stagger) / (1 - stagger))
      if (local <= 0) continue
      strokeCircle(ctx, c, c, full * (1 + local * 1.1), 4 * (1 - local * 0.6), css(color, (1 - local) * 0.55))
    }
    const st = easeOut(sparkT)
    if (st < 1) {
      const inner = full * (1.05 + st * 0.25), len = full * (0.4 + st * 0.7)
      ctx.save()
      for (let i = 0; i < 8; i++) {
        const an = (TAU / 8) * i
        line(ctx, [c + Math.cos(an) * inner, c + Math.sin(an) * inner], [c + Math.cos(an) * (inner + len), c + Math.sin(an) * (inner + len)], 3, css(lerpC(color, WHITE, 0.6), 1 - st))
      }
      ctx.restore()
    }
  }

  // Soft contact shadow.
  const shadowScale = 1
  const sy = c + full * 0.1 * shadowScale, sr = full * 1.18 * shadowScale
  const shadow = ctx.createRadialGradient(c, sy, 0, c, sy, sr)
  const sa = light ? LIGHT_THEME_SHADOW_ALPHA : DARK_THEME_SHADOW_ALPHA
  shadow.addColorStop(0, `rgba(0,0,0,${sa})`)
  shadow.addColorStop(1, 'rgba(0,0,0,0)')
  fillCircle(ctx, c, sy, sr, shadow)
  if (style === 'CLASSIC' && g > 0) drawClassicAura(ctx, c, full, full * 1.36, p, phase, g)
  if (style === 'SEGMENTED' && g > 0) drawCompletedTicks(ctx, c, full, p, phase, g)

  ctx.save()
  if (scale !== 1) { ctx.translate(c, c); ctx.scale(scale, scale); ctx.translate(-c, -c) }
  const disc = lerpC(color, WHITE, flash * 0.9)
  const discStops = p.stops ? p.stops.map((s) => lerpC(s, WHITE, flash * 0.9)) : null
  drawCompletedBody(ctx, { ...p, disc, discStops }, c, full, g, phase)
  ctx.restore()
}

function drawCompletedBody(ctx, p, c, full, g, phase) {
  const { color, disc, discStops, stops, light } = p
  const discBrush = discStops ? linear(ctx, discStops, c - full, c - full, full * 2) : null
  const clipDisc = (radius = full) => { ctx.beginPath(); ctx.arc(c, c, radius, 0, TAU); ctx.clip() }

  switch (p.style) {
    case 'CLASSIC': {
      premiumDisc(ctx, c, c, full, disc, discBrush)
      if (g > 0) {
        let blink = 0
        for (let k = 0; k < CLASSIC_WAVE_COUNT; k++) blink = Math.max(blink, classicBlink(classicWaveLocal(phase, k)))
        fillCircle(ctx, c, c, full, css(WHITE, 0.28 * blink * g))
      }
      return
    }
    case 'GRADIENT': {
      const brush = discBrush || linear(ctx, [lerpC(disc, BLACK, 0.22), disc, lerpC(disc, WHITE, 0.22)], c - full, c - full, full * 2)
      premiumDisc(ctx, c, c, full, color, brush)
      const lights = stops ? stops.map((s) => lerpC(s, WHITE, 0.25)) : [lerpC(disc, WHITE, 0.45), lerpC(disc, WHITE, 0.25)]
      const darks = stops ? stops.map((s) => lerpC(s, BLACK, 0.35)) : [lerpC(disc, BLACK, 0.35), lerpC(disc, BLACK, 0.2)]
      ctx.save()
      clipDisc()
      drawAuroraFacets(ctx, c, full, lights, darks, 1 - 0.7 * g)
      drawAuroraTriangles(ctx, c, full, lights, darks, phase, g)
      ctx.restore()
      const ow = full * 0.075
      strokeCircle(ctx, c, c, full - ow / 2, ow, '#fff')
      return
    }
    case 'NEON': {
      const dr = full * 0.9
      premiumDisc(ctx, c, c, dr, color, discBrush)
      fillCircle(ctx, c, c, dr, 'rgba(0,0,0,.5)')
      const flick = (off) => neonDip((phase + off) % 1) * g
      const tube = (radius, width, dip) => {
        const boost = lerp(0.75, 1.1, g) * (1 - dip)
        const st = discBrush || css(color)
        strokeCircle(ctx, c, c, radius, width * 3.2, st, 0.18 * boost)
        strokeCircle(ctx, c, c, radius, width * 1.9, st, 0.35 * boost)
        strokeCircle(ctx, c, c, radius, width, st, 1 - 0.4 * dip)
        strokeCircle(ctx, c, c, radius, width * 0.36, css(lerpC(color, WHITE, 0.8), 1 - 0.65 * dip))
      }
      tube(full * 0.88, full * 0.075, flick(0))
      tube(full * 0.64, full * 0.045, flick(0.41))
      return
    }
    case 'SEGMENTED':
      premiumDisc(ctx, c, c, full * (1 - 0.24 * g), color, discBrush)
      return
    case 'DOTTED': {
      premiumDisc(ctx, c, c, full * 0.76, color, discBrush)
      const n = 40, path = full * 0.88, base = full * 0.07
      for (let i = 0; i < n; i++) {
        const f = i / n
        const s0 = Math.max(0, Math.sin(f * TAU * 3 - phase * TAU * 3))
        const swell = s0 * s0 * g
        const an = rad(-90 + f * 360)
        const pr = path + full * 0.03 * swell
        const bc = stops ? sampleGradient(stops, f) : color
        fillCircle(ctx, c + Math.cos(an) * pr, c + Math.sin(an) * pr, base * (0.85 + 0.4 * swell), css(lerpC(bc, WHITE, 0.6 * swell)))
      }
      return
    }
    case 'LIQUID': {
      premiumDisc(ctx, c, c, full, disc, discBrush)
      const slosh = Math.sin(phase * TAU) * 1.3 * g
      const bob = Math.sin(phase * TAU * 2) * full * 0.035 * g
      ctx.save()
      clipDisc()
      waveLayer(ctx, c, full, c + full * 0.02 + bob, full * 0.09, slosh, 0.16)
      waveLayer(ctx, c, full, c + full * 0.42 - bob, full * 0.07, Math.PI - Math.sin(phase * TAU + 0.9) * 1.3 * g, 0.16)
      ctx.restore()
      return
    }
    case 'BUBBLES': {
      premiumDisc(ctx, c, c, full, disc, discBrush)
      const rest = 1 - g
      for (const [deg, dist, br, hollow] of COMPLETED_BUBBLES) {
        const an = rad(deg)
        const x = c + Math.cos(an) * full * dist, y = c + Math.sin(an) * full * dist
        if (hollow) strokeCircle(ctx, x, y, full * br, full * 0.035, css(WHITE, 0.55 * rest))
        else fillCircle(ctx, x, y, full * br, css(WHITE, 0.4 * rest))
      }
      if (g > 0) {
        ctx.save()
        clipDisc()
        drawRisingBubbles(ctx, c, c, full, c + full, c - full, phase, g)
        ctx.restore()
      }
    }
  }
}

function waveLayer(ctx, c, radius, crestY, amplitude, phase, shade) {
  const left = c - radius, right = c + radius, step = radius / 24
  const waveY = (x) => crestY + Math.sin(((x - left) / (radius * 2)) * TAU * 2 + phase) * amplitude
  ctx.beginPath()
  ctx.moveTo(left, waveY(left))
  for (let x = left; x < right;) { x = Math.min(right, x + step); ctx.lineTo(x, waveY(x)) }
  ctx.lineTo(right, c + radius)
  ctx.lineTo(left, c + radius)
  ctx.closePath()
  ctx.fillStyle = `rgba(0,0,0,${shade})`
  ctx.fill()
}

function drawClassicAura(ctx, c, discR, maxR, p, phase, strength) {
  const wave = p.stops ? sampleGradient(p.stops, 0.5) : p.color
  for (let k = 0; k < CLASSIC_WAVE_COUNT; k++) {
    const local = classicWaveLocal(phase, k)
    const eased = 1 - (1 - local) * (1 - local)
    const peak = discR + (maxR - discR) * eased
    const spread = maxR - discR
    const innerFade = spread * (0.4 - 0.2 * local)
    const outerFade = spread * (0.18 + 0.12 * local)
    const alpha = (1 - local) * (1 - local) * 0.6 * strength
    const outer = Math.min(maxR, peak + outerFade)
    const grad = ctx.createRadialGradient(c, c, 0, c, c, outer)
    grad.addColorStop(0, css(wave, 0))
    grad.addColorStop(clamp((peak - innerFade) / outer), css(wave, 0))
    grad.addColorStop(clamp(peak / outer), css(wave, alpha))
    grad.addColorStop(1, css(wave, 0))
    fillCircle(ctx, c, c, outer, grad)
  }
}

function drawCompletedTicks(ctx, c, full, p, phase, strength) {
  const n = 28, gap = 3, seg = 360 / n - gap
  const inner = full * 0.82, rest = full * 0.16
  for (let i = 0; i < n; i++) {
    const base = p.stops ? sampleGradient(p.stops, i / (n - 1)) : p.color
    const ang = (i / n) * TAU
    const level = clamp(0.5 + 0.3 * Math.sin(phase * TAU * 2 - ang * 4) + 0.2 * Math.sin(phase * TAU * 3 - ang * 8) + 0.15 * Math.sin(phase * TAU - ang * 2))
    const width = rest * (1 + strength * level * 1.3)
    strokeArc(ctx, c, c, inner + width / 2, -90 + i * (360 / n), seg, width, css(lerpC(base, WHITE, 0.65 * level * level * strength), strength), { cap: 'butt' })
  }
}

function drawAuroraFacets(ctx, c, full, lights, darks, alpha) {
  if (alpha <= 0.001) return
  const side = full * 0.46, h = side * 0.866
  const rows = Math.floor((full * 2) / h) + 2, cols = Math.floor((full * 2) / side) + 3
  const mod = (a, n) => ((a % n) + n) % n
  const facet = (pts, shade, index) => {
    ctx.save()
    if (shade >= 0) { ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = css(lights[mod(index, lights.length)], 0.32 * shade * alpha) } else { ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = css(darks[mod(index, darks.length)], 0.3 * -shade * alpha) }
    ctx.beginPath()
    ctx.moveTo(...pts[0]); ctx.lineTo(...pts[1]); ctx.lineTo(...pts[2])
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }
  for (let r = -1; r < rows; r++) {
    const y0 = c - full + r * h
    const shift = r % 2 === 0 ? 0 : side / 2
    for (let col = -2; col < cols; col++) {
      const x = c - full + col * side - shift
      const up = Math.sin(r * 1.7 + col * 0.9) * 0.6 + Math.sin(r * 0.5 - col * 1.3) * 0.4
      const down = Math.sin(r * 1.7 + col * 0.9 + 1.9) * 0.6 + Math.sin(r * 0.5 - col * 1.3 + 0.8) * 0.4
      facet([[x, y0 + h], [x + side, y0 + h], [x + side / 2, y0]], up, r + col)
      facet([[x + side / 2, y0], [x + side * 1.5, y0], [x + side, y0 + h]], down, r + col + 1)
    }
  }
}

function drawAuroraTriangles(ctx, c, full, lights, darks, phase, alpha) {
  if (alpha <= 0.001) return
  AURORA_TRIANGLES.forEach(([tx, ts, speed, offset, isLight], i) => {
    const side = full * ts * 2, h = side * 0.866
    const travel = full * 2 + h * 2
    const pp = (phase * speed + offset) % 1
    const cy = c + full + h - pp * travel, cx = c + full * tx
    ctx.save()
    ctx.globalCompositeOperation = isLight ? 'screen' : 'multiply'
    ctx.fillStyle = isLight ? css(lights[i % lights.length], 0.6 * alpha) : css(darks[i % darks.length], 0.55 * alpha)
    ctx.beginPath()
    ctx.moveTo(cx, cy - (h * 2) / 3)
    ctx.lineTo(cx + side / 2, cy + h / 3)
    ctx.lineTo(cx - side / 2, cy + h / 3)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  })
}
