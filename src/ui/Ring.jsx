import { useEffect, useRef } from 'preact/hooks'
import { hexToRgb, mix } from '../model/theme.js'

export const RING_STYLES = ['CLASSIC', 'GRADIENT', 'SEGMENTED', 'DOTTED', 'HELIX', 'NEON', 'LIQUID', 'BUBBLES']
export const RING_LABEL = { CLASSIC: 'Classic', GRADIENT: 'Lazer', SEGMENTED: 'Ticks', DOTTED: 'Trail', HELIX: 'Helix', NEON: 'Neon', LIQUID: 'Liquid', BUBBLES: 'Bubbles' }

const rgba = (hex, a) => {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r},${g},${b},${a})`
}

/**
 * A goal ring. [progress] 0..1+ (complete from 1), drawn in [color] (or along [stops] for a
 * gradient language) in one of the phone's eight [ringStyle]s. [icon] sits in the middle.
 */
export function Ring({ progress, color, stops, ringStyle = 'CLASSIC', size = 92, icon, active = false, light = false }) {
  const ref = useRef(null)
  const state = useRef({ t: 0, bubbles: [] })

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr
    canvas.height = size * dpr
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    const animated = ringStyle === 'LIQUID' || ringStyle === 'BUBBLES' || (active && (ringStyle === 'NEON' || ringStyle === 'HELIX'))
    let raf = 0
    const draw = () => {
      ctx.clearRect(0, 0, size, size)
      drawRing(ctx, size, Math.max(0, progress), color, stops, ringStyle, state.current, active, light)
      if (animated && !document.hidden) {
        state.current.t += 1 / 60
        raf = requestAnimationFrame(draw)
      }
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [progress, color, stops && stops.join(), ringStyle, size, active, light])

  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <canvas ref={ref} style={{ width: size, height: size, display: 'block' }} />
      {icon && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: size * 0.26, pointerEvents: 'none' }}>{icon}</div>}
    </div>
  )
}

function stopColor(stops, color, f) {
  if (!stops || stops.length < 2) return color
  const x = Math.max(0, Math.min(1, f)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(x))
  return mix(stops[i], stops[i + 1], x - i)
}

function drawRing(ctx, size, progress, color, stops, style, st, active, light) {
  const c = size / 2
  const stroke = size * 0.1
  const r = c - stroke / 2 - 2
  const start = -Math.PI / 2
  const p = Math.min(progress, 1)
  const done = progress >= 1
  const trackAlpha = light ? 0.28 : 0.22

  if (style === 'LIQUID' || style === 'BUBBLES') {
    const R = c - 3
    ctx.save()
    ctx.beginPath()
    ctx.arc(c, c, R, 0, Math.PI * 2)
    ctx.fillStyle = rgba(color, light ? 0.16 : 0.12)
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = rgba(color, light ? 0.6 : 0.5)
    ctx.stroke()
    ctx.clip()
    const level = size - 3 - (size - 6) * (done ? 1.02 : p)
    for (let layer = 0; layer < 2; layer++) {
      ctx.beginPath()
      const amp = done ? 2 : 3.2
      const phase = st.t * (layer ? 1.6 : 2.2) + layer * 1.7
      ctx.moveTo(0, size)
      for (let x = 0; x <= size; x += 2) ctx.lineTo(x, level + Math.sin(x / size * Math.PI * 2 + phase) * amp + layer * 2)
      ctx.lineTo(size, size)
      ctx.closePath()
      const grad = ctx.createLinearGradient(0, level, 0, size)
      const top = stopColor(stops, color, 0)
      const bottom = stopColor(stops, color, 1)
      grad.addColorStop(0, rgba(top, layer ? 0.55 : 0.95))
      grad.addColorStop(1, rgba(bottom, layer ? 0.55 : 0.95))
      ctx.fillStyle = grad
      ctx.fill()
    }
    if (style === 'BUBBLES' && (active || done)) {
      if (st.bubbles.length < 9 && Math.random() < 0.08) st.bubbles.push({ x: c + (Math.random() - 0.5) * size * 0.6, y: size, r: 1.5 + Math.random() * 2.5, v: 0.3 + Math.random() * 0.5 })
      for (const b of st.bubbles) {
        b.y -= b.v
        ctx.beginPath()
        ctx.arc(b.x + Math.sin(b.y / 6) * 1.2, b.y, b.r, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(255,255,255,.55)'
        ctx.fill()
      }
      st.bubbles = st.bubbles.filter((b) => b.y > level)
    }
    ctx.restore()
    return
  }

  if (done) {
    // Every style's completed look: a full disc in the language's colour.
    ctx.beginPath()
    ctx.arc(c, c, r + stroke / 2, 0, Math.PI * 2)
    if (stops && stops.length > 1) {
      const g = ctx.createLinearGradient(0, 0, size, size)
      stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s))
      ctx.fillStyle = g
    } else ctx.fillStyle = color
    if (style === 'NEON') { ctx.shadowColor = color; ctx.shadowBlur = 14 }
    ctx.fill()
    ctx.shadowBlur = 0
    if (style === 'SEGMENTED' || style === 'DOTTED') {
      ctx.strokeStyle = 'rgba(255,255,255,.35)'
      ctx.lineWidth = 1.5
      for (let i = 0; i < 36; i++) {
        const a = (i / 36) * Math.PI * 2
        ctx.beginPath()
        if (style === 'DOTTED') { ctx.arc(c + Math.cos(a) * (r - 1), c + Math.sin(a) * (r - 1), 1.3, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fill() }
        else { ctx.moveTo(c + Math.cos(a) * (r - 4), c + Math.sin(a) * (r - 4)); ctx.lineTo(c + Math.cos(a) * (r + 2), c + Math.sin(a) * (r + 2)); ctx.stroke() }
      }
    }
    if (style === 'HELIX') {
      ctx.beginPath()
      ctx.arc(c, c, r * 0.66, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255,255,255,.18)'
      ctx.fill()
    }
    return
  }

  // Track.
  ctx.lineCap = 'round'
  if (style === 'SEGMENTED') {
    const n = 40
    for (let i = 0; i < n; i++) {
      const a = start + (i / n) * Math.PI * 2
      const on = i / n < p
      ctx.beginPath()
      ctx.lineWidth = stroke * 0.42
      ctx.strokeStyle = on ? stopColor(stops, color, i / n) : rgba(color, light ? 0.32 : 0.25)
      ctx.moveTo(c + Math.cos(a) * (r - stroke / 2), c + Math.sin(a) * (r - stroke / 2))
      ctx.lineTo(c + Math.cos(a) * (r + stroke / 2), c + Math.sin(a) * (r + stroke / 2))
      ctx.stroke()
    }
    return
  }
  if (style === 'DOTTED') {
    const n = 30
    for (let i = 0; i < n; i++) {
      const f = i / n
      const a = start + f * Math.PI * 2
      const on = f < p
      const rad = on ? stroke * (0.22 + 0.3 * (f / Math.max(p, 0.01))) : stroke * 0.18
      ctx.beginPath()
      ctx.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, rad, 0, Math.PI * 2)
      ctx.fillStyle = on ? stopColor(stops, color, f) : rgba(color, light ? 0.36 : 0.28)
      ctx.fill()
    }
    return
  }

  ctx.beginPath()
  ctx.arc(c, c, r, 0, Math.PI * 2)
  ctx.lineWidth = style === 'NEON' || style === 'HELIX' ? stroke * 0.5 : stroke
  ctx.strokeStyle = rgba(color, trackAlpha)
  ctx.stroke()
  if (p <= 0) return
  const end = start + p * Math.PI * 2

  if (style === 'HELIX') {
    const steps = Math.max(8, Math.floor(p * 120))
    for (const strand of [0, 1]) {
      for (let i = 0; i < steps; i++) {
        const f0 = (i / steps) * p, f1 = ((i + 1) / steps) * p
        const twist = (f) => Math.sin(f * Math.PI * 12 + strand * Math.PI + st.t * 2)
        const pt = (f) => {
          const a = start + f * Math.PI * 2
          const rr = r + twist(f) * stroke * 0.45
          return [c + Math.cos(a) * rr, c + Math.sin(a) * rr]
        }
        const near = Math.cos(f0 * Math.PI * 12 + strand * Math.PI + st.t * 2) > 0
        ctx.beginPath()
        ctx.moveTo(...pt(f0))
        ctx.lineTo(...pt(f1))
        ctx.lineWidth = near ? stroke * 0.42 : stroke * 0.26
        const base = stopColor(stops, color, f0 / p)
        ctx.strokeStyle = near ? base : mix(base, '#FFFFFF', strand ? 0.2 : 0.45)
        ctx.stroke()
      }
    }
    return
  }

  if (style === 'NEON') {
    ctx.save()
    ctx.shadowColor = color
    ctx.shadowBlur = active ? 16 + Math.sin(st.t * 4) * 4 : 14
    ctx.beginPath()
    ctx.arc(c, c, r, start, end)
    ctx.lineWidth = stroke * 0.75
    ctx.strokeStyle = color
    ctx.stroke()
    ctx.restore()
    ctx.beginPath()
    ctx.arc(c, c, r, start, end)
    ctx.lineWidth = stroke * 0.28
    ctx.strokeStyle = mix(color, '#FFFFFF', light ? 0.3 : 0.75)
    ctx.stroke()
    return
  }

  if (style === 'GRADIENT' || (stops && stops.length > 1)) {
    const steps = Math.max(6, Math.floor(p * 90))
    for (let i = 0; i < steps; i++) {
      const a0 = start + (i / steps) * (end - start)
      const a1 = start + ((i + 1) / steps) * (end - start) + 0.01
      const f = i / steps
      ctx.beginPath()
      ctx.arc(c, c, r, a0, a1)
      ctx.lineWidth = stroke
      ctx.lineCap = i === 0 || i === steps - 1 ? 'round' : 'butt'
      ctx.strokeStyle = stops && stops.length > 1 ? stopColor(stops, color, f * p) : mix(mix(color, '#FFFFFF', 0.55), color, f)
      ctx.stroke()
    }
    if (style === 'GRADIENT') {
      ctx.save()
      ctx.shadowColor = color
      ctx.shadowBlur = 12
      ctx.beginPath()
      ctx.arc(c + Math.cos(end) * r, c + Math.sin(end) * r, stroke * 0.45, 0, Math.PI * 2)
      ctx.fillStyle = '#FFFFFF'
      ctx.fill()
      ctx.restore()
    }
    return
  }

  ctx.beginPath()
  ctx.arc(c, c, r, start, end)
  ctx.lineWidth = stroke
  ctx.strokeStyle = color
  ctx.stroke()
}
