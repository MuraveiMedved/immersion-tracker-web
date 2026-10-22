// Weekly/Monthly challenges on the web - the phone's ui/race/RaceSprintsPanel.kt and ui/zoo/SprintPrize.kt:
// the Challenges screen (your own progress, no race involved), collecting a reward (a random animal
// of its colour) and the reveal - a holo one gets the celebration (prism burst, holo shards, the
// card flipping in).
import { useEffect, useRef, useState } from 'preact/hooks'
import { useStore, useNow } from '../store.js'
import { formatHm, formatYmd } from '../model/time.js'
import { momentumTier, counts } from '../model/rules.js'
import { RARITY_COLOR, RARITY_LABEL, claimSprintPrize, claimNametag, setTrophy, takenPrizes } from '../model/zoo.js'
import { HatchDialog } from './Zoo.jsx'
import { localSprints, prizesWaiting, sprintEndMillis, sprintStartMillis, waitingIn, isTaken } from '../model/sprints.js'
import { toast, Icon } from './common.jsx'
import { AnimalCardView, CardStage, Floaty, GlowPill, rarityBrush } from './Zoo.jsx'

/** This person's Weekly and Monthly, and the rewards already collected (RaceViewModel.challenges). */
export function useChallenges(now) {
  const s = useStore()
  const sprints = localSprints(s.entries, now)
  const taken = takenPrizes(s)
  return { sprints, taken, waiting: prizesWaiting(sprints, taken).length > 0 }
}

/** The trophy at the top of the Zoo - a red dot while a reward waits. */
export function ChallengesButton({ nav }) {
  const now = useNow(60000)
  const { waiting } = useChallenges(now)
  // Always there, race or not: with none joined, Challenges says how to get some.
  return (
    <button class="icon-btn challenges-btn" title="Challenges" onClick={() => nav('challenges')}>
      <Icon name="emoji_events" />{waiting && <span class="dot" />}
    </button>
  )
}

/** Challenges: your own Weekly and Monthly in each race you're in, opened from Home. */
export function Challenges({ nav }) {
  const now = useNow(30000)
  const { sprints, taken } = useChallenges(now)
  // Immersion being tracked right now: the running ones' bars flash white (the phone's whiteFlash).
  const immersing = useStore().entries.some((e) => e.endTimeMillis == null && counts(e.contentType, e.languageProfileId))
  const { collect, dialog } = useCollect()
  return (
    <>
      <div class="row" style="align-items:center;gap:4px;margin-bottom:8px">
        <button class="icon-btn" title="Back" onClick={() => nav('zoo')}><Icon name="arrow_back" /></button>
        <h1 class="page-title grow" style="margin:0">Challenges</h1>
      </div>
      <SprintsPanel now={now} data={{ sprints, taken }} onCollect={collect} immersing={immersing} />
      {dialog}
    </>
  )
}

function left(ms) {
  const m = Math.max(1, Math.ceil(ms / 60000))
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60)
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m % 60}m` : `${m}m`
}

/** Collects one reward and shows it. An animal is an egg of its colour, hatched the same way as
 *  the Zoo's (Zoo.jsx HatchDialog); a nametag goes straight into the Zoo with a small celebration. */
export function useCollect() {
  const [pending, setPending] = useState(null)
  const [nametag, setNametag] = useState(false)
  const collect = (m) => {
    if (pending) return
    if (!m.rarity) { if (claimNametag(m.prizeKey)) setNametag(true); return }
    setPending(m)
  }
  const dialog = (pending && (
    <HatchDialog kind={pending.rarity} hatch={() => claimSprintPrize(pending.prizeKey, pending.rarity)} onClose={() => setPending(null)} />
  )) || (nametag && <NametagCollected onClose={() => setNametag(false)} />)
  return { collect, dialog }
}

/** A nametag collected: the tag in gold, and what it's for (ChallengesScreen.kt NametagCollectedDialog). */
function NametagCollected({ onClose }) {
  return (
    <CardStage rarity="ORANGE" onClose={onClose}>
      <Floaty>
        <div class="col" style="align-items:center;text-align:center">
          <div style="font-size:72px;line-height:1">🏷</div>
          <div class="title-large" style="color:#fff;font-weight:800;margin-top:8px">+1 Nametag</div>
          <div style="color:rgba(255,255,255,.85);margin:6px 0 18px">Name an animal in your Zoo - open its card and tap Name.</div>
        </div>
      </Floaty>
      <GlowPill rarity="ORANGE" onClick={onClose}>Nice!</GlowPill>
    </CardStage>
  )
}

// A reward's colours and name: its rarity's, or gold and "nametag" for a nametag.
const rewardColor = (r) => RARITY_COLOR[r || 'ORANGE']
const rewardName = (r) => (r ? RARITY_LABEL[r] : 'nametag')

/** The Challenges tab: your own Weekly and Monthly (nobody else's), each with its dates, time left,
 *  progress toward its cap and a "+1 card" badge over each reward - no explaining text (the user
 *  wants it visually self-explanatory). Every ended period folds away under "Previous (N)", which
 *  carries a red dot while one has a reward to collect. */
export function SprintsPanel({ now, data, onCollect, immersing = false }) {
  const [showPrevious, setShowPrevious] = useState(false)
  const { sprints, taken } = data
  const waits = (sp) => (waitingIn(sp, taken).length ? 1 : 0)
  const shown = sprints.filter((sp) => sp.current)
  const previous = sprints.filter((sp) => !sp.current).sort((x, y) => waits(y) - waits(x))
  const row = (sp) => {
        const top = sp.milestones[sp.milestones.length - 1].rarity
        const color = rewardColor(top)
        const waiting = waitingIn(sp, taken)
        const fraction = Math.min(1, sp.myMillis / sp.capMillis)
        // How much of its time is gone - stay ahead of the tick to reach the top reward on time.
        const start = sp.current ? sprintStartMillis(sp) : 0, end = sp.current ? sprintEndMillis(sp) : 0
        const elapsed = sp.current && end > start ? Math.min(1, Math.max(0, (now - start) / (end - start))) : null
        // Ahead = more of the target done than of the time gone: the marker turns green.
        const ahead = elapsed != null && sp.myMillis / sp.capMillis > elapsed
        return (
          <div key={sp.key} class={`sprint-row ${sp.current ? 'current' : ''}`} style={{ '--p': color }}>
            <div class="row" style="gap:8px">
              <div class="grow" style="min-width:0">
                <div style="font-weight:700;font-size:14px">{sp.kind === 'WEEKLY' ? 'Weekly' : 'Monthly'}</div>
                <div class="muted" style="font-size:11px">{formatYmd(sp.firstDay)} – {formatYmd(sp.lastDay)}</div>
              </div>
              <div class="muted" style="font-size:12px;font-weight:600">{sp.current ? `${left(sprintEndMillis(sp) - now)} left` : 'Ended'}</div>
            </div>
            <div class="sprint-bar">
              <div class="track"><div class={`fill ${immersing && sp.current ? 'flashing' : ''}`} style={{ width: `${fraction * 100}%`, background: `linear-gradient(90deg, ${rewardColor(sp.milestones[0].rarity)}, ${color})` }} /></div>
              {sp.milestones.map((m, i) => {
                const last = i === sp.milestones.length - 1
                const share = m.millis / sp.capMillis
                return (
                  <span key={'b' + m.prizeKey} class={`sprint-badge ${isTaken(m, taken) ? 'done' : ''}`} title={m.rarity ? `+1 ${RARITY_LABEL[m.rarity]} animal card` : '+1 nametag'}
                    style={{ ...(last ? { right: 0 } : { left: `calc((100% - 18px) * ${share} + 9px - 17px)` }), '--c': rewardColor(m.rarity) }}>
                    {isTaken(m, taken) ? '✓' : '+1'}{m.rarity ? <i class="sprint-card"><Icon name="pets" size={7} color={RARITY_COLOR[m.rarity]} /></i> : <span style="font-size:11px;margin-left:2px">🏷</span>}
                  </span>
                )
              })}
              {sp.milestones.map((m) => (
                <span key={m.prizeKey} class={`mark ${m.reached ? 'on' : ''}`} title={`${rewardName(m.rarity)} at ${m.millis / 3600000} h`}
                  style={{ left: `calc((100% - 18px) * ${m.millis / sp.capMillis})`, '--c': rewardColor(m.rarity) }} />
              ))}
            </div>
            {/* Under the bar where the time has got to: a triangle and "Hurry!" - green with "You're Ahead." once ahead of it
                (RaceSprintsPanel's SprintPaceMarker). Kept inside the row near either end. */}
            {elapsed != null && (
              <div class={`sprint-pace ${ahead ? 'ahead' : ''}`}>
                <span class="tri" style={{ left: `calc((100% - 18px) * ${elapsed} + 9px)` }} />
                <span class="word" style={{ left: `clamp(0px, calc((100% - 18px) * ${elapsed} + 9px - 40px), calc(100% - 80px))` }}>{ahead ? "You're Ahead." : 'Hurry!'}</span>
              </div>
            )}
            <div class="muted" style="font-size:11px;margin-top:6px">{formatHm(sp.myMillis)} of {sp.capHours} h</div>
            {waiting.length > 0 && <button class="sprint-claim" style={{ backgroundImage: rarityBrush(waiting[0].rarity || 'ORANGE') }} onClick={() => onCollect(waiting[0])}>Collect your {rewardName(waiting[0].rarity)}</button>}
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
 *  "✦ HOLO! ✦" banner popping in and the Momentum tier that gave it the chance. Played for every
 *  holo card received: egg hatches (Zoo.jsx HatchDialog) and Weekly/Monthly rewards (PrizeReveal). */
export function HoloCelebration({ result, bannerPrefix }) {
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
        <span class="reveal-banner holo-banner">{bannerPrefix ? `${bannerPrefix}  ` : ''}✦ HOLO! ✦</span>
        <div class="holo-flip">
          <div class="front"><AnimalCardView animal={result.animal} cert={result.cert} timesFound={result.copies} /></div>
          <div class="back" />
        </div>
        {tier && <div class={`holo-note tier-${tier.id}`}>{tier.name} Momentum gave it a {tier.holoPercent}% Holo chance</div>}
      </div>
    </div>
  )
}
