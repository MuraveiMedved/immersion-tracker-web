// Race sprints on the web - the phone's ui/race/RaceSprintsPanel.kt and ui/zoo/SprintPrize.kt:
// the Sprints tab of a race card, picking a won sprint's prize from its five animals, and the
// reveal - a holo prize gets the celebration (prism burst, holo shards, the card flipping in).
import { useEffect, useRef, useState } from 'preact/hooks'
import { useStore } from '../store.js'
import { formatHm, formatYmd } from '../model/time.js'
import { momentumTier } from '../model/rules.js'
import { RARITY_COLOR, claimSprintPrize, setTrophy, takenPrizes } from '../model/zoo.js'
import { sprintsFor, prizesWaiting, sprintEndMillis } from '../model/sprints.js'
import { toast } from './common.jsx'
import { useCatalog, AnimalPhoto, AnimalCardView, CardStage, Floaty, GlowPill, rarityBrush } from './Zoo.jsx'

const SHOWN = 4

/** An event's sprints and which wait for this person to pick a prize. */
export function useSprints(event, now) {
  const s = useStore()
  const catalog = useCatalog()
  const me = s.race.userId
  const taken = takenPrizes(s)
  const sprints = catalog ? sprintsFor(event, now, (rarity) => catalog.filter((a) => a.rarity === rarity).map((a) => a.id)) : []
  return { sprints, taken, waiting: prizesWaiting(sprints, me, taken), me, catalog }
}

function left(ms) {
  const m = Math.max(1, Math.ceil(ms / 60000))
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60)
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m % 60}m` : `${m}m`
}

/** The Sprints tab: newest first (prizes still to pick on top), each with its dates, time left or
 *  who won, the five animals on offer and the top three. */
export function SprintsPanel({ event, now, data, onChoose }) {
  const [all, setAll] = useState(false)
  const { sprints, taken, me, catalog } = data
  const ordered = [...sprints].sort((a, b) => waitingRank(b) - waitingRank(a))
  function waitingRank(sp) { return sp.decided && sp.winners.includes(me) && !taken.has(sp.prizeKey) ? 1 : 0 }
  return (
    <div class="col" style="gap:10px;margin-top:10px">
      <div class="muted" style="font-size:11px;margin:0 4px">Most immersion in a week wins a Rare, in a month an Epic - the winner picks one of the five. Momentum can make it Holo.</div>
      {!sprints.length && <div class="muted small" style="padding:4px">Sprints start with the race.</div>}
      {(all ? ordered : ordered.slice(0, SHOWN)).map((sp) => {
        const color = RARITY_COLOR[sp.rarity]
        const iWon = sp.winners.includes(me)
        const names = sp.totals.filter((t) => sp.winners.includes(t.standing.userId)).map((t) => t.standing.name).join(', ')
        const status = sp.current ? `${left(sprintEndMillis(event, sp) - now)} left` : !sp.decided ? 'Deciding…' : iWon && sp.winners.length === 1 ? 'You won!' : names ? `${names} won` : 'No winner'
        const top = sp.totals.filter((t) => t.millis > 0).slice(0, 3)
        return (
          <div key={sp.key} class={`sprint-row ${sp.current ? 'current' : ''}`} style={{ '--p': color }}>
            <div class="row" style="gap:8px">
              <div class="grow" style="min-width:0">
                <div style="font-weight:700;font-size:14px">{sp.kind === 'WEEKLY' ? 'Weekly sprint' : 'Monthly sprint'}</div>
                <div class="muted" style="font-size:11px">{formatYmd(sp.firstDay)} – {formatYmd(sp.lastDay)}</div>
              </div>
              <div class="ellipsis" style={{ fontSize: '12px', fontWeight: 600, color: sp.decided && iWon ? color : 'var(--on-surface-variant)', maxWidth: '50%' }}>{status}</div>
            </div>
            <div class="row" style="gap:6px;margin-top:10px">
              {sp.choices.map((id) => catalog?.find((a) => a.id === id)).filter(Boolean).map((a) => (
                <div key={a.id} class="sprint-choice" title={a.name}><AnimalPhoto animal={a} /></div>
              ))}
            </div>
            {top.length > 0 && <div class="muted" style="font-size:11px;margin-top:8px">{top.map((t, i) => `${i + 1}. ${t.standing.name} ${formatHm(t.millis)}`).join('   ')}</div>}
            {sp.decided && iWon && (taken.has(sp.prizeKey)
              ? <div style={{ color, fontSize: '12px', fontWeight: 600, marginTop: '8px' }}>Prize taken ✓</div>
              : <button class="sprint-claim" style={{ backgroundImage: rarityBrush(sp.rarity) }} onClick={() => onChoose(sp)}>Choose your prize</button>)}
          </div>
        )
      })}
      {sprints.length > SHOWN && <button class="btn text" style="align-self:center" onClick={() => setAll(!all)}>{all ? 'Show fewer' : 'Show older sprints'}</button>}
    </div>
  )
}

/** Picking a won sprint's prize, then the reveal. */
export function SprintPrizeFlow({ sprint, onClose }) {
  const catalog = useCatalog()
  const [picked, setPicked] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  if (result) return <PrizeReveal result={result} onClose={onClose} />
  const choices = (catalog || []).length ? sprint.choices.map((id) => catalog.find((a) => a.id === id)).filter(Boolean) : []
  const take = async () => {
    if (!picked || busy) return
    setBusy(true)
    const r = await claimSprintPrize(sprint.prizeKey, picked.id)
    setBusy(false)
    if (!r) { toast('That prize was already taken'); onClose(); return }
    setResult(r)
  }
  return (
    <CardStage rarity={sprint.rarity} onClose={() => !busy && onClose()}>
      <div class="col" style="align-items:center;text-align:center">
        <div class="title-large" style="color:#fff;font-weight:900">You won the {sprint.kind === 'WEEKLY' ? 'weekly' : 'monthly'} sprint!</div>
        <div style="color:rgba(255,255,255,.8);font-size:12px;margin:4px 0 6px">Pick one of the five for your zoo</div>
      </div>
      {picked && <div style="width:100%;max-width:300px;align-self:center"><AnimalCardView animal={picked} /></div>}
      <div class="sprint-pick-grid">
        {choices.map((a) => (
          <div key={a.id} class={`tile-animal ${picked && picked.id !== a.id ? 'dim' : ''} ${picked?.id === a.id ? 'picked' : ''}`} style={{ borderColor: RARITY_COLOR[a.rarity] }}
            onClick={() => setPicked(picked?.id === a.id ? null : a)}>
            <AnimalPhoto animal={a} />
            <div class="cap">{a.name}</div>
          </div>
        ))}
      </div>
      <GlowPill rarity={sprint.rarity} solid disabled={!picked || busy} onClick={take}>{picked ? `Take ${picked.name}` : 'Tap one to see it'}</GlowPill>
    </CardStage>
  )
}

/** A prize received: a holo one gets the celebration, a plain one springs in like a hatch. */
export function PrizeReveal({ result, onClose, onReplay }) {
  const s = useStore()
  const r = result.animal.rarity
  const onDisplay = s.zoo.trophyId === result.animal.id
  const holo = !!result.cert?.foil
  const [round, setRound] = useState(0)
  return (
    <CardStage rarity={r} onClose={onClose}>
      {holo ? <HoloCelebration key={round} result={result} /> : (
        <div class="reveal-pop">
          <Floaty>
            <div class="col" style="align-items:center">
              <span class="reveal-banner" style={{ backgroundImage: rarityBrush(r), '--p': RARITY_COLOR[r] }}>PRIZE!</span>
              <div style="width:100%"><AnimalCardView animal={result.animal} cert={result.cert} timesFound={result.copies} onDisplay={onDisplay} /></div>
            </div>
          </Floaty>
        </div>
      )}
      <div class="stage-row">
        {onReplay && <GlowPill rarity={r} onClick={() => setRound(round + 1)}>Replay</GlowPill>}
        {!onReplay && !onDisplay && <GlowPill rarity={r} onClick={() => { setTrophy(result.animal.id); toast('On display on your profile') }}>Show on my profile</GlowPill>}
        <GlowPill rarity={r} onClick={onClose}>Nice!</GlowPill>
      </div>
    </CardStage>
  )
}

const PRISM = ['#5CF2E6', '#6FC8FF', '#A98BFF', '#E58CFF', '#FF8FCB', '#FFD86B', '#9DF5B5']
const CELEBRATION_MS = 2600

/** The phone's HoloCelebration: a flash and three prism rings racing out, holo shards bursting and
 *  tumbling down, rainbow rays turning behind, the card flipping round from its prism back, the
 *  "✦ HOLO! ✦" banner popping in and the Momentum tier that gave it the chance. */
export function HoloCelebration({ result }) {
  const canvas = useRef(null)
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const ctx = c.getContext('2d')
    let seed = [...result.animal.id].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261) >>> 0
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
    const shards = Array.from({ length: 70 }, () => ({
      angle: rnd() * Math.PI * 2, speed: 0.45 + rnd() * 0.75, spin: (rnd() - 0.5) * 900, size: 4 + rnd() * 7,
      color: PRISM[Math.floor(rnd() * PRISM.length)], delay: rnd() * 0.18, long: rnd() < 0.5,
    }))
    let raf, start = null
    const phase = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)))
    const easeOut = (x) => 1 - (1 - x) ** 3
    const draw = (now) => {
      if (start == null) start = now
      const elapsed = now - start
      const t = Math.min(1, elapsed / CELEBRATION_MS)
      const dpr = window.devicePixelRatio || 1
      const w = c.clientWidth, h = c.clientHeight
      if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      const cx = w / 2, cy = h / 2, r = Math.max(w, h) / 2
      // Rays, turning slowly for as long as it's open.
      const rays = phase(t, 0.15, 0.5)
      if (rays > 0) {
        ctx.save(); ctx.translate(cx, cy); ctx.rotate((elapsed / 14000) * Math.PI * 2)
        for (let i = 0; i < 16; i++) {
          const a0 = (i * 2 * Math.PI) / 16, a1 = a0 + (Math.PI / 16) * 0.75
          const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
          g.addColorStop(0, PRISM[i % PRISM.length] + Math.round(0.32 * rays * 255).toString(16).padStart(2, '0'))
          g.addColorStop(1, 'transparent')
          ctx.fillStyle = g
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r * Math.cos(a0), r * Math.sin(a0)); ctx.lineTo(r * Math.cos(a1), r * Math.sin(a1)); ctx.closePath(); ctx.fill()
        }
        ctx.restore()
      }
      const flash = phase(t, 0, 0.22)
      if (flash < 1) {
        const fr = r * (0.2 + 0.8 * flash)
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, fr)
        g.addColorStop(0, `rgba(255,255,255,${0.9 * (1 - flash)})`); g.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, fr, 0, Math.PI * 2); ctx.fill()
      }
      for (let k = 0; k < 3; k++) {
        const ring = phase(t, 0.04 + k * 0.09, 0.55 + k * 0.09)
        if (ring <= 0 || ring >= 1) continue
        const g = ctx.createConicGradient ? ctx.createConicGradient(0, cx, cy) : null
        if (g) { PRISM.forEach((col, i) => g.addColorStop(i / PRISM.length, col)); g.addColorStop(1, PRISM[0]) }
        ctx.strokeStyle = g || PRISM[k * 2]
        ctx.globalAlpha = (1 - ring) * 0.9
        ctx.lineWidth = 14 - 10 * ring
        ctx.beginPath(); ctx.arc(cx, cy, r * easeOut(ring), 0, Math.PI * 2); ctx.stroke()
        ctx.globalAlpha = 1
      }
      for (const s of shards) {
        const p = phase(t, 0.08 + s.delay, 1)
        if (p <= 0) continue
        const dist = r * s.speed * easeOut(p)
        const x = cx + Math.cos(s.angle) * dist, y = cy + Math.sin(s.angle) * dist + r * 0.35 * p * p
        const fade = p < 0.75 ? 1 : (1 - p) / 0.25
        const turn = s.spin * p
        ctx.save(); ctx.translate(x, y); ctx.rotate((turn * Math.PI) / 180)
        ctx.globalAlpha = fade * (0.55 + 0.45 * Math.cos(turn / 40))
        ctx.fillStyle = s.color
        const sw = s.size, sh = s.long ? sw * 2.2 : sw
        ctx.fillRect(-sw / 2, -sh / 2, sw, sh)
        ctx.restore()
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [result])
  const tier = result.cert?.momentumDays != null ? momentumTier(result.cert.momentumDays) : null
  return (
    <div class="holo-celebration">
      <canvas ref={canvas} class="holo-canvas" />
      <div class="col" style="align-items:center;position:relative">
        <span class="reveal-banner holo-banner">✦ HOLO! ✦</span>
        <div class="holo-flip">
          <div class="front"><AnimalCardView animal={result.animal} cert={result.cert} timesFound={result.copies} /></div>
          <div class="back" />
        </div>
        {tier && <div class={`holo-note tier-${tier.id}`}>{tier.name} Momentum gave it a {tier.holoPercent}% Holo chance</div>}
      </div>
    </div>
  )
}
