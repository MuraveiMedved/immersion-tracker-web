import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useStore, useNow, setSetting } from '../store.js'
import {
  loadCatalog, catalogNow, zooState, ensureBase, recordEarnedEggs, backfillHoloMomentum, hatchLootEgg, hatchColouredEgg, tradeUp, setTrophy, everFound, addToTrophyCase, removeFromTrophyCase, TROPHY_CASE_SIZE,
  RARITIES, RARITY_LABEL, RARITY_COLOR, HOURS_PER_BOX, TRADE_UP_COUNT, LOOT_BOX_ODDS, holoChancePercent, nextRarity, carriesCertificate,
  nametagsOf, nameAnimal, NAMETAG_MAX_LENGTH,
} from '../model/zoo.js'
import { goldenStreakDays, momentumTier } from '../model/rules.js'
import { formatDate } from '../model/time.js'
import { Dialog, Seg, toast, Spinner, Bolt, MomentumTierTable, Icon } from './common.jsx'
import { createPortal } from 'preact/compat'
import { HoloCelebration, ChallengesButton } from './Sprints.jsx'

export const RARITY_GRADIENT = {
  GREEN: 'linear-gradient(135deg, #2e7d32, #66bb6a)',
  BLUE: 'linear-gradient(135deg, #1e4fd8, #4fa3ff)',
  PURPLE: 'linear-gradient(135deg, #6d28d9, #c084fc)',
  ORANGE: 'linear-gradient(135deg, #e65100, #ffb74d)',
  RAINBOW: 'linear-gradient(135deg, #ff3b3b, #ffb300, #3ddc84, #2f8bff, #b44dff)',
  BOX: 'linear-gradient(160deg, #f6efe3, #e7d8bd)',
}

export function useCatalog() {
  const [list, setList] = useState(catalogNow())
  useEffect(() => { if (!list) loadCatalog().then(setList).catch(() => setList([])) }, [])
  return list
}

export function AnimalPhoto({ animal, style = {} }) {
  if (!animal?.image) return <div style={{ ...style, display: 'grid', placeItems: 'center', fontSize: 40 }}>🐾</div>
  const f = animal.frame || { x: 0.5, y: 0.5, zoom: 1 }
  return (
    <img src={animal.image} alt={animal.name} loading="lazy" draggable={false}
      style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${f.x * 100}% ${f.y * 100}%`, transform: `scale(${f.zoom || 1})`, transformOrigin: `${f.x * 100}% ${f.y * 100}%`, display: 'block', ...style }} />
  )
}

// The colour along the bottom of a photo, for the wash behind its card's details (see the phone's
// rememberPhotoTint) - bright enough to read as a colour, muted enough not to shout.
const photoTints = new Map()
function usePhotoTint(src) {
  const [tint, setTint] = useState(() => photoTints.get(src) || null)
  useEffect(() => {
    if (!src) return
    if (photoTints.has(src)) { setTint(photoTints.get(src)); return }
    let live = true
    const img = new Image()
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = 8; c.height = 8
        const ctx = c.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(img, 0, 0, 8, 8)
        const d = ctx.getImageData(0, 6, 8, 2).data
        let r = 0, g = 0, b = 0
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2] }
        const t = mutedTint(r / 16, g / 16, b / 16)
        photoTints.set(src, t)
        if (live) setTint(t)
      } catch { /* a photo the canvas can't read just gets no wash */ }
    }
    img.src = src
    return () => { live = false }
  }, [src])
  return tint
}

function mutedTint(r, g, b) {
  const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255, d = max - min
  let h = 0
  if (d) h = max === r / 255 ? ((g - b) / 255 / d) % 6 : max === g / 255 ? (b - r) / 255 / d + 2 : (r - g) / 255 / d + 4
  h = (h * 60 + 360) % 360
  const sat = Math.min(0.6, Math.max(0.25, max ? d / max : 0)), val = Math.min(0.85, Math.max(0.55, max))
  const k = (n) => { const x = (n + h / 60) % 6; return Math.round(255 * (val - val * sat * Math.max(0, Math.min(x, 4 - x, 1)))) }
  return [k(5), k(3), k(1)]
}

export function RarityBadge({ rarity }) {
  return <span class="rarity-badge" style={{ background: RARITY_GRADIENT[rarity] }}>{RARITY_LABEL[rarity]}</span>
}

export function Zoo({ nav }) {
  const s = useStore()
  const now = useNow(15000)
  const catalog = useCatalog()
  const [hatching, setHatching] = useState(null) // 'BOX' or a rarity
  const [odds, setOdds] = useState(false)
  const [nametagInfo, setNametagInfo] = useState(false)

  useEffect(() => { ensureBase() }, [])
  useEffect(() => { recordEarnedEggs(); backfillHoloMomentum() }, [s.entries.length, Math.floor(now / 60000)])

  const z = useMemo(() => zooState(s, now), [s, now])
  const momentumDays = useMemo(() => goldenStreakDays(s.entries, now), [s.entries, Math.floor(now / 60000)])
  const tier = momentumTier(momentumDays)
  const [trade, setTrade] = useState(null) // {from, picks: []} - a trade-up being picked
  if (!catalog) return <div class="empty"><Spinner /></div>
  const found = everFound(s)
  const rarityOfId = (id) => catalog.find((a) => a.id === id)?.rarity
  const heldOfTier = (r) => Object.entries(z.copies).filter(([id]) => rarityOfId(id) === r).reduce((t, [, l]) => t + l.length, 0)
  const startTradeOf = (r) => { setTrade({ from: r, picks: [] }); setTimeout(() => document.getElementById('zoo-collection')?.scrollIntoView({ behavior: 'smooth' }), 0) }
  // Like the phone: a tier shows only once there's a coloured egg to hatch or enough to trade up.
  const tierRows = RARITIES.map((r) => ({ r, eggs: z.coloured[r], canTrade: !!nextRarity(r) && heldOfTier(r) >= TRADE_UP_COUNT })).filter((t) => t.eggs > 0 || t.canTrade)
  const ready = z.boxesReady > 0

  return (
    <>
      <div class="row" style="align-items:center;margin-bottom:16px">
        <h1 class="page-title grow" style="margin:0">Zoo</h1>
        {/* Weekly/Monthly challenges - their rewards land here, so they live here (a dot while one waits). */}
        {nav && <ChallengesButton nav={nav} />}
        {/* Nametags held - a currency, spent naming an animal from its card (ZooScreen.kt NametagCount). */}
        <button class="nametag-count" title={`${nametagsOf(s).held} nametags - what are these?`} onClick={() => setNametagInfo(true)}><Icon name="sell" size={15} /><b>{nametagsOf(s).held}</b></button>
      </div>
      {Object.keys(z.copies).some((id) => z.copies[id]?.length) && <TrophyCase catalog={catalog} copies={z.copies} />}
      {/* One page, like the phone: the eggs (compact), then the collection below. */}
      <div class="egg-card compact" onClick={() => setOdds(true)} title="Hatch rates">
        <div class="egg-stage">
          <div class="egg-glow" style={{ opacity: ready ? 1 : 0.3 }} />
          <div class={ready ? 'wobble' : ''}><Egg rarity="BOX" width={40} glow={ready ? 12 : 2} style={{ opacity: ready ? 1 : 0.45 }} /></div>
        </div>
        <div class="grow" style="min-width:0">
          <div class="title-small" style="font-weight:700">{ready ? `${z.boxesReady} egg${z.boxesReady === 1 ? '' : 's'} ready to hatch` : 'No egg ready yet'}</div>
          <div class="bar" style="margin-top:8px;height:6px"><div style={{ width: `${z.boxProgress * 100}%` }} /></div>
          <div class="muted tiny ellipsis" style="margin-top:5px">{z.timeToNextBox} remaining{ready ? '' : ' · tap for hatch rates'}</div>
          {tier && <div class={`tiny ellipsis tier-${tier.id}`} style="margin-top:2px;color:var(--tier-ink);font-weight:650">{tier.name} Momentum = {holoChancePercent(momentumDays)}% holo chance</div>}
        </div>
        {ready && <button class="glow-pill small" onClick={(e) => { e.stopPropagation(); setHatching('BOX') }}>Hatch</button>}
      </div>
      {/* Trading up isn't advertised here: a long-press on an animal in the collection starts it. */}
      {tierRows.filter((t) => t.eggs > 0).map(({ r, eggs, canTrade }) => (
        <div key={r} class="crate-row" style={{ borderColor: RARITY_COLOR[r] + '99' }}>
          <div class={eggs > 0 ? 'wobble' : ''}><Egg rarity={r} width={44} glow={eggs > 0 ? 12 : 0} /></div>
          <div class="grow">
            <div class="title-medium">{RARITY_LABEL[r]} egg{eggs > 1 ? ` ×${eggs}` : ''}</div>
            <div class="muted small">{eggs > 0 ? `Hatches a ${RARITY_LABEL[r]} animal` : `Trade ${TRADE_UP_COUNT} for a ${RARITY_LABEL[nextRarity(r)]} egg`}</div>
          </div>
          {eggs > 0 && <button class="btn small" onClick={() => setHatching(r)}>Hatch</button>}
          {canTrade && <button class="btn tonal small" onClick={() => startTradeOf(r)}>Trade up</button>}
        </div>
      ))}
      <div id="zoo-collection" style="margin-top:12px">
        <Collection catalog={catalog} copies={z.copies} found={found} trophyId={s.zoo.trophyId} trade={trade} setTrade={setTrade} />
      </div>
      {odds && <OddsDialog currentTier={tier} onClose={() => setOdds(false)} />}
      {nametagInfo && <NametagInfo held={nametagsOf(s).held} animal={(catalog || []).find((a) => z.copies?.[a.id]?.length) || (catalog || []).find((a) => a.id === 'fennec_fox') || catalog?.[0]} onClose={() => setNametagInfo(false)} />}
      {hatching && <HatchDialog kind={hatching} onClose={() => setHatching(null)} />}
    </>
  )
}

/** The phone's egg (Egg.kt), drawn as an SVG: narrower at the top, filled with the rarity's
 *  colours (the theme's for an ordinary egg), shaded toward the bottom with a highlight up top and
 *  a few speckles. [crack] (0..1) draws a zigzag crack across it from the left. */
export function Egg({ rarity, width = 84, crack = 0, style, onClick, glow = 0 }) {
  const w = 100, h = 125
  const id = useMemo(() => `egg${Math.random().toString(36).slice(2, 8)}`, [])
  const stops = rarity === 'RAINBOW' ? RAINBOW : (LOOK[rarity] || LOOK.BOX)
  const pts = [[0.08, 0.55], [0.24, 0.47], [0.38, 0.58], [0.52, 0.46], [0.66, 0.57], [0.8, 0.47], [0.92, 0.54]]
  const shown = (pts.length - 1) * Math.min(1, Math.max(0, crack))
  let crackPath = ''
  pts.forEach(([x, y], i) => {
    if (i > shown + 1) return
    if (i === 0) { crackPath += `M${x * w} ${y * h}`; return }
    const f = Math.min(1, Math.max(0, shown - (i - 1)))
    const [px, py] = pts[i - 1]
    crackPath += ` L${(px + (x - px) * f) * w} ${(py + (y - py) * f) * h}`
  })
  const shape = `M${w / 2} 0 C${w * 0.92} 0 ${w} ${h * 0.52} ${w} ${h * 0.64} C${w} ${h * 0.88} ${w * 0.78} ${h} ${w / 2} ${h} C${w * 0.22} ${h} 0 ${h * 0.88} 0 ${h * 0.64} C0 ${h * 0.52} ${w * 0.08} 0 ${w / 2} 0Z`
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={width} height={width * 1.25} onClick={onClick} class="egg-svg"
      style={{ overflow: 'visible', filter: glow ? `drop-shadow(0 ${glow / 3}px ${glow}px color-mix(in srgb, ${stops[0]} 70%, transparent))` : undefined, ...style }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">{stops.map((c, i) => <stop key={i} offset={stops.length === 1 ? 0 : i / (stops.length - 1)} style={{ stopColor: c }} />)}</linearGradient>
        <linearGradient id={id + 's'} x1="0" y1="0" x2="0" y2="1"><stop offset="0.45" stop-color="#000" stop-opacity="0" /><stop offset="1" stop-color="#000" stop-opacity=".18" /></linearGradient>
      </defs>
      <path d={shape} fill={`url(#${id})`} />
      <path d={shape} fill={`url(#${id}s)`} />
      <ellipse cx={w * 0.35} cy={h * 0.22} rx={w * 0.11} ry={h * 0.1} fill="#fff" fill-opacity=".35" />
      {[[0.66, 0.38, 0.045], [0.3, 0.58, 0.035], [0.6, 0.74, 0.05], [0.42, 0.86, 0.03]].map(([x, y, r], i) => <circle key={i} cx={x * w} cy={y * h} r={r * w} fill="#fff" fill-opacity=".32" />)}
      {crack > 0.01 && <path d={crackPath} fill="none" stroke="#000" stroke-opacity=".45" stroke-width={w * 0.035} stroke-linecap="round" stroke-linejoin="round" />}
    </svg>
  )
}

/** A rarity's pill, in its colours (the phone's RarityPill). */
// [width] is a minimum: the pills line up, but one whose label runs wider (a wider font) grows to fit.
function RarityPillInline({ rarity, width }) {
  return <span class={`rarity-pill-inline ${rarity === 'RAINBOW' ? 'shimmer' : ''}`} style={{ backgroundImage: rarityBrush(rarity), minWidth: width }}>{RARITY_LABEL[rarity]}</span>
}

/** "Egg hatch rates", like the phone's LootBoxOddsDialog: each tier's chance as a bar in its
 *  colours (never how many animals a tier holds), and Momentum's foil chance. */
function OddsDialog({ currentTier, onClose }) {
  const [preview, setPreview] = useState(false)
  const fennec = useCatalog()?.find((x) => x.id === 'fennec_fox')
  const set = Object.fromEntries(LOOT_BOX_ODDS)
  const rest = 100 - LOOT_BOX_ODDS.reduce((a, [, p]) => a + p, 0)
  const pct = (v) => (v >= 10 || v === Math.floor(v) ? `${Math.round(v)}%` : `${v.toFixed(1)}%`)
  // Preview: a holo Fennec fox in place of the rates, Close returning to them.
  if (preview && fennec) {
    return (
      <CardStage rarity={fennec.rarity} onClose={() => setPreview(false)}>
        <div class="col" style="align-items:center;gap:16px">
          <Floaty><AnimalCardView animal={fennec} cert={{ foil: true }} /></Floaty>
          <div class="stage-row" style="width:100%"><GlowPill rarity={fennec.rarity} solid onClick={() => setPreview(false)}>Close</GlowPill></div>
        </div>
      </CardStage>
    )
  }
  return (
    <CardStage rarity="BOX" onClose={onClose}>
      <div class="zoo-panel" style={{ backgroundImage: 'linear-gradient(var(--c-high), var(--c-high)), linear-gradient(135deg, var(--primary), var(--tertiary))' }}>
        <div class="title-large" style="font-weight:700">Egg hatch rates</div>
        <div class="muted" style="font-size:12px;margin:2px 0 10px">You earn an egg every {HOURS_PER_BOX} hours of immersion.</div>
        {[...RARITIES].reverse().map((t) => {
          const c = set[t] ?? rest
          return (
            <div key={t} class="odds-row">
              <RarityPillInline rarity={t} width={96} />
              <div class="odds-track"><div class={t === 'RAINBOW' ? 'shimmer' : ''} style={{ width: `${c}%`, backgroundImage: rarityBrush(t) }} /></div>
              <b>{pct(c)}</b>
            </div>
          )
        })}
        <div class="foil-hint" style="display:block">
          {/* A small Preview beside the hint - the holo card opens on its own, so this stays the same size. */}
          <div class="row" style="align-items:center;gap:8px;margin:0 0 6px 4px">
            <div class="small grow">Momentum gives eggs a Holo chance</div>
            <button class="chip-btn" onClick={() => setPreview(true)}>Preview</button>
          </div>
          <MomentumTierTable current={currentTier} topTierFirst />
        </div>
        <div class="stage-row" style="margin-top:20px"><GlowPill rarity="BOX" solid onClick={onClose}>Close</GlowPill></div>
      </div>
    </CardStage>
  )
}

/** Soft rays turning slowly behind something, in the look's colours. */
function Sunburst({ rarity, scale = 1, alpha = 0.35 }) {
  const [p, s2] = rarity === 'RAINBOW' ? [RAINBOW[0], RAINBOW[3]] : (LOOK[rarity] || LOOK.BOX)
  const rays = Array.from({ length: 14 }, (_, i) => {
    const a0 = (i * 2 * Math.PI) / 14, a1 = a0 + (Math.PI / 14) * 0.7
    return `M50 50 L${50 + 50 * Math.cos(a0)} ${50 + 50 * Math.sin(a0)} L${50 + 50 * Math.cos(a1)} ${50 + 50 * Math.sin(a1)}Z`
  })
  return (
    <svg viewBox="0 0 100 100" class="sunburst" style={{ transform: `scale(${scale})` }}>
      <defs>
        <radialGradient id="sb-a"><stop offset="0" style={{ stopColor: p, stopOpacity: alpha }} /><stop offset="1" style={{ stopColor: p, stopOpacity: 0 }} /></radialGradient>
        <radialGradient id="sb-b"><stop offset="0" style={{ stopColor: s2, stopOpacity: alpha }} /><stop offset="1" style={{ stopColor: s2, stopOpacity: 0 }} /></radialGradient>
      </defs>
      <g class="sunburst-spin">{rays.map((d, i) => <path key={i} d={d} fill={`url(#sb-${i % 2 ? 'b' : 'a'})`} />)}</g>
    </svg>
  )
}

/** Hatching, like the phone's CrateOpenDialog: the egg wobbles until tapped (anywhere), then shakes
 *  harder and cracks as its glow swells over a second, and the card springs out over a slowly
 *  turning sunburst with "NEW!" or how many you now have (and FOIL!). */
/** Hatching an egg: it wobbles until tapped, shakes and cracks, then shows what was inside.
 *  `hatch` (a Weekly/Monthly reward) supplies the animal instead of using up a Zoo egg. */
export function HatchDialog({ kind, onClose, hatch }) {
  const s = useStore()
  const [round, setRound] = useState(0)
  const [charge, setCharge] = useState(0)
  const [tapped, setTapped] = useState(false)
  const [result, setResult] = useState(null)
  const [revealed, setRevealed] = useState(false)
  const [t, setT] = useState(0)
  const z = zooState(s)
  const left = hatch ? 0 : kind === 'BOX' ? z.boxesReady : z.coloured[kind]

  // The shake's own clock, and the charge building over a second once tapped.
  useEffect(() => {
    if (revealed) return
    let raf, start = null
    const step = (now) => {
      setT(now)
      if (tapped) {
        if (start == null) start = now
        setCharge(Math.min(1, (now - start) / 1000))
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [tapped, revealed, round])

  const tap = async () => {
    if (tapped) return
    setTapped(true)
    const r = await (hatch ? hatch() : kind === 'BOX' ? hatchLootEgg() : hatchColouredEgg(kind))
    if (!r) { toast('No egg to hatch'); onClose(); return }
    // The card never shows before its photo: it's fetched while the egg shakes (at most 3 s).
    if (r.animal.image) await Promise.race([new Promise((res) => { const im = new Image(); im.onload = im.onerror = res; im.src = r.animal.image }), new Promise((res) => setTimeout(res, 3000))])
    setResult(r)
  }
  useEffect(() => { if (result && charge >= 1) setRevealed(true) }, [result, charge])
  const again = () => { setResult(null); setRevealed(false); setTapped(false); setCharge(0); setRound(round + 1) }

  const shake = Math.sin((t / 140) * 2 * Math.PI) * (2 + 14 * charge * charge)
  const look = revealed ? result.animal.rarity : kind
  const onDisplay = revealed && s.zoo.trophyId === result.animal.id
  if (!revealed) {
    return (
      <CardStage rarity={look} onClose={tap}>
        <div class="crate-stage" onClick={tap}>
          <div class="crate-box">
            <Sunburst rarity={look} scale={0.6 + 0.6 * charge} alpha={0.25 + 0.5 * charge} />
            <div class="crate-glow" style={{ transform: `scale(${0.7 + 0.5 * charge})`, opacity: 0.4 + charge, '--p': (LOOK[look] || LOOK.BOX)[0] }} />
            <Egg rarity={kind} width={108} crack={(charge - 0.35) / 0.65} glow={10 + 30 * charge}
              style={{ transform: `rotate(${shake}deg) scale(${1 + 0.08 * charge})`, position: 'relative' }} />
          </div>
          <div class="title-large" style="color:#fff;font-weight:700">{kind === 'BOX' ? 'Egg' : `${RARITY_LABEL[kind]} egg`}</div>
          <div style="color:rgba(255,255,255,.75);font-size:12px;margin-top:4px">Tap to hatch</div>
        </div>
      </CardStage>
    )
  }
  const r = result.animal.rarity
  return (
    <CardStage rarity={r} onClose={onClose}>
      {/* A holo copy gets the same celebration wherever it comes from (Sprints.jsx HoloCelebration). */}
      {result.cert?.foil ? <HoloCelebration result={result} bannerPrefix={result.copies === 1 ? 'NEW!' : `You now have ×${result.copies}`} /> : (
      <div class="reveal-pop">
        <Floaty>
          <div style="position:relative">
            <div class="reveal-burst"><Sunburst rarity={r} scale={1.25} /></div>
            <div class="col" style="align-items:center;position:relative">
              <span class={`reveal-banner ${r === 'RAINBOW' ? 'shimmer' : ''}`} style={{ backgroundImage: rarityBrush(r), '--p': (LOOK[r] || LOOK.GREEN)[0] }}>
                {result.copies === 1 ? 'NEW!' : `You now have ×${result.copies}`}{result.cert?.foil ? '  ✦ HOLO!' : ''}
              </span>
              <div style="width:100%"><AnimalCardView animal={result.animal} cert={result.cert} timesFound={result.copies} onDisplay={onDisplay} nickname={nametagsOf(s).names[result.animal.id]} /></div>
            </div>
          </div>
        </Floaty>
      </div>
      )}
      <div class="stage-row">
        {!onDisplay && <GlowPill rarity={r} onClick={() => { setTrophy(result.animal.id); toast('On display on your profile') }}>Show on my profile</GlowPill>}
        <GlowPill rarity={r} onClick={onClose}>Nice!</GlowPill>
      </div>
      {left > 0 && <GlowPill rarity={r} onClick={again}>Hatch another ({left})</GlowPill>}
    </CardStage>
  )
}

/** A trade-up played out, like the phone's TradeUpCelebration: the animals given up turn on a ring,
 *  glide into the middle and fade as the glow swells, then an egg of the next colour pops out in a
 *  burst of sparks. */
function TradeUpCelebration({ from, to, given, onOpenNow, onClose }) {
  const [ms, setMs] = useState(0)
  useEffect(() => {
    let raf, start = null
    const step = (now) => { if (start == null) start = now; setMs(now - start); if (now - start < 16000) raf = requestAnimationFrame(step) }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [])
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
  const clamp01 = (x) => Math.max(0, Math.min(1, x))
  const merge = ease(clamp01((ms - 350) / 1100))
  const after = ms - 1450
  const burst = after > 0 ? ease(clamp01(after / 900)) : 0
  const spring = (x) => (x <= 0 ? 0 : 1 - Math.exp(-6 * x) * Math.cos(9 * x))
  const keyPop = after > 0 ? spring(after / 1000) : 0
  const textIn = clamp01((after - 250) / 400)
  const done = merge >= 1
  const turn = (ms / 14000) * 360
  const [fp] = LOOK[from], [tp, ts] = to === 'RAINBOW' ? [RAINBOW[0], RAINBOW[3]] : LOOK[to]
  const swell = 0.35 + 0.65 * merge
  return (
    <CardStage rarity={to} onClose={() => done && onClose()}>
      <div class="zoo-panel center" style={{ backgroundImage: `linear-gradient(var(--c-high), var(--c-high)), ${done ? rarityBrush(to) : rarityBrush(from)}`, padding: 24 }}>
        <div class="title-large" style="font-weight:700">Trade up to {RARITY_LABEL[to]}</div>
        <div class="trade-stage">
          <div class="trade-glow" style={{ transform: `scale(${swell})`, background: `radial-gradient(closest-side, color-mix(in srgb, ${done ? tp : fp} ${55 * swell}%, transparent), transparent)` }} />
          {burst > 0.01 && burst < 0.99 && Array.from({ length: 16 }, (_, i) => {
            const a = (i * 2 * Math.PI) / 16, r = 220 * (0.15 + 0.35 * burst), d = 2 * (7 * (1 - burst) + 2) / 2
            return <span key={i} class="spark" style={{ width: d, height: d, background: i % 2 ? ts : tp, opacity: 1 - burst, transform: `translate(${r * Math.cos(a)}px, ${r * Math.sin(a)}px)` }} />
          })}
          {!done && given.map((animal, i) => {
            const ang = ((turn + (i * 360) / given.length) * Math.PI) / 180, rad = 80 * (1 - merge)
            return (
              <div key={i} class="trade-tile" style={{ transform: `translate(${rad * Math.cos(ang)}px, ${rad * Math.sin(ang)}px) scale(${1 - 0.6 * merge})`, opacity: 1 - merge * merge, borderColor: fp, boxShadow: `0 4px 14px color-mix(in srgb, ${fp} 60%, transparent)` }}>
                <AnimalPhoto animal={animal} />
              </div>
            )
          })}
          {keyPop > 0 && <div style={{ position: 'absolute', transform: `scale(${0.4 + 0.6 * keyPop}) rotate(${-20 + 20 * keyPop}deg)` }}><Egg rarity={to} width={76} glow={24} /></div>}
        </div>
        <div style={{ opacity: textIn, width: '100%' }}>
          <div style="font-size:24px;font-weight:700">+1 {RARITY_LABEL[to]} egg</div>
          <div class="muted" style="margin-top:4px">Hatches a {RARITY_LABEL[to]} animal</div>
          <div class="stage-row" style="margin-top:20px">
            <GlowPill rarity="NEUTRAL" solid disabled={!done} onClick={onClose}>Nice!</GlowPill>
            <GlowPill rarity={to} solid disabled={!done} onClick={onOpenNow}>Hatch it now</GlowPill>
          </div>
        </div>
      </div>
    </CardStage>
  )
}

/** The big card: photo (with foil sheen), name, rarity, facts and the birth certificate. */
/* ------------------------------------------------------------------------------------------------
 * The trading card and the glowing stage it's shown on - a port of the phone's AnimalCard.kt and
 * RarityStyle.kt: rarity colours (Mythic's pearly shimmer sliding along), a Mythic's cut corners and
 * corner ornaments, a Legendary's gold halo, a foil's holographic sheen, glints and pearly border,
 * and the slow weightless float.
 * --------------------------------------------------------------------------------------------- */

const LOOK = { GREEN: ['#3FBF5F', '#B4F06A'], BLUE: ['#3D8BFF', '#45D4FF'], PURPLE: ['#A64DFF', '#FF5CD6'], ORANGE: ['#FF8A00', '#FFD23F'], RAINBOW: ['#5CF2E6', '#E58CFF'], BOX: ['var(--primary)', 'var(--tertiary)'], NEUTRAL: ['#9AA3AD', '#D9DEE3'] }
const RAINBOW = ['#5CF2E6', '#6FC8FF', '#A98BFF', '#E58CFF', '#FF8FCB', '#FFD86B', '#9DF5B5']
const FOIL = ['#9FF7EE', '#B3D9FF', '#D7C2FF', '#FFC2EC', '#FFE9A8', '#C4FFD2']
const hexA = (c, a) => `color-mix(in srgb, ${c} ${Math.round(a * 100)}%, transparent)`
/** What borders, pills and keys are painted with: the rarity's two colours, or for a Mythic a
 *  band of its shimmer sliding along (the .shimmer class moves it). */
export const rarityBrush = (rarity) => (rarity === 'RAINBOW'
  ? `linear-gradient(115deg, ${[...RAINBOW, ...RAINBOW, RAINBOW[0]].join(', ')})`
  : `linear-gradient(135deg, ${(LOOK[rarity] || LOOK.BOX)[0]}, ${(LOOK[rarity] || LOOK.BOX)[1]})`)
const FOIL_BORDER = `linear-gradient(115deg, ${[...FOIL, ...FOIL, FOIL[0]].join(', ')})`
const STATUS_COLOR = [['extinct', '#B45CFF'], ['critically', '#E53935'], ['endangered', '#FF7A1A'], ['vulnerable', '#E6B800'], ['near threatened', '#9CC23A'], ['least concern', '#3FAF5F']]
const statusColor = (st) => (STATUS_COLOR.find(([k]) => st.toLowerCase().includes(k)) || [null, '#8A939C'])[1]

/** A small seeded random, so each animal's foil glints sit in their own places. */
function seeded(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296 }
}

/* ------------------------------------------------------------------------------------------------ */
/* Foil - a port of the phone's foilSheen (AnimalCard.kt): a 9-column grid of triangular facets,
   each throwing its own rainbow colour (screened over the photo), faint facet edges, a spectrum
   band (overlay) and a soft vignette, with the photo itself a little punchier (CSS). The phone
   drives it by tilt; here a slow, constant loop stands in for the tilt, through the same formulas. */

const PRISM_COLUMNS = 9
const FOIL_LOOP_MS = 12000
const foilDrawers = new Set()
let foilFrame = 0
let foilLast = 0
function foilTick(t) {
  foilFrame = 0
  if (!foilDrawers.size) return
  if (t - foilLast >= 33) { // ~30 fps is plenty for a slow shimmer
    foilLast = t
    const turn = ((t % FOIL_LOOP_MS) / FOIL_LOOP_MS) * Math.PI * 2
    const tilt = { x: 0.6 * Math.sin(turn), y: 0.4 * Math.cos(turn) }
    foilDrawers.forEach((draw) => draw(tilt))
  }
  foilFrame = requestAnimationFrame(foilTick)
}
function addFoilDrawer(draw) {
  foilDrawers.add(draw)
  if (!foilFrame) foilFrame = requestAnimationFrame(foilTick)
  return () => foilDrawers.delete(draw)
}
const SPECTRUM = [0, 50, 110, 180, 230, 290, 340]
const hsv = (h, s, v, a) => {
  const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)) }
  return `rgba(${Math.round(f(5) * 255)},${Math.round(f(3) * 255)},${Math.round(f(1) * 255)},${a})`
}

export function FoilSheen({ seed = '' }) {
  const facetsRef = useRef(null)
  const bandRef = useRef(null)
  useEffect(() => {
    const facetsCanvas = facetsRef.current
    const bandCanvas = bandRef.current
    if (!facetsCanvas || !bandCanvas) return
    const rand = seeded(String(seed) + ':prism')
    const seeds = Array.from({ length: PRISM_COLUMNS * 40 * 2 }, rand)
    let w = 0, h = 0, dpr = 1, facets = []
    const layout = () => {
      const box = facetsCanvas.parentElement.getBoundingClientRect()
      dpr = Math.min(2, window.devicePixelRatio || 1)
      w = box.width; h = box.height
      for (const c of [facetsCanvas, bandCanvas]) { c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr)) }
      const cell = w / PRISM_COLUMNS
      const rows = Math.ceil(h / cell)
      facets = []
      for (let row = 0; row < rows; row++) for (let col = 0; col < PRISM_COLUMNS; col++) {
        const x0 = col * cell, y0 = row * cell, flip = (row + col) % 2 === 0
        const a = flip ? [[x0, y0], [x0 + cell, y0], [x0, y0 + cell]] : [[x0, y0], [x0 + cell, y0], [x0 + cell, y0 + cell]]
        const b = flip ? [[x0 + cell, y0], [x0 + cell, y0 + cell], [x0, y0 + cell]] : [[x0, y0], [x0 + cell, y0 + cell], [x0, y0 + cell]]
        for (const tri of [a, b]) facets.push({ tri, at: { x: (tri[0][0] + tri[1][0] + tri[2][0]) / 3 / w, y: (tri[0][1] + tri[1][1] + tri[2][1]) / 3 / h } })
      }
    }
    const draw = (tilt) => {
      if (!w) return
      const fc = facetsCanvas.getContext('2d')
      fc.setTransform(dpr, 0, 0, dpr, 0, 0)
      fc.clearRect(0, 0, w, h)
      facets.forEach(({ tri, at }, i) => {
        const sd = seeds[i % seeds.length]
        const hue = (((at.x * 220 + at.y * 140 + sd * 70 + tilt.x * 260 - tilt.y * 180) % 360) + 360) % 360
        const c = Math.max(0, Math.cos(sd * 6.28 + tilt.x * 4 + tilt.y * 3 + (at.x - at.y) * 2))
        fc.beginPath(); fc.moveTo(tri[0][0], tri[0][1]); fc.lineTo(tri[1][0], tri[1][1]); fc.lineTo(tri[2][0], tri[2][1]); fc.closePath()
        fc.fillStyle = hsv(hue, 0.55, 1, 0.05 + 0.16 * c * c)
        fc.fill()
        if (i % 2 === 0) { fc.strokeStyle = 'rgba(255,255,255,.035)'; fc.lineWidth = 0.6; fc.stroke() }
      })
      const bc = bandCanvas.getContext('2d')
      bc.setTransform(dpr, 0, 0, dpr, 0, 0)
      bc.clearRect(0, 0, w, h)
      const along = 0.3 + 0.35 * tilt.x - 0.25 * tilt.y
      const ox = w * (along - 0.5), oy = h * (along - 0.5)
      const g = bc.createLinearGradient(ox + w * 0.25, oy + h * 0.25, ox + w * 0.75, oy + h * 0.75)
      g.addColorStop(0, 'rgba(0,0,0,0)')
      SPECTRUM.forEach((hue, k) => g.addColorStop((k + 1) / (SPECTRUM.length + 1), hsv(hue, 0.6, 1, 0.08)))
      g.addColorStop(1, 'rgba(0,0,0,0)')
      bc.fillStyle = g
      bc.fillRect(0, 0, w, h)
    }
    layout()
    const ro = new ResizeObserver(layout)
    ro.observe(facetsCanvas.parentElement)
    const remove = addFoilDrawer(draw)
    return () => { ro.disconnect(); remove() }
  }, [seed])
  return (
    <div class="foil-sheen">
      <canvas ref={facetsRef} class="foil-facets" />
      <canvas ref={bandRef} class="foil-band" />
    </div>
  )
}

function FoilGlints({ seed }) {
  const glints = useMemo(() => {
    const r = seeded(seed)
    return Array.from({ length: 6 }, () => ({ x: 8 + r() * 84, y: 5 + r() * 90, offset: r(), scale: 0.6 + r() * 0.6 }))
  }, [seed])
  return glints.map((g, i) => (
    <svg key={i} class="foil-glint" viewBox="-12 -12 24 24" style={{ left: `${g.x}%`, top: `${g.y}%`, width: 26 * g.scale, height: 26 * g.scale, animationDelay: `${-g.offset * 3.6}s` }}>
      <circle r="11" fill="url(#glint-halo)" />
      <path d="M0 -11 Q0 0 11 0 Q0 0 0 11 Q0 0 -11 0 Q0 0 0 -11Z" fill="#fff" />
      <circle r="2" fill="#fff" />
    </svg>
  ))
}

/** A closed polygon through [corners] ([x, y, radius]), every corner softened: the edges stop short
 *  by its radius and a curve joins them (the phone's roundedPolygon). As an SVG path. */
function roundedPolygon(corners) {
  const toward = (a, b, r) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy)
    if (!len) return [a[0], a[1]]
    const k = Math.min(r, len / 2) / len
    return [a[0] + dx * k, a[1] + dy * k]
  }
  let d = ''
  corners.forEach(([x, y, r], i) => {
    const prev = corners[(i + corners.length - 1) % corners.length], next = corners[(i + 1) % corners.length]
    const a = toward([x, y], prev, r), b = toward([x, y], next, r)
    d += `${i ? 'L' : 'M'}${a[0].toFixed(2)} ${a[1].toFixed(2)} Q${x} ${y} ${b[0].toFixed(2)} ${b[1].toFixed(2)} `
  })
  return d + 'Z'
}

/** A Mythic card's outline at [w]x[h], inset by [b] (0 = the outer edge): rounded top corners, the
 *  bottom two cut off at an angle and softly rounded (the phone's MythicCardShape). */
function mythicPath(w, h, b = 0) {
  const c = Math.min(w * 0.16, h * 0.2)
  const ci = c - b * (2 - Math.SQRT2)
  const W = w - 2 * b, H = h - 2 * b
  const top = Math.max(0, c * 0.7 - b), bot = Math.max(0, c * 0.3 - b * 0.4)
  return roundedPolygon([[0, 0, top], [W, 0, top], [W, H - ci, bot], [W - ci, H, bot], [ci, H, bot], [0, H - ci, bot]])
}

/** A Mythic's corner pieces: a softly rounded triangle in each bottom corner its shape cuts away,
 *  set back a little from the cut, filled with the shimmer streaming outward toward the tip. */
function MythicCorners({ w, h, id }) {
  const c = Math.min(w * 0.16, h * 0.2)
  const leg = c - 4 * Math.SQRT2
  if (leg <= 0) return null
  const round = leg * 0.22, band = leg * 3.5
  const corner = (x, y, dx, side) => {
    const d = roundedPolygon([[x, y, round], [x + dx * leg, y, round], [x, y - leg, round]])
    const ix = x + (dx * leg) / 2, iy = y - leg / 2
    const ox = x - ix, oy = y - iy, len = Math.hypot(ox, oy)
    const ux = ox / len, uy = oy / len
    const gid = `${id}-${side}`
    return (
      <g key={side}>
        <defs>
          <linearGradient id={gid} gradientUnits="userSpaceOnUse" spreadMethod="repeat" x1={ix} y1={iy} x2={ix + ux * band} y2={iy + uy * band}>
            {[...RAINBOW, RAINBOW[0]].map((col, i) => <stop key={i} offset={i / RAINBOW.length} stop-color={col} />)}
            <animateTransform attributeName="gradientTransform" type="translate" from="0 0" to={`${ux * band} ${uy * band}`} dur="6s" repeatCount="indefinite" />
          </linearGradient>
        </defs>
        <path d={d} fill={`url(#${gid})`} />
      </g>
    )
  }
  return <svg class="mythic-corners" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>{corner(0, h, 1, 'l')}{corner(w, h, -1, 'r')}</svg>
}

/** The size of an element, kept up to date. */
function useSize(ref) {
  const [size, setSize] = useState(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize([el.offsetWidth, el.offsetHeight]))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return size
}

/** The full trading card: photo (rarity pill, chips), names, Wikipedia's one-liner, stats, the
 *  fun fact, its birth certificate, conservation status and the photo credit. */
export function AnimalCardView({ animal, cert, timesFound = 1, onDisplay = false, nickname = null, onNameClick = null }) {
  const [p, s2] = LOOK[animal.rarity] || LOOK.GREEN
  const mythic = animal.rarity === 'RAINBOW'
  const foil = !!cert?.foil
  // The holo pill wears the Momentum tier its egg was earned with (white when unknown).
  const holoTier = foil && cert.momentumDays != null ? momentumTier(cert.momentumDays) : null
  const hasCert = cert && (cert.hourMark != null || cert.languageName)
  const wrapRef = useRef(null)
  const size = useSize(wrapRef)
  const border = mythic || foil ? 3 : 2
  const tint = usePhotoTint(animal.image)
  // Each card's own wash: its photo's bottom colour running on down into the details and fading,
  // with a faint glow of the rarity in the far corner.
  const wash = [
    tint && `linear-gradient(to bottom, rgba(${tint}, .22) 0%, rgba(${tint}, .07) 55%, transparent 100%)`,
    `radial-gradient(circle at 100% 100%, ${hexA(s2, 0.09)}, transparent 70%)`,
  ].filter(Boolean).join(', ')
  // A Mythic's shape is measured and drawn as a path - CSS polygons can't round its corners.
  const outer = mythic && size ? { clipPath: `path('${mythicPath(size[0], size[1])}')` } : {}
  const inner = mythic && size ? { clipPath: `path('${mythicPath(size[0], size[1], border)}')`, borderRadius: 0 } : {}
  return (
    <div ref={wrapRef} class={`acard-wrap ${animal.rarity === 'ORANGE' ? 'legendary' : ''} ${mythic ? 'mythic' : ''}`} style={{ '--p': p, '--s': s2 }}>
      <div class={`acard-frame ${mythic ? 'shimmer' : ''} ${foil ? 'foil-border' : ''}`}
        style={{ backgroundImage: foil ? FOIL_BORDER : rarityBrush(animal.rarity), padding: border, ...outer, ...(mythic ? { borderRadius: 0 } : {}) }}>
        <div class="acard" style={inner}>
          <div class="photo">
            <AnimalPhoto animal={animal} />
            {foil && <FoilSheen seed={animal.id} />}
            <div class="photo-rule" />
            <span class={`rarity-pill ${mythic ? 'shimmer' : ''}`} style={{ backgroundImage: rarityBrush(animal.rarity) }}>{RARITY_LABEL[animal.rarity]}</span>
            <div class="corner-chips">
              {foil && <span class={holoTier ? `holo-tier tier-${holoTier.id}` : ''}>✦ Holo</span>}
              {onDisplay && <span>🏆</span>}
              {timesFound > 1 && <span>×{timesFound}</span>}
            </div>
          </div>
          <div class="acard-body" style={{ paddingBottom: mythic ? 26 : 16, backgroundImage: wash }}>
            {/* A nametag's name takes the title; the species sits under it. */}
            <div class="acard-title">
              <div style="min-width:0">
                {nickname ? <><div class="acard-name">“{nickname}”</div><div class="acard-species">{animal.name}</div></> : <div class="acard-name">{animal.name}</div>}
              </div>
              {/* On this person's own card: a round tag button that starts naming it (ZooScreen.kt NameTagButton). */}
              {onNameClick && <button class="name-tag-btn" title="Name" aria-label="Name" onClick={(e) => { e.stopPropagation(); onNameClick() }}><Icon name="sell" size={17} /></button>}
            </div>
            {animal.scientific && <div class="acard-sci">{animal.scientific}</div>}
            {animal.blurb && <div class="acard-blurb">{animal.blurb}</div>}
            {animal.stats?.length > 0 && (
              <div class="acard-stats">
                {animal.stats.slice(0, 3).map((st) => <div key={st.label} style={{ background: hexA(p, 0.12) }}><div class="k">{st.label}</div><div class="v">{st.value}</div></div>)}
              </div>
            )}
            {animal.fact && <div class="acard-fact"><span style={{ color: p }}>✦</span><span>{animal.fact}</span></div>}
            {hasCert && (
              <div class="acard-cert" style={{ background: `linear-gradient(${hexA(p, 0.08)}, ${hexA(p, 0.08)}) padding-box, linear-gradient(var(--c-high), var(--c-high)) padding-box, ${rarityBrush(animal.rarity)} border-box` }}>
                <div class="row"><span class="k grow">Birth certificate</span>{cert.hourMark != null && <b style={{ color: p }}>Hour {cert.hourMark.toLocaleString()}</b>}</div>
                {cert.languageName && <span class="lang" style={{ background: cert.languageColor || p }}>Born to {cert.languageName}</span>}
              </div>
            )}
            {animal.status && <span class="acard-status" style={{ color: statusColor(animal.status), background: hexA(statusColor(animal.status), 0.14) }}>{animal.status}</span>}
            <div class="acard-credit" style={mythic ? { textAlign: 'center', padding: '12px 30px 0' } : {}}>
              {animal.credit && `Photo: ${animal.credit} · `}
              {animal.url ? <a href={animal.url} target="_blank" rel="noopener">Wikipedia</a> : 'Wikipedia'}
            </div>
          </div>
          {foil && <FoilGlints seed={animal.id} />}
        </div>
      </div>
      {/* A Mythic's corner pieces, tucked into the corners its shape cuts away. */}
      {mythic && size && <MythicCorners w={size[0]} h={size[1]} id={`mc-${animal.id}`} />}
    </div>
  )
}

/** A card on its own glowing stage, like the phone's RarityGlowDialog: full screen, two breathing
 *  pools of the rarity's colours behind it (drifting through every colour for a Mythic), the card
 *  floating, and whatever goes under it. A tap outside closes. */
export function CardStage({ rarity, onClose, children }) {
  const [p, s2] = LOOK[rarity] || LOOK.GREEN
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div class="card-stage" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <svg width="0" height="0" style="position:absolute"><defs><radialGradient id="glint-halo"><stop offset="0" stop-color="#fff" stop-opacity=".5" /><stop offset="1" stop-color="#fff" stop-opacity="0" /></radialGradient></defs></svg>
      <div class="card-stage-inner">
        <div class={`glow-pools ${rarity === 'RAINBOW' ? 'rainbow' : ''}`} style={{ '--p': p, '--s': s2 }}><i class="a" /><i class="b" /></div>
        <div class="col" style="gap:14px;position:relative">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

/** The card itself, floating: a slow bob, a little sway and a degree of tilt, each on its own rhythm. */
export function Floaty({ children }) {
  return <div class="float-bob"><div class="float-sway"><div class="float-tilt">{children}</div></div></div>
}

/** The quiet pill buttons under a card: the card's surface, lightly washed and outlined in the rarity. */
export function GlowPill({ rarity, onClick, children, disabled, solid }) {
  const [p] = LOOK[rarity] || LOOK.GREEN
  if (solid) {
    return <button class={`glow-pill-soft solid ${rarity === 'RAINBOW' ? 'shimmer' : ''}`} disabled={disabled} onClick={onClick} style={{ backgroundImage: disabled ? 'linear-gradient(rgba(128,128,128,.35), rgba(128,128,128,.25))' : rarityBrush(rarity) }}>{children}</button>
  }
  return (
    <button class={`glow-pill-soft ${rarity === 'RAINBOW' ? 'shimmer-border' : ''}`} disabled={disabled} onClick={onClick}
      style={{ background: `linear-gradient(${hexA(p, 0.16)}, ${hexA(p, 0.16)}) padding-box, linear-gradient(var(--c-high), var(--c-high)) padding-box, ${rarityBrush(rarity)} border-box` }}>
      {children}
    </button>
  )
}

/** Only animals found so far (no silhouettes of the rest), rarest first - like the phone. A
 *  long-press (or right-click) on one starts a trade-up of its tier. */
function Collection({ catalog, copies, found, trophyId, trade, setTrade }) {
  const names = nametagsOf(useStore()).names
  const columns = Math.min(5, Math.max(2, useStore().settings.zooColumns || 4))
  const [open, setOpen] = useState(null)
  const held = Object.keys(copies).length
  const list = catalog
    .filter((a) => found.has(a.id))
    .filter((a) => !trade || a.rarity === trade.from)
    .sort((a, b) => RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()))

  const startTrade = (a) => {
    if (nextRarity(a.rarity) && copies[a.id]) setTrade({ from: a.rarity, picks: [a.id] })
  }
  const pick = (a) => {
    if (!trade) { setOpen(a); return }
    if (a.rarity !== trade.from || !copies[a.id]) return
    const n = trade.picks.filter((x) => x === a.id).length
    if (n < copies[a.id].length && trade.picks.length < TRADE_UP_COUNT) setTrade({ ...trade, picks: [...trade.picks, a.id] })
    else setTrade({ ...trade, picks: trade.picks.filter((x) => x !== a.id) })
  }
  const [celebrate, setCelebrate] = useState(null)
  const [hatchNow, setHatchNow] = useState(null)
  const doTrade = () => {
    const given = trade.picks.map((id) => catalog.find((a) => a.id === id)).filter(Boolean)
    const to = tradeUp(trade.from, trade.picks)
    if (to) setCelebrate({ from: trade.from, to, given })
    else toast("Couldn't trade those")
    setTrade(null)
  }

  return (
    <>
      <div class="row collection-head">
        <div class="section-header grow">Collection · {held}</div>
        {/* Cards per row, 2 to 5. */}
        <div class="col-pick" role="radiogroup" aria-label="Cards per row">
          {[2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={n === columns} class={n === columns ? 'on' : ''} title={`${n} per row`} onClick={() => setSetting('zooColumns', n)}>{n}</button>
          ))}
        </div>
      </div>
      {!trade && held > 0 && <div class="muted" style="font-size:12px;margin:-4px 0 10px">Long-press to trade up</div>}
      {!list.length ? <div class="empty">{!held ? 'No animals yet - hatch an egg to find your first.' : 'None of these yet.'}</div> : (
        <div class={`zoo-grid ${columns <= 3 ? 'roomy' : ''}`} style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
          {list.map((a) => {
            const have = copies[a.id]?.length || 0
            const picks = trade ? trade.picks.filter((x) => x === a.id).length : 0
            const foil = copies[a.id]?.some((c) => c.cert?.foil)
            let timer = null
            return (
              <div key={a.id} class={`tile-animal ${!have ? 'gone' : ''} ${picks ? 'picked' : ''}`} style={{ borderColor: RARITY_COLOR[a.rarity] }}
                onClick={() => pick(a)}
                onContextMenu={(e) => { e.preventDefault(); if (!trade) startTrade(a) }}
                onPointerDown={() => { if (!trade) timer = setTimeout(() => startTrade(a), 500) }}
                onPointerUp={() => clearTimeout(timer)} onPointerLeave={() => clearTimeout(timer)}>
                <AnimalPhoto animal={a} />
                {foil && <FoilSheen seed={a.id} />}
                {have > 1 && <span class="count">×{have}</span>}
                {picks > 0 && <span class="count pick">{picks}</span>}
                {a.id === trophyId && <span class="count pick">🏆</span>}
                <div class="cap">{names[a.id] ? `“${names[a.id]}”` : a.name}</div>
              </div>
            )
          })}
        </div>
      )}

      {trade && (
        <div class="trade-bar" style={{ borderColor: RARITY_COLOR[nextRarity(trade.from)] }}>
          <b>{trade.picks.length} / {TRADE_UP_COUNT} {RARITY_LABEL[trade.from]} picked → {RARITY_LABEL[nextRarity(trade.from)]} egg</b>
          <div class="bar" style="margin-top:8px"><div style={{ width: `${(trade.picks.length / TRADE_UP_COUNT) * 100}%`, background: RARITY_COLOR[trade.from] }} /></div>
          <div class="row" style="margin-top:12px">
            <button class="btn tonal grow" onClick={() => setTrade(null)}>Cancel</button>
            <button class="btn grow" disabled={trade.picks.length !== TRADE_UP_COUNT} onClick={doTrade}>Trade</button>
          </div>
        </div>
      )}
      {celebrate && <TradeUpCelebration {...celebrate} onClose={() => setCelebrate(null)} onOpenNow={() => { setHatchNow(celebrate.to); setCelebrate(null) }} />}
      {hatchNow && <HatchDialog kind={hatchNow} onClose={() => setHatchNow(null)} />}
      {open && <AnimalDialog animal={open} copies={copies[open.id] || []} trophyId={trophyId} onClose={() => setOpen(null)}
        onTrade={() => { setOpen(null); startTrade(open) }} />}
    </>
  )
}

/** The trophy case (ZooScreen.kt TrophyCase): three slots for animals picked to show off - the
 *  first is also the profile's trophy. A filled slot opens its animal; an empty one, a picker. */
function TrophyCase({ catalog, copies }) {
  const s = useStore()
  const ids = s.zoo.trophyIds || []
  const names = nametagsOf(s).names
  const [open, setOpen] = useState(null)
  const [picking, setPicking] = useState(false)
  const byId = Object.fromEntries(catalog.map((a) => [a.id, a]))
  const slots = Array.from({ length: TROPHY_CASE_SIZE }, (_, i) => byId[ids[i]] || null)
  const choices = catalog.filter((a) => copies[a.id]?.length && !ids.includes(a.id))
  return (
    <div class="trophy-case">
      <div class="section-header" style="margin-top:0">Trophy case</div>
      <div class="muted small" style="margin:-6px 0 8px">Three animals to show off - the first is the one on your profile.</div>
      <div class="trophy-slots">
        {slots.map((a, i) => (a
          ? <div key={a.id} class="tile-animal" role="button" style={{ borderColor: RARITY_COLOR[a.rarity] }} onClick={() => setOpen(a)}>
              <AnimalPhoto animal={a} />
              {i === 0 && <span class="count pick">🏆</span>}
              <div class="cap">{names[a.id] ? `“${names[a.id]}”` : a.name}</div>
            </div>
          : <button key={`empty${i}`} class="trophy-empty" title="Add to trophy case" onClick={() => setPicking(true)}><Icon name="add" /></button>))}
      </div>
      {picking && (
        <Dialog title="Pick an animal" onClose={() => setPicking(false)} actions={<button class="btn text" onClick={() => setPicking(false)}>Close</button>}>
          <div class="zoo-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {choices.map((a) => (
              <div key={a.id} class="tile-animal" role="button" style={{ borderColor: RARITY_COLOR[a.rarity] }} onClick={() => { addToTrophyCase(a.id); setPicking(false) }}>
                <AnimalPhoto animal={a} />
                <div class="cap">{names[a.id] ? `“${names[a.id]}”` : a.name}</div>
              </div>
            ))}
          </div>
        </Dialog>
      )}
      {open && <AnimalDialog animal={open} copies={copies[open.id] || []} trophyId={s.zoo.trophyId} onClose={() => setOpen(null)} />}
    </div>
  )
}

function AnimalDialog({ animal, copies, trophyId, onClose, onTrade }) {
  const [i, setI] = useState(0)
  const st = useStore()
  const inCase = (st.zoo.trophyIds || []).includes(animal.id)
  const tags = nametagsOf(st)
  const nickname = tags.names[animal.id]
  // A name being tried out: null while not naming; shown live on the card until confirmed
  // (which spends a nametag) or dropped.
  const [preview, setPreview] = useState(null)
  const copy = copies[i]
  const r = animal.rarity
  const trimmed = (preview || '').trim()
  const canSave = tags.held > 0 && trimmed && trimmed !== nickname
  const confirmName = () => { if (canSave && nameAnimal(animal.id, trimmed)) setPreview(null) }
  return (
    <CardStage rarity={r} onClose={onClose}>
      <Floaty><AnimalCardView animal={animal} cert={copy?.cert} timesFound={copies.length} onDisplay={trophyId === animal.id}
        nickname={trimmed || nickname || null} onNameClick={copies.length ? () => setPreview(preview ?? nickname ?? '') : null} /></Floaty>
      {preview != null ? (
        <div class="name-form" onClick={(e) => e.stopPropagation()}>
          <input class="input" autoFocus maxLength={NAMETAG_MAX_LENGTH} value={preview} placeholder="Name"
            onInput={(e) => setPreview(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter') confirmName() }} />
          <div class="small" style="opacity:.8;margin-top:6px">
            {tags.held > 0 ? `Confirming uses one nametag (you have ${tags.held}). Renaming later takes another.` : 'You have no nametags - preview only. Earn one at 70 hours in a Monthly challenge.'}
          </div>
          <div class="row" style="margin-top:10px;gap:8px">
            <button class="btn tonal grow" onClick={() => setPreview(null)}>Cancel</button>
            <button class="btn grow" disabled={!canSave} onClick={confirmName}>{tags.held > 0 ? 'Confirm' : 'Needs a nametag'}</button>
          </div>
        </div>
      ) : (
        <>
          {copies.length > 1 && (
            <div class="chips" style="justify-content:center">
              {copies.map((c, n) => (
                <button key={c.id} class={`chip ${n === i ? 'on' : ''}`} style="background:var(--c-high)" onClick={() => setI(n)}>
                  Copy {n + 1}{c.cert?.foil ? ' · holo' : ''}{carriesCertificate(r) && c.cert?.hourMark != null ? ` · h${c.cert.hourMark}` : ''}
                </button>
              ))}
            </div>
          )}
          {copy && <div class="stage-note small" style="opacity:.75">Hatched {formatDate(copy.atMillis, { year: 'numeric', month: 'short', day: 'numeric' })}</div>}
          {copies.length > 0 && (
            <div class="stage-row">
              {inCase
                ? <GlowPill rarity={r} onClick={() => removeFromTrophyCase(animal.id)}>Remove from trophy case</GlowPill>
                : <GlowPill rarity={r} onClick={() => { if (!addToTrophyCase(animal.id)) toast('The trophy case is full - take one out first') }}>Add to trophy case</GlowPill>}
              {nextRarity(r) && onTrade && <GlowPill rarity={r} onClick={onTrade}>Trade up</GlowPill>}
            </div>
          )}
          <GlowPill rarity={r} onClick={onClose}>Close</GlowPill>
        </>
      )}
    </CardStage>
  )
}

/** What a nametag is, with a little looping demo of a card being named (ZooScreen.kt
 *  NametagInfoDialog): the title turns from the species into a name, the species tucked under it. */
function NametagInfo({ held, animal, onClose }) {
  return (
    <CardStage rarity="ORANGE" onClose={onClose}>
      {/* A solid panel under it all, so the words and the demo read clearly over the glow. */}
      <div class="col nametag-info" style="align-items:center;text-align:center" onClick={(e) => e.stopPropagation()}>
        <div style="font-size:44px;line-height:1">🏷</div>
        <div class="title-large" style="color:#fff;font-weight:800;margin-top:4px">Nametags</div>
        <div style="color:rgba(255,255,255,.85);margin:6px 0 16px;max-width:340px">
          Earn one by reaching 70 hours in a Monthly challenge. Spend it to give any animal in your Zoo a name of its own - open its card and tap Name. Every name or rename uses one.
        </div>
        {animal && <NametagDemo animal={animal} />}
        <div style="color:rgba(255,255,255,.9);font-weight:600;margin:16px 0 14px">You have {held}</div>
        <GlowPill rarity="ORANGE" onClick={onClose}>Got it</GlowPill>
      </div>
    </CardStage>
  )
}

const DEMO_NAME = 'Biscuit'
function NametagDemo({ animal }) {
  const [typed, setTyped] = useState('')
  const [tag, setTag] = useState(false)
  useEffect(() => {
    let alive = true
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    ;(async () => {
      while (alive) {
        setTyped(''); setTag(false)
        await wait(1100); if (!alive) return
        setTag(true)
        await wait(450)
        for (let i = 1; i <= DEMO_NAME.length && alive; i++) { setTyped(DEMO_NAME.slice(0, i)); await wait(110) }
        await wait(1800)
      }
    })()
    return () => { alive = false }
  }, [animal.id])
  return (
    <div class="nametag-demo" style={{ borderColor: RARITY_COLOR[animal.rarity] }}>
      <div class="photo"><AnimalPhoto animal={animal} /></div>
      <div class="body">
        {typed ? <><b>“{typed}”</b><span class="muted small">{animal.name}</span></> : <b>{animal.name}</b>}
      </div>
      <span class={`tag ${tag ? 'on' : ''}`}>🏷</span>
    </div>
  )
}
