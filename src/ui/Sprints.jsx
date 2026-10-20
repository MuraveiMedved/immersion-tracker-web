// Race Weekly/Monthly on the web - the phone's ui/race/RaceSprintsPanel.kt and ui/zoo/SprintPrize.kt:
// the Challenges tab of a race card (only your own progress), collecting a reward (a random animal
// of its colour) and the reveal - a holo one gets the celebration (prism burst, holo shards, the
// card flipping in).
import { useEffect, useRef, useState } from 'preact/hooks'
import { useStore, useNow } from '../store.js'
import { formatHm, formatYmd } from '../model/time.js'
import { momentumTier } from '../model/rules.js'
import { RARITY_COLOR, RARITY_LABEL, claimSprintPrize, setTrophy, takenPrizes } from '../model/zoo.js'
import { sprintsFor, prizesWaiting, sprintEndMillis } from '../model/sprints.js'
import { toast, Icon } from './common.jsx'
import { AnimalCardView, CardStage, Floaty, GlowPill, rarityBrush } from './Zoo.jsx'

/** Each race this person is in (running first, then finished ones still kept here) with its
 *  Weekly and Monthly - the phone's rememberChallengeRaces. */
export function useChallengeRaces(now) {
  const s = useStore()
  const me = s.race.userId
  const deleted = new Set(s.race.deleted)
  const seen = new Set()
  const ended = (e) => e.endMillis != null && now >= e.endMillis
  const races = [...s.race.cachedEvents, ...s.race.archive]
    .filter((e) => e && !seen.has(e.id) && seen.add(e.id) && !deleted.has(e.id) && (e.standings || []).some((x) => x.userId === me))
    .sort((a, b) => ended(a) - ended(b) || (b.endMillis ?? Infinity) - (a.endMillis ?? Infinity))
    .map((event) => ({ event, sprints: sprintsFor(event, me, now) }))
    .filter((r) => r.sprints.length)
  const taken = takenPrizes(s)
  return { races, taken, waiting: races.some((r) => prizesWaiting(r.sprints, taken).length > 0) }
}

/** The trophy on Home's "Today" row - a red dot while a reward waits; hidden with no race joined. */
export function ChallengesButton({ nav }) {
  const now = useNow(60000)
  const { races, waiting } = useChallengeRaces(now)
  if (!races.length) return null
  return (
    <button class="icon-btn challenges-btn" title="Challenges" onClick={() => nav('challenges')}>
      <Icon name="emoji_events" />{waiting && <span class="dot" />}
    </button>
  )
}

/** Challenges: your own Weekly and Monthly in each race you're in, opened from Home. */
export function Challenges({ nav }) {
  const now = useNow(30000)
  const { races, taken } = useChallengeRaces(now)
  const { collect, dialog } = useCollect()
  return (
    <>
      <div class="row" style="align-items:center;gap:4px;margin-bottom:8px">
        <button class="icon-btn" title="Back" onClick={() => nav('home')}><Icon name="arrow_back" /></button>
        <h1 class="page-title grow" style="margin:0">Challenges</h1>
      </div>
      {races.map(({ event, sprints }) => (
        <div key={event.id} style="margin-bottom:14px">
          {races.length > 1 && <div class="title-medium ellipsis" style="margin:16px 4px 0">{event.name}</div>}
          <SprintsPanel event={event} now={now} data={{ sprints, taken }} onCollect={collect} />
        </div>
      ))}
      {dialog}
    </>
  )
}

function left(ms) {
  const m = Math.max(1, Math.ceil(ms / 60000))
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60)
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m % 60}m` : `${m}m`
}

/** Collects one reward and shows it. */
export function useCollect() {
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const collect = async (m) => {
    if (busy) return
    setBusy(true)
    const r = await claimSprintPrize(m.prizeKey, m.rarity)
    setBusy(false)
    if (!r) { toast('Already collected'); return }
    setResult(r)
  }
  const dialog = result && <PrizeReveal result={result} onClose={() => setResult(null)} />
  return { collect, dialog }
}

/** The Challenges tab: your own Weekly and Monthly (nobody else's), each with its dates, time left,
 *  progress toward its cap and a "+1 card" badge over each reward - no explaining text (the user
 *  wants it visually self-explanatory). Every ended period folds away under "Previous (N)", which
 *  carries a red dot while one has a reward to collect. */
export function SprintsPanel({ event, now, data, onCollect }) {
  const [showPrevious, setShowPrevious] = useState(false)
  const { sprints, taken } = data
  const waits = (sp) => (sp.earned.some((m) => !taken.has(m.prizeKey)) ? 1 : 0)
  const shown = sprints.filter((sp) => sp.current)
  const previous = sprints.filter((sp) => !sp.current).sort((x, y) => waits(y) - waits(x))
  const row = (sp) => {
        const top = sp.milestones[sp.milestones.length - 1].rarity
        const color = RARITY_COLOR[top]
        const waiting = sp.earned.filter((m) => !taken.has(m.prizeKey))
        const fraction = Math.min(1, sp.myMillis / sp.capMillis)
        return (
          <div key={sp.key} class={`sprint-row ${sp.current ? 'current' : ''}`} style={{ '--p': color }}>
            <div class="row" style="gap:8px">
              <div class="grow" style="min-width:0">
                <div style="font-weight:700;font-size:14px">{sp.kind === 'WEEKLY' ? 'Weekly' : 'Monthly'}</div>
                <div class="muted" style="font-size:11px">{formatYmd(sp.firstDay)} – {formatYmd(sp.lastDay)}</div>
              </div>
              <div class="muted" style="font-size:12px;font-weight:600">{sp.current ? `${left(sprintEndMillis(event, sp) - now)} left` : 'Ended'}</div>
            </div>
            <div class="sprint-bar">
              <div class="track"><div class="fill" style={{ width: `${fraction * 100}%`, background: `linear-gradient(90deg, ${RARITY_COLOR[sp.milestones[0].rarity]}, ${color})` }} /></div>
              {sp.milestones.map((m, i) => {
                const last = i === sp.milestones.length - 1
                const share = m.millis / sp.capMillis
                return (
                  <span key={'b' + m.rarity} class={`sprint-badge ${taken.has(m.prizeKey) ? 'done' : ''}`} title={`+1 ${RARITY_LABEL[m.rarity]} animal card`}
                    style={{ ...(last ? { right: 0 } : { left: `calc((100% - 18px) * ${share} + 9px - 17px)` }), '--c': RARITY_COLOR[m.rarity] }}>
                    {taken.has(m.prizeKey) ? '✓' : '+1'}<i class="sprint-card"><Icon name="pets" size={7} color={RARITY_COLOR[m.rarity]} /></i>
                  </span>
                )
              })}
              {sp.milestones.map((m) => (
                <span key={m.rarity} class={`mark ${m.reached ? 'on' : ''}`} title={`${RARITY_LABEL[m.rarity]} at ${m.millis / 3600000} h`}
                  style={{ left: `calc((100% - 18px) * ${m.millis / sp.capMillis})`, '--c': RARITY_COLOR[m.rarity] }} />
              ))}
            </div>
            <div class="muted" style="font-size:11px;margin-top:6px">{formatHm(Math.min(sp.myMillis, sp.capMillis))} of {sp.capHours} h</div>
            {waiting.length > 0 && <button class="sprint-claim" style={{ backgroundImage: rarityBrush(waiting[0].rarity) }} onClick={() => onCollect(waiting[0])}>Collect your {RARITY_LABEL[waiting[0].rarity]}</button>}
          </div>
        )
  }
  return (
    <div class="col" style="gap:10px;margin-top:10px">
      {shown.map(row)}
      {previous.length > 0 && (
        <button class="sprint-previous" onClick={() => setShowPrevious(!showPrevious)}>
          <span>Previous ({previous.length})</span>{previous.some(waits) && <span class="dot" />}<span class="grow" /><Icon name={showPrevious ? 'expand_less' : 'expand_more'} size={20} />
        </button>
      )}
      {showPrevious && previous.map(row)}
    </div>
  )
}

/** A Weekly/Monthly reward received: a holo one gets the celebration, a plain one springs in like a hatch. */
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
              <span class="reveal-banner" style={{ backgroundImage: rarityBrush(r), '--p': RARITY_COLOR[r] }}>REWARD!</span>
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
