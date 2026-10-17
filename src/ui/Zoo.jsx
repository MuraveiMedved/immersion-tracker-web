import { useEffect, useMemo, useState } from 'preact/hooks'
import { useStore, useNow } from '../store.js'
import {
  loadCatalog, catalogNow, zooState, ensureBase, recordEarnedEggs, hatchLootEgg, hatchColouredEgg, tradeUp, setTrophy, everFound,
  RARITIES, RARITY_LABEL, RARITY_COLOR, HOURS_PER_BOX, TRADE_UP_COUNT, FOIL_CHANCE_PERCENT, LOOT_BOX_ODDS, nextRarity, carriesCertificate,
} from '../model/zoo.js'
import { isGolden } from '../model/rules.js'
import { formatDate } from '../model/time.js'
import { Dialog, Seg, toast, Spinner } from './common.jsx'

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

export function RarityBadge({ rarity }) {
  return <span class="rarity-badge" style={{ background: RARITY_GRADIENT[rarity] }}>{RARITY_LABEL[rarity]}</span>
}

export function Zoo() {
  const s = useStore()
  const now = useNow(15000)
  const catalog = useCatalog()
  const [tab, setTab] = useState('eggs')
  const [hatching, setHatching] = useState(null) // 'BOX' or a rarity
  const [odds, setOdds] = useState(false)

  useEffect(() => { ensureBase() }, [])
  useEffect(() => { recordEarnedEggs() }, [s.entries.length, Math.floor(now / 60000)])

  const z = useMemo(() => zooState(s, now), [s, now])
  const golden = useMemo(() => isGolden(s.entries, now), [s.entries, Math.floor(now / 60000)])
  const [trade, setTrade] = useState(null) // {from, picks: []} - a trade-up being picked
  if (!catalog) return <div class="empty"><Spinner /></div>
  const found = everFound(s)
  const rarityOfId = (id) => catalog.find((a) => a.id === id)?.rarity
  const heldOfTier = (r) => Object.entries(z.copies).filter(([id]) => rarityOfId(id) === r).reduce((t, [, l]) => t + l.length, 0)
  // Like the phone: a tier shows only once there's a coloured egg to hatch or enough to trade up.
  const tierRows = RARITIES.map((r) => ({ r, eggs: z.coloured[r], canTrade: !!nextRarity(r) && heldOfTier(r) >= TRADE_UP_COUNT })).filter((t) => t.eggs > 0 || t.canTrade)
  const ready = z.boxesReady > 0

  return (
    <>
      <h1 class="page-title">Zoo</h1>
      <Seg options={[['eggs', 'Eggs'], ['collection', 'Collection']]} value={tab} onChange={(t) => { setTab(t); if (t === 'eggs') setTrade(null) }} />
      {tab === 'eggs' ? (
        <>
          <div class="egg-card center">
            <div class="egg-stage" onClick={() => setOdds(true)}>
              <div class="egg-glow" style={{ opacity: ready ? 1 : 0.3 }} />
              <Egg rarity="BOX" wobble={ready} />
            </div>
            <div class="title-medium" style="margin-top:4px">{ready ? `${z.boxesReady} egg${z.boxesReady === 1 ? '' : 's'} ready to hatch` : 'No egg ready yet'}</div>
            <div class="bar" style="margin-top:12px"><div style={{ width: `${z.boxProgress * 100}%` }} /></div>
            <div class="muted small" style="margin-top:6px">{z.timeToNextBox} remaining</div>
            {golden && <div class="small" style="margin-top:6px;color:var(--gold);font-weight:650">Momentum is gold = {FOIL_CHANCE_PERCENT}% chance of a foil card</div>}
            <div style="margin-top:14px;min-height:48px;display:grid;place-items:center">
              {ready
                ? <button class="glow-pill" onClick={() => setHatching('BOX')}>Hatch an egg</button>
                : <span class="muted small">Tap the egg to see its hatch rates</span>}
            </div>
          </div>
          {tierRows.map(({ r, eggs, canTrade }) => (
            <div key={r} class="crate-row" style={{ borderColor: RARITY_COLOR[r] + '99' }}>
              <Egg rarity={r} small wobble={eggs > 0} />
              <div class="grow">
                <div class="title-medium">{RARITY_LABEL[r]} egg{eggs > 1 ? ` ×${eggs}` : ''}</div>
                <div class="muted small">{eggs > 0 ? `Hatches a ${RARITY_LABEL[r]} animal` : `Trade ${TRADE_UP_COUNT} for a ${RARITY_LABEL[nextRarity(r)]} egg`}</div>
              </div>
              {eggs > 0 && <button class="btn small" onClick={() => setHatching(r)}>Hatch</button>}
              {canTrade && <button class="btn tonal small" onClick={() => { setTab('collection'); setTrade({ from: r, picks: [] }) }}>Trade up</button>}
            </div>
          ))}
        </>
      ) : (
        <Collection catalog={catalog} copies={z.copies} found={found} trophyId={s.zoo.trophyId} trade={trade} setTrade={setTrade} />
      )}
      {odds && <OddsDialog onClose={() => setOdds(false)} />}
      {hatching && <HatchDialog kind={hatching} onClose={() => setHatching(null)} />}
    </>
  )
}

export function Egg({ rarity, wobble, shake, small, onClick }) {
  const size = small ? 0.5 : 1
  const specks = useMemo(() => Array.from({ length: 9 }, (_, i) => ({ l: 15 + ((i * 37) % 70), t: 12 + ((i * 53) % 70), r: 6 + ((i * 7) % 10) })), [])
  return (
    <div class={`egg ${shake ? 'shake' : wobble ? 'wobble' : ''}`} onClick={onClick} style={{ width: 120 * size, height: 150 * size, background: RARITY_GRADIENT[rarity] }}>
      {specks.map((sp, i) => <span key={i} class="speck" style={{ left: `${sp.l}%`, top: `${sp.t}%`, width: sp.r * size, height: sp.r * size, background: rarity === 'BOX' ? 'rgba(150,110,60,.35)' : 'rgba(255,255,255,.35)' }} />)}
    </div>
  )
}

function OddsDialog({ onClose }) {
  const tiers = [...LOOT_BOX_ODDS, ['GREEN', 100 - LOOT_BOX_ODDS.reduce((a, [, p]) => a + p, 0)]]
  return (
    <Dialog title="Egg hatch rates" onClose={onClose} sheet={false} actions={<button class="btn" onClick={onClose}>OK</button>}>
      <p class="muted small" style="margin-top:0">You earn an egg every {HOURS_PER_BOX} hours of immersion.</p>
      <div class="col">
        {tiers.map(([t, p]) => (
          <div key={t} class="row"><RarityBadge rarity={t} /><span class="grow" /><b>{p}%</b></div>
        ))}
      </div>
    </Dialog>
  )
}

function HatchDialog({ kind, onClose }) {
  const s = useStore()
  const [phase, setPhase] = useState('idle') // idle -> cracking -> done
  const [result, setResult] = useState(null)
  const [img, setImg] = useState(false)
  const z = zooState(s)
  const left = kind === 'BOX' ? z.boxesReady : z.coloured[kind]

  const crack = async () => {
    if (phase !== 'idle') return
    setPhase('cracking')
    const [r] = await Promise.all([kind === 'BOX' ? hatchLootEgg() : hatchColouredEgg(kind), new Promise((res) => setTimeout(res, 1000))])
    if (!r) { toast('No egg to hatch'); onClose(); return }
    if (r.animal.image) await new Promise((res) => { const im = new Image(); im.onload = im.onerror = res; im.src = r.animal.image })
    setImg(true)
    setResult(r)
    setPhase('done')
  }
  const again = () => { setResult(null); setImg(false); setPhase('idle') }

  return (
    <Dialog onClose={phase === 'cracking' ? undefined : onClose} sheet={false}>
      {phase !== 'done' ? (
        <div class="center" style="padding:20px 0">
          <div class="egg-stage"><Egg rarity={kind} wobble={phase === 'idle'} shake={phase === 'cracking'} onClick={crack} /></div>
          <div style="font-weight:700;margin-top:10px">{kind === 'BOX' ? 'Egg' : `${RARITY_LABEL[kind]} egg`}</div>
          <div class="muted small">{phase === 'idle' ? 'Tap to hatch' : 'Hatching…'}</div>
        </div>
      ) : (
        <div class="col" style="gap:12px">
          <AnimalCardView animal={result.animal} cert={result.cert} glow />
          <div class="center" style="font-weight:800;font-size:18px">
            {result.cert?.foil && <span style="color:var(--gold)">FOIL! </span>}
            {result.copies === 1 ? <span style={{ color: RARITY_COLOR[result.animal.rarity] }}>NEW!</span> : `You now have ×${result.copies}`}
          </div>
          <div class="dialog-actions" style="margin-top:0">
            {left > 0 && <button class="btn tonal" onClick={again}>Hatch another ({left})</button>}
            <button class="btn" onClick={onClose}>Nice!</button>
          </div>
        </div>
      )}
      {img && null}
    </Dialog>
  )
}

/** The big card: photo (with foil sheen), name, rarity, facts and the birth certificate. */
export function AnimalCardView({ animal, cert, glow, compact }) {
  const color = RARITY_COLOR[animal.rarity]
  return (
    <div class={`animal-card ${glow ? 'glow-pop' : ''}`} style={{ borderColor: color, '--glow': color + '88' }}>
      <div class="photo">
        <AnimalPhoto animal={animal} />
        {cert?.foil && <div class="foil-sheen" />}
      </div>
      <div style="padding:14px">
        <div class="row" style="align-items:flex-start">
          <div class="grow">
            <div style="font-weight:750;font-size:18px">{animal.name}</div>
            <div class="muted small" style="font-style:italic">{animal.scientific}</div>
          </div>
          <RarityBadge rarity={animal.rarity} />
        </div>
        {cert && (cert.hourMark != null || cert.foil) && (
          <div class="cert" style="margin-top:10px">
            {cert.foil && <span style="background:linear-gradient(90deg,#ffd1f5,#c7f0ff,#fff7b0);color:#333">FOIL</span>}
            {cert.hourMark != null && <span>Hour {cert.hourMark}</span>}
            {cert.languageName && <span style={{ background: (cert.languageColor || '#888') + '33', color: cert.languageColor || undefined }}>{cert.languageName}-born</span>}
            {cert.mediaTitle && <span title="Hatched during">🎬 {cert.mediaTitle}</span>}
          </div>
        )}
        {!compact && (
          <>
            {animal.blurb && <div class="muted small" style="margin-top:10px">{animal.blurb}</div>}
            {animal.fact && <p style="margin:8px 0">{animal.fact}</p>}
            {animal.stats?.length > 0 && (
              <div class="col" style="gap:4px;margin-top:6px">
                {animal.stats.map((st) => <div key={st.label} class="row small"><span class="muted" style="width:110px;flex:none">{st.label}</span><span>{st.value}</span></div>)}
                {animal.status && <div class="row small"><span class="muted" style="width:110px;flex:none">Status</span><span>{animal.status}</span></div>}
              </div>
            )}
            <div class="row tiny muted" style="margin-top:10px">
              <span class="grow ellipsis">{animal.credit && `Photo: ${animal.credit}`}</span>
              {animal.url && <a href={animal.url} target="_blank" rel="noopener">Wikipedia</a>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** Only animals found so far (no silhouettes of the rest), rarest first - like the phone. A
 *  long-press (or right-click) on one starts a trade-up of its tier. */
function Collection({ catalog, copies, found, trophyId, trade, setTrade }) {
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
  const doTrade = () => {
    const to = tradeUp(trade.from, trade.picks)
    if (to) toast(`+1 ${RARITY_LABEL[to]} egg`)
    else toast("Couldn't trade those")
    setTrade(null)
  }

  return (
    <>
      <div class="section-header">Collection · {held}</div>
      {!list.length ? <div class="empty">{!held ? 'No animals yet - hatch an egg to find your first.' : 'None of these yet.'}</div> : (
        <div class="zoo-grid">
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
                {foil && <div class="foil-sheen" />}
                {have > 1 && <span class="count">×{have}</span>}
                {picks > 0 && <span class="count pick">{picks}</span>}
                {a.id === trophyId && <span class="count pick">🏆</span>}
                <div class="cap">{a.name}</div>
              </div>
            )
          })}
        </div>
      )}
      {!trade && held > 0 && <p class="muted tiny center" style="margin-top:14px">Long-press an animal to trade {TRADE_UP_COUNT} of its tier up for an egg of the next colour.</p>}
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
      {open && <AnimalDialog animal={open} copies={copies[open.id] || []} trophyId={trophyId} onClose={() => setOpen(null)}
        onTrade={() => { setOpen(null); startTrade(open) }} />}
    </>
  )
}

function AnimalDialog({ animal, copies, trophyId, onClose, onTrade }) {
  const [i, setI] = useState(0)
  const copy = copies[i]
  return (
    <Dialog onClose={onClose} actions={<>
      {copies.length > 0 && nextRarity(animal.rarity) && <button class="btn text" onClick={onTrade}>Trade up</button>}
      <span class="spacer" />
      {copies.length > 0 && (trophyId === animal.id
        ? <button class="btn tonal" onClick={() => setTrophy(null)}>Take off my profile</button>
        : <button class="btn tonal" onClick={() => { setTrophy(animal.id); toast('On display on your profile') }}>Show on my profile</button>)}
      <button class="btn" onClick={onClose}>Close</button>
    </>}>
      <AnimalCardView animal={animal} cert={copy?.cert} />
      {copies.length > 1 && (
        <div class="chips" style="margin-top:12px">
          {copies.map((c, n) => (
            <button key={c.id} class={`chip ${n === i ? 'on' : ''}`} onClick={() => setI(n)}>
              Copy {n + 1}{c.cert?.foil ? ' · foil' : ''}{carriesCertificate(animal.rarity) && c.cert?.hourMark != null ? ` · h${c.cert.hourMark}` : ''}
            </button>
          ))}
        </div>
      )}
      {copy && <div class="muted tiny" style="margin-top:8px">Hatched {formatDate(copy.atMillis, { year: 'numeric', month: 'short', day: 'numeric' })}</div>}
    </Dialog>
  )
}
