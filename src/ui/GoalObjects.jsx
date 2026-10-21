// The "object" goal styles - Moon and Flower - ported from the phone's GoalObjectProgress
// (MoonProgress.kt) and FlowerBody.kt, number for number. Drawn on a canvas; the content-type icon
// is drawn into it too (from its SVG path), so the Moon's icon can turn dark over the lit side.
//
// Shared behaviour (the phone's shell): progress eases in; a drop in progress (a new goal day, the
// Cosmetics preview restarting) fades the lit part out and back instead of running backwards; the
// goal glow fades in when full and grows a little past it; a flash and a small swell the moment it
// fills; and nothing moves unless the goal is being tracked ([active]) - idle, no frames are drawn.

import { useEffect, useRef } from 'preact/hooks'
import { hexToRgb } from '../model/theme.js'
import { ICONS } from './icons.js'

const TAU = Math.PI * 2
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v))
const lerp = (a, b, t) => a + (b - a) * t
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
const css = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${clamp(a)})`
const WHITE = [255, 255, 255]
const BLACK = [0, 0, 0]
const hex = (h) => hexToRgb(h || '#888888')

const MOON_TURN_SECONDS = 24
const FLOWER_SWAY_SECONDS = 9
export const OBJECT_STYLES = ['MOON', 'FLOWER']

const TYPE_ICON = { PODCAST: 'headphones', READING: 'menu_book', ANKI: 'style', LISTENING: 'music_note', GENERAL: 'all_inclusive' }
const iconPaths = {}
function iconPath(type) {
  const name = TYPE_ICON[type]
  if (!name) return null
  if (!iconPaths[name]) {
    const p = new Path2D()
    for (const m of (ICONS[name] || '').matchAll(/ d="([^"]+)"/g)) p.addPath(new Path2D(m[1]))
    iconPaths[name] = p
  }
  return iconPaths[name]
}

/** A small seeded random, so each colour's moon has its own surface. */
function seeded(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296 }
}

/* ---------------------------------------------------------------------------------------------- */
/* The component                                                                                  */

export function GoalObjectRing({ progress, color, stops, ringStyle, size = 64, iconType, icon, active = false, light = false }) {
  const ref = useRef(null)
  const st = useRef(null)
  const target = clamp(progress || 0)
  const full = target >= 1
  if (!st.current) {
    st.current = {
      phase: target, litFade: 1, fadingOut: false, turned: 0, breath: 0, active: active ? 1 : 0,
      glow: full ? 0.65 + 0.35 * clamp((progress || 0) - 1) : 0, flashStart: 0, wasFull: full,
      bornAt: performance.now(), raf: 0, props: null, craters: null, cratersFor: '',
    }
  }
  const s = st.current
  if (full && !s.wasFull) s.flashStart = performance.now()
  s.wasFull = full
  const base = hex(stops && stops.length > 1 ? stops[0] : color)
  const second = hex(stops && stops.length > 1 ? stops[stops.length - 1] : color)
  const key = stops && stops.length > 1 ? stops[0] : color
  if (s.cratersFor !== key) { s.craters = generateCraters(String(key)); s.cratersFor = key }
  s.props = { body: ringStyle, target, glowTarget: full ? 0.65 + 0.35 * clamp((progress || 0) - 1) : 0, activeTarget: active ? 1 : 0, base, second, light, size, icon: iconPath(iconType) }

  const pad = Math.round(size * 0.3)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const W = size + pad * 2
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(W * dpr)
    const ctx = canvas.getContext('2d')
    const off = document.createElement('canvas') // for the faded lit layer and the halo
    off.width = canvas.width; off.height = canvas.height
    let last = performance.now()

    const frame = () => {
      s.raf = 0
      const now = performance.now()
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const p = s.props
      s.active += (p.activeTarget - s.active) * (1 - Math.exp(-dt * 6))
      if (Math.abs(p.activeTarget - s.active) < 0.002) s.active = p.activeTarget
      s.glow += (p.glowTarget - s.glow) * (1 - Math.exp(-dt * 3))
      if (Math.abs(p.glowTarget - s.glow) < 0.002) s.glow = p.glowTarget
      const turnSeconds = p.body === 'FLOWER' ? FLOWER_SWAY_SECONDS : MOON_TURN_SECONDS
      s.turned += (dt * TAU / turnSeconds) * s.active
      s.breath = (s.breath + (dt / 3.2) * s.active) % 1
      if (now - s.bornAt < 800) { s.phase = p.target; s.litFade = 1; s.fadingOut = false } else {
        if (!s.fadingOut && p.target < s.phase - 0.05) s.fadingOut = true
        if (s.fadingOut) {
          s.litFade = Math.max(0, s.litFade - dt / 0.6)
          if (s.litFade === 0) { s.phase = p.target; s.fadingOut = false }
        } else {
          s.litFade = Math.min(1, s.litFade + dt / 0.4)
          s.phase += (p.target - s.phase) * (1 - Math.exp(-dt * 3.5))
          if (Math.abs(p.target - s.phase) < 0.0005) s.phase = p.target
        }
      }
      // The fill flash: up in 0.22 s, down over 0.9 s; the swell: out in 0.24 s, back by 0.8 s.
      let flash = 0, swell = 1
      if (s.flashStart) {
        const t = (now - s.flashStart) / 1000
        flash = t < 0.22 ? t / 0.22 : clamp(1 - (t - 0.22) / 0.9)
        swell = t < 0.24 ? 1 + 0.12 * (t / 0.24) : 1 + 0.12 * Math.exp(-(t - 0.24) * 6) * Math.cos((t - 0.24) * 14)
        if (t > 1.3) s.flashStart = 0
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.setTransform(dpr, 0, 0, dpr, pad * dpr, pad * dpr)
      const env = { ctx, off, dpr, pad, size: p.size, center: [p.size / 2, p.size / 2], radius: (p.size / 2) * 0.84 * swell, flash, s, p }
      drawGlow(env)
      if (p.body === 'FLOWER') drawFlower(env); else drawMoon(env)

      const moving = s.active > 0 || p.activeTarget > 0 || s.fadingOut || s.litFade < 1 || s.phase !== p.target || s.glow !== p.glowTarget || s.flashStart || now - s.bornAt < 800
      if (moving && !document.hidden) s.raf = requestAnimationFrame(frame)
    }
    s.kick = () => { if (!s.raf) { last = performance.now(); s.raf = requestAnimationFrame(frame) } }
    frame()
    const onVisible = () => !document.hidden && s.kick()
    document.addEventListener('visibilitychange', onVisible)
    return () => { cancelAnimationFrame(s.raf); s.raf = 0; document.removeEventListener('visibilitychange', onVisible) }
  }, [size])
  useEffect(() => { s.kick?.() })

  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <canvas ref={ref} style={{ position: 'absolute', left: -pad, top: -pad, width: size + pad * 2, height: size + pad * 2, pointerEvents: 'none' }} />
      {!iconType && icon && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>{icon}</div>}
    </div>
  )
}

/** The shared goal glow behind the object (strength halved at the user's request). */
function drawGlow({ ctx, center, radius, flash, s, p }) {
  const breathing = 0.5 + 0.5 * Math.sin(s.breath * TAU)
  const strength = s.glow * (0.85 + 0.15 * breathing * s.active) + s.active * 0.18 * breathing * s.phase + flash * 0.6
  if (strength <= 0.01) return
  const c = p.body === 'FLOWER' ? mix(p.base, WHITE, 0.4) : mix(p.base, WHITE, 0.35)
  const R = radius * 1.75
  const g = ctx.createRadialGradient(center[0], center[1], 0, center[0], center[1], R)
  const k = Math.min(1, strength)
  g.addColorStop(0, css(c, 0.28 * k)); g.addColorStop(0.55, css(c, 0.28 * k)); g.addColorStop(0.75, css(c, 0.09 * k)); g.addColorStop(1, css(c, 0))
  ctx.fillStyle = g
  ctx.beginPath(); ctx.arc(center[0], center[1], R, 0, TAU); ctx.fill()
}

/** Runs [draw] onto the offscreen canvas (same transform), then lays it over at [alpha]. */
function layered({ ctx, off, dpr, pad }, alpha, draw) {
  if (alpha <= 0.001) return
  if (alpha >= 0.999) { draw(ctx); return }
  const o = off.getContext('2d')
  o.setTransform(1, 0, 0, 1, 0, 0)
  o.clearRect(0, 0, off.width, off.height)
  o.setTransform(dpr, 0, 0, dpr, pad * dpr, pad * dpr)
  draw(o)
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = alpha
  ctx.drawImage(off, 0, 0)
  ctx.restore()
}

/** Clips to everything except [path]. */
function clipOutside(ctx, path) {
  const p = new Path2D()
  p.rect(-1e4, -1e4, 2e4, 2e4)
  p.addPath(path)
  ctx.clip(p, 'evenodd')
}

/* ---------------------------------------------------------------------------------------------- */
/* Moon                                                                                           */

function generateCraters(seed) {
  const r = seeded(seed)
  const lat = (limit) => Math.asin((r() * 2 - 1) * Math.sin(limit))
  const dist = (a, la, lo) => Math.acos(clamp(Math.sin(a.lat) * Math.sin(la) + Math.cos(a.lat) * Math.cos(la) * Math.cos(a.lon - lo), -1, 1))
  const seas = []
  for (let i = 0; i < 200 && seas.length < 4; i++) {
    const c = { lat: lat(0.9), lon: r() * TAU, radius: 0.36 + r() * 0.2, depth: 0.14 + r() * 0.08, sea: true }
    if (seas.every((o) => dist(o, c.lat, c.lon) > 0.9 * (o.radius + c.radius))) seas.push(c)
  }
  const craters = []
  for (let i = 0; i < 600 && craters.length < 18; i++) {
    const rad = 0.06 + r() * r() * 0.2
    const c = { lat: lat(1.2), lon: r() * TAU, radius: rad, depth: 0.22 + r() * 0.14, sea: false }
    if (craters.every((o) => dist(o, c.lat, c.lon) > 1.25 * (o.radius + c.radius))) craters.push(c)
  }
  return [...seas, ...craters]
}

function moonLitPath([cx, cy], R, k) {
  const p = new Path2D()
  if (k <= 0.001) return p
  const outer = R * 1.3
  if (k >= 0.999) { p.rect(cx - outer, cy - outer, outer * 2, outer * 2); return p }
  p.moveTo(cx, cy - outer)
  p.arc(cx, cy, outer, -Math.PI / 2, Math.PI / 2, false)
  p.lineTo(cx, cy + R)
  const stretch = 1 + 0.2 * Math.max(0, 2 * k - 1)
  for (let i = 0; i <= 48; i++) {
    const y = R - (2 * R * i) / 48
    const half = Math.sqrt(Math.max(0, R * R - y * y))
    p.lineTo(cx + (1 - 2 * k) * half * stretch, cy + y)
  }
  p.closePath()
  return p
}

function moonSilhouette(craters, [cx, cy], R, rotation) {
  const samples = 120
  const offsets = new Float32Array(samples)
  for (const c of craters) {
    if (c.sea) continue
    const lon = c.lon + rotation
    const facing = Math.cos(c.lat) * Math.cos(lon)
    const onEdge = 1 - Math.abs(facing) / Math.sin(c.radius)
    if (onEdge <= 0) continue
    const theta = Math.atan2(-Math.sin(c.lat), Math.cos(c.lat) * Math.sin(lon))
    const dip = 0.28 * c.radius, rim = 0.1 * c.radius
    for (let i = 0; i < samples; i++) {
      const a = (TAU * i) / samples
      let diff = Math.abs(a - theta) % TAU
      if (diff > Math.PI) diff = TAU - diff
      const d = diff / c.radius
      let h = rim * Math.exp(-(((d - 1) / 0.3) ** 2))
      if (d < 1) h -= dip * (1 - d * d)
      offsets[i] += h * onEdge
    }
  }
  const p = new Path2D()
  for (let i = 0; i < samples; i++) {
    const a = (TAU * i) / samples
    const r = R * (1 + offsets[i])
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a)
    if (i === 0) p.moveTo(x, y); else p.lineTo(x, y)
  }
  p.closePath()
  return p
}

function ovalPath(x, y, a, b, angle) {
  const p = new Path2D()
  const ca = Math.cos(angle), sa = Math.sin(angle)
  for (let i = 0; i <= 28; i++) {
    const t = (TAU * i) / 28
    const u = a * Math.cos(t), v = b * Math.sin(t)
    const px = x + u * ca - v * sa, py = y + u * sa + v * ca
    if (i === 0) p.moveTo(px, py); else p.lineTo(px, py)
  }
  p.closePath()
  return p
}

function drawCraters(ctx, craters, [cx, cy], R, rotation, floor, floorAlpha, lit) {
  for (const c of craters) {
    const lon = c.lon + rotation
    const facing = Math.cos(c.lat) * Math.cos(lon)
    if (facing <= 0.02) continue
    const x = cx + R * Math.cos(c.lat) * Math.sin(lon)
    const y = cy - R * Math.sin(c.lat)
    const r = R * c.radius
    const angle = Math.atan2(y - cy, x - cx)
    const fade = Math.min(1, facing / 0.3)
    const bowl = ovalPath(x, y, r * facing, r, angle)
    if (c.sea) {
      const a = floorAlpha * c.depth * fade * 2.2
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, css(floor, a)); g.addColorStop(0.6, css(floor, a * 0.75)); g.addColorStop(1, css(floor, 0))
      ctx.fillStyle = g
      ctx.fill(bowl)
      continue
    }
    ctx.fillStyle = css(floor, floorAlpha * c.depth * fade * (lit ? 1.1 : 1.6))
    ctx.fill(bowl)
    if (!lit) continue
    ctx.save()
    ctx.clip(bowl)
    ctx.save(); clipOutside(ctx, ovalPath(x - r * 0.42, y, r * facing, r, angle)); ctx.fillStyle = `rgba(0,0,0,${0.32 * fade})`; ctx.fillRect(x - r * 2, y - r * 2, r * 4, r * 4); ctx.restore()
    ctx.save(); clipOutside(ctx, ovalPath(x + r * 0.22, y, r * facing, r, angle)); ctx.fillStyle = `rgba(255,255,255,${0.4 * fade})`; ctx.fillRect(x - r * 2, y - r * 2, r * 4, r * 4); ctx.restore()
    ctx.restore()
  }
}

function drawMoon(env) {
  const { ctx, off, dpr, pad, center, radius: R, flash, s, p } = env
  const [cx, cy] = center
  const rotation = s.turned % TAU
  const silhouette = moonSilhouette(s.craters, center, R, rotation)
  const litPath = moonLitPath(center, R, s.phase)
  const { base, second, light } = p

  // The soft light off the lit edge: the lit shape (inside the outline), blurred, behind the moon.
  if (s.phase > 0.01) {
    const o = off.getContext('2d')
    o.setTransform(1, 0, 0, 1, 0, 0); o.clearRect(0, 0, off.width, off.height)
    o.setTransform(dpr, 0, 0, dpr, pad * dpr, pad * dpr)
    o.save(); o.clip(silhouette); o.fillStyle = '#fff'; o.fill(litPath); o.restore()
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    const far = off.width * 4
    ctx.shadowColor = css(mix(base, WHITE, 0.55), (light ? 0.3 : 0.4) * s.litFade)
    ctx.shadowBlur = R * 0.16 * 2 * dpr
    ctx.shadowOffsetX = far
    ctx.drawImage(off, -far, 0)
    ctx.restore()
  }

  const flashMix = flash * 0.6
  const dark = mix(base, BLACK, light ? 0.62 : 0.74)
  const litBright = mix(mix(base, WHITE, 0.62), WHITE, flashMix)
  const litMid = mix(mix(mix(base, second, 0.5), WHITE, 0.42), WHITE, flashMix)
  const litEdge = mix(mix(second, WHITE, 0.2), WHITE, flashMix)
  ctx.save()
  ctx.clip(silhouette)
  const night = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.25, 0, cx - R * 0.25, cy - R * 0.25, R * 1.3)
  night.addColorStop(0, css(mix(dark, base, 0.12))); night.addColorStop(1, css(mix(dark, BLACK, 0.25)))
  ctx.fillStyle = night
  ctx.fillRect(cx - R * 2, cy - R * 2, R * 4, R * 4)
  drawCraters(ctx, s.craters, center, R, rotation, BLACK, 0.5, false)
  ctx.restore()

  layered(env, s.litFade, (c) => {
    c.save()
    c.clip(silhouette)
    c.clip(litPath)
    const day = c.createRadialGradient(cx + R * 0.35, cy - R * 0.3, 0, cx + R * 0.35, cy - R * 0.3, R * 1.45)
    day.addColorStop(0, css(litBright)); day.addColorStop(0.55, css(litMid)); day.addColorStop(1, css(litEdge))
    c.fillStyle = day
    c.fillRect(cx - R * 2, cy - R * 2, R * 4, R * 4)
    drawCraters(c, s.craters, center, R, rotation, mix(base, BLACK, 0.35), 0.85, true)
    const sun = Math.acos(clamp(2 * s.phase - 1, -1, 1))
    const sx = cx + R * 0.8 * Math.sin(sun), sy = cy - R * 0.15
    const shade = c.createRadialGradient(sx, sy, 0, sx, sy, R * 1.2)
    shade.addColorStop(0, 'rgba(0,0,0,0)'); shade.addColorStop(0.5, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,.26)')
    c.fillStyle = shade
    c.fillRect(cx - R * 2, cy - R * 2, R * 4, R * 4)
    c.restore()
  })

  ctx.strokeStyle = css(mix(base, WHITE, 0.3), light ? 0.5 : 0.28)
  ctx.lineWidth = R * 0.03
  ctx.stroke(silhouette)

  // The icon: dark over the lit part, light over the dark part (all light while faded out).
  if (p.icon) {
    const iconSize = p.size * 0.36
    const draw = (fill) => {
      ctx.save()
      ctx.translate(cx - iconSize / 2, cy - iconSize / 2)
      ctx.scale(iconSize / 24, iconSize / 24)
      ctx.fillStyle = fill
      ctx.fill(p.icon)
      ctx.restore()
    }
    const lit = s.litFade > 0.5 ? litPath : new Path2D()
    ctx.save(); clipOutside(ctx, lit); draw('rgba(255,255,255,.92)'); ctx.restore()
    ctx.save(); ctx.clip(lit); draw(css(mix(base, BLACK, 0.6), 0.85)); ctx.restore()
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* Flower                                                                                         */

const PETALS = 8
const BUD_GREEN = hex('#3E5E3A')
const LEAF_GREEN = hex('#3D7445')
const CENTRE_GOLD = hex('#F4CE5C')
const CENTRE_AMBER = hex('#C98A2E')

function petalOpen(i, progress) {
  const local = clamp(progress * PETALS - i)
  return 1 - (1 - local) ** 3
}

function drawFlower(env) {
  const { ctx, center, radius: R, flash, s, p } = env
  const [cx, cy] = center
  const flashMix = flash * 0.6
  const sway = Math.sin(s.turned) * 4
  const breathe = 1 + 0.025 * Math.sin(s.turned * 2.3)
  ctx.save()
  ctx.translate(cx, cy); ctx.rotate((sway * Math.PI) / 180); ctx.translate(-cx, -cy)
  drawLeaves(ctx, center, R)
  if (s.litFade < 0.999) drawBloom(ctx, center, R, 0, 1, p.base, p.second, flashMix)
  layered(env, s.litFade, (c) => {
    if (c !== ctx) { c.translate(cx, cy); c.rotate((sway * Math.PI) / 180); c.translate(-cx, -cy) }
    drawBloom(c, center, R, s.phase, breathe, p.base, p.second, flashMix)
  })
  drawCentre(ctx, center, R, s.phase, flashMix, p.base, p.icon)
  ctx.restore()
  drawPollen(ctx, center, R, s.turned, s.active, p.base)
}

function inFrame(ctx, [cx, cy], angleDeg, draw) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate((angleDeg * Math.PI) / 180)
  draw()
  ctx.restore()
}

function drawLeaves(ctx, center, R) {
  for (const angle of [128, 52]) {
    inFrame(ctx, center, angle, () => {
      const len = R * 1.08, w = R * 0.26
      const leaf = new Path2D()
      leaf.moveTo(R * 0.2, 0)
      leaf.bezierCurveTo(len * 0.45, -w * 1.1, len * 0.85, -w * 0.6, len, 0)
      leaf.bezierCurveTo(len * 0.85, w * 0.6, len * 0.45, w * 1.1, R * 0.2, 0)
      leaf.closePath()
      const g = ctx.createLinearGradient(R * 0.2, 0, len, 0)
      g.addColorStop(0, css(mix(LEAF_GREEN, BLACK, 0.35))); g.addColorStop(0.5, css(LEAF_GREEN)); g.addColorStop(1, css(mix(LEAF_GREEN, WHITE, 0.18)))
      ctx.fillStyle = g
      ctx.fill(leaf)
      ctx.save(); ctx.clip(leaf); ctx.fillStyle = 'rgba(0,0,0,.16)'; ctx.fillRect(0, 0, len, w * 1.2); ctx.restore()
      ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = R * 0.025
      ctx.beginPath(); ctx.moveTo(R * 0.3, 0); ctx.lineTo(len * 0.9, 0); ctx.stroke()
    })
  }
}

function drawBloom(ctx, center, R, progress, breathe, base, second, flashMix) {
  for (const back of [true, false]) {
    for (let i = 0; i < PETALS; i++) {
      const open = petalOpen(i, progress)
      const angle = -90 + (360 / PETALS) * i + (back ? 180 / PETALS : 0)
      const len = R * (back ? lerp(0.5, 0.86, open) : lerp(0.58, 1, open)) * breathe
      const width = R * (back ? lerp(0.15, 0.3, open) : lerp(0.17, 0.34, open))
      const petalColor = mix(base, second, (i / (PETALS - 1)) * 0.5)
      const colour = mix(mix(mix(base, BUD_GREEN, 0.62), petalColor, open), BLACK, back ? 0.22 : 0)
      drawPetal(ctx, center, R, angle, len, width, colour, flashMix, open)
    }
  }
}

function drawPetal(ctx, center, R, angle, len, width, colour, flashMix, open) {
  const start = R * 0.1, tip = start + len
  const petal = new Path2D()
  petal.moveTo(start, 0)
  petal.bezierCurveTo(start + len * 0.22, -width * 0.95, start + len * 0.78, -width * 1.05, tip, 0)
  petal.bezierCurveTo(start + len * 0.78, width * 1.05, start + len * 0.22, width * 0.95, start, 0)
  petal.closePath()
  inFrame(ctx, center, angle, () => {
    ctx.save(); ctx.translate(R * 0.025, R * 0.035); ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fill(petal); ctx.restore()
    const g = ctx.createLinearGradient(start, 0, tip, 0)
    g.addColorStop(0, css(mix(colour, BLACK, 0.3)))
    g.addColorStop(0.45, css(mix(colour, WHITE, flashMix)))
    g.addColorStop(1, css(mix(mix(colour, WHITE, 0.3 + 0.12 * open), WHITE, flashMix)))
    ctx.fillStyle = g
    ctx.fill(petal)
    ctx.save(); ctx.clip(petal); ctx.fillStyle = 'rgba(0,0,0,.13)'; ctx.fillRect(start, 0, len, width * 1.2); ctx.restore()
    ctx.strokeStyle = 'rgba(255,255,255,.26)'; ctx.lineWidth = width * 0.07
    ctx.beginPath(); ctx.moveTo(start + len * 0.12, 0); ctx.lineTo(start + len * 0.8, 0); ctx.stroke()
    ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = R * 0.014
    ctx.stroke(petal)
  })
}

function drawCentre(ctx, [cx, cy], R, progress, flashMix, base, icon) {
  const r = R * 0.38
  const warm = clamp(progress)
  const gold = mix(mix(CENTRE_GOLD, base, 0.12), WHITE, flashMix)
  const amber = mix(CENTRE_AMBER, base, 0.2)
  const olive = mix(hex('#8C8A3C'), gold, 0.25 * warm)
  for (let k = 0; k < 22; k++) {
    const a = (TAU * k) / 22 + 0.11 * Math.sin(k * 2.7)
    const dx = Math.cos(a), dy = Math.sin(a)
    const reach = r * (1.16 + 0.08 * Math.sin(k * 1.9))
    ctx.strokeStyle = css(mix(amber, BLACK, 0.25), 0.75); ctx.lineWidth = r * 0.045
    ctx.beginPath(); ctx.moveTo(cx + dx * r * 0.8, cy + dy * r * 0.8); ctx.lineTo(cx + dx * reach, cy + dy * reach); ctx.stroke()
    ctx.fillStyle = css(mix(gold, amber, 0.35))
    ctx.beginPath(); ctx.arc(cx + dx * reach, cy + dy * reach, r * 0.07, 0, TAU); ctx.fill()
  }
  ctx.fillStyle = 'rgba(0,0,0,.18)'
  ctx.beginPath(); ctx.arc(cx + R * 0.015, cy + R * 0.025, r * 1.03, 0, TAU); ctx.fill()
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
  g.addColorStop(0, css(olive)); g.addColorStop(0.5, css(gold)); g.addColorStop(1, css(mix(amber, BLACK, 0.2)))
  ctx.fillStyle = g
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill()
  for (let k = 1; k <= 70; k++) {
    const f = k / 70
    const d = r * 0.93 * Math.sqrt(f)
    const tone = k % 3 === 0 ? mix(gold, WHITE, 0.12) : mix(amber, BLACK, 0.18)
    ctx.fillStyle = css(tone, 0.45)
    ctx.beginPath(); ctx.arc(cx + Math.cos(k * 2.39996) * d, cy + Math.sin(k * 2.39996) * d, r * (0.045 + 0.035 * f), 0, TAU); ctx.fill()
  }
  if (icon) {
    const size = r * 1.15
    ctx.save()
    ctx.translate(cx - size / 2, cy - size / 2)
    ctx.scale(size / 24, size / 24)
    ctx.fillStyle = css(mix(CENTRE_AMBER, BLACK, 0.65), 0.9)
    ctx.fill(icon)
    ctx.restore()
  }
}

function drawPollen(ctx, [cx, cy], R, turned, active, base) {
  if (active <= 0.01) return
  const colour = mix(CENTRE_GOLD, base, 0.2)
  for (let k = 0; k < 5; k++) {
    const t = (((turned / TAU) * 2.5 + k / 5) % 1 + 1) % 1
    const a = -Math.PI / 2 + (k - 2) * 0.55 + 0.25 * Math.sin(t * 6 + k)
    const d = R * (0.35 + 1.05 * t)
    ctx.fillStyle = css(colour, active * Math.sin(t * Math.PI) * 0.85)
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, R * 0.045 * (1 - 0.4 * t), 0, TAU); ctx.fill()
  }
}
