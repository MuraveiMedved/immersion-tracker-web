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
  if (!catalog) return <div class="empty"><Spinner /></div>
  const found = everFound(s)
  const held = Object.keys(z.copies).length

  return (
    <>
      <div class="row" style="margin-bottom:14px">
        <h1 class="grow" style="font-size:26px">Zoo</h1>
        <span class="muted small">{held} in your zoo · {found.size}/{catalog.length} found</span>
      </div>
      <Seg options={[['eggs', 'Eggs'], ['collection', `Collection · ${held}`]]} value={tab} onChange={setTab} />
      {tab === 'eggs' ? (
        <>
          <div class="card section center">
            <div class="egg-stage">
              <Egg rarity="BOX" wobble={z.boxesReady > 0} onClick={() => setOdds(true)} />
            </div>
            <div style="font-weight:700;font-size:18px;margin-top:6px">{z.boxesReady > 0 ? `${z.boxesReady} egg${z.boxesReady === 1 ? '' : 's'} ready to hatch` : 'No egg ready yet'}</div>
            <div class="muted small" style="margin:4px 0 12px">Tap the egg to see its hatch rates</div>
            <div class="progress" style="height:10px;max-width:360px;margin:0 auto"><div style={{ width: `${z.boxProgress * 100}%`, background: 'linear-gradient(90deg,#ffb300,#ff4fd8)' }} /></div>
            <div class="muted small" style="margin-top:6px">{z.timeToNextBox} of immersion to the next egg · one every {HOURS_PER_BOX} hours</div>
            {golden && <div class="small" style="margin-top:8px;color:var(--gold);font-weight:650">🔥 Momentum is gold = {FOIL_CHANCE_PERCENT}% chance of a foil card</div>}
            {z.boxesReady > 0 && <button class="btn" style="margin-top:14px;min-width:200px" onClick={() => setHatching('BOX')}>Hatch an egg</button>}
          </div>

          <div class="section-title section"><h2>Coloured eggs &amp; trade-ups</h2></div>
          <div class="card">
            {RARITIES.some((r) => z.coloured[r] > 0) ? (
              <div class="row wrap" style="gap:16px;justify-content:center">
                {RARITIES.filter((r) => z.coloured[r] > 0).map((r) => (
                  <div key={r} class="col" style="align-items:center">
                    <Egg rarity={r} small wobble />
                    <b class="small">{RARITY_LABEL[r]} ×{z.coloured[r]}</b>
                    <button class="btn small" onClick={() => setHatching(r)}>Hatch</button>
                  </div>
                ))}
              </div>
            ) : (
              <p class="muted small" style="margin:0">Trade {TRADE_UP_COUNT} animals of one tier for an egg of the next colour - start from the Collection tab.</p>
            )}
            <button class="btn tonal block" style="margin-top:12px" onClick={() => setTab('collection')}>Trade up…</button>
          </div>
        </>
      ) : (
        <Collection catalog={catalog} copies={z.copies} found={found} trophyId={s.zoo.trophyId} />
      )}
      {odds && <OddsDialog catalog={catalog} found={found} onClose={() => setOdds(false)} />}
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

function OddsDialog({ catalog, found, onClose }) {
  const tiers = [...LOOT_BOX_ODDS.map(([t, p]) => [t, p]), ['GREEN', 100 - LOOT_BOX_ODDS.reduce((a, [, p]) => a + p, 0)]]
  return (
    <Dialog title="Egg hatch rates" onClose={onClose} sheet={false} actions={<button class="btn" onClick={onClose}>OK</button>}>
      <p class="muted small" style="margin-top:0">You earn an egg every {HOURS_PER_BOX} hours of immersion. Every animal in a tier is equally likely.</p>
      <div class="col">
        {tiers.map(([t, p]) => {
          const pool = catalog.filter((a) => a.rarity === t)
          const have = pool.filter((a) => found.has(a.id)).length
          return (
            <div key={t} class="row">
              <RarityBadge rarity={t} />
              <b class="grow" style="margin-left:6px">{p}%</b>
              <span class="muted small">{have}/{pool.length} found · {pool.length ? (p / pool.length).toFixed(2) : 0}% each</span>
            </div>
          )
        })}
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

function Collection({ catalog, copies, found, trophyId }) {
  const [filter, setFilter] = useState('owned')
  const [tier, setTier] = useState(null)
  const [open, setOpen] = useState(null)
  const [trade, setTrade] = useState(null) // {from, picks: []}
  const list = catalog
    .filter((a) => !tier || a.rarity === tier)
    .filter((a) => filter === 'all' || copies[a.id])
    .sort((a, b) => RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity) || a.name.localeCompare(b.name))

  const pick = (a) => {
    if (!trade) { setOpen(a); return }
    if (a.rarity !== trade.from || !copies[a.id]) return
    const usedOf = trade.picks.filter((x) => x === a.id).length
    if (usedOf < copies[a.id].length && trade.picks.length < TRADE_UP_COUNT) setTrade({ ...trade, picks: [...trade.picks, a.id] })
    else setTrade({ ...trade, picks: trade.picks.filter((x) => x !== a.id) })
  }
  const doTrade = () => {
    const to = tradeUp(trade.from, trade.picks)
    if (to) toast(`+1 ${RARITY_LABEL[to]} egg - hatch it from the Eggs tab`)
    else toast('Couldn\'t trade those')
    setTrade(null)
  }

  return (
    <>
      <div class="chips scroll" style="margin-top:14px">
        <button class={`chip ${filter === 'owned' ? 'on' : ''}`} onClick={() => setFilter('owned')}>Owned</button>
        <button class={`chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>All</button>
        <span style="width:8px" />
        {RARITIES.map((r) => <button key={r} class={`chip ${tier === r ? 'on' : ''}`} onClick={() => setTier(tier === r ? null : r)}><span class="dot" style={{ background: RARITY_COLOR[r] }} />{RARITY_LABEL[r]}</button>)}
      </div>
      {trade ? (
        <div class="banner" style="position:sticky;top:8px;z-index:5;margin-top:12px">
          <div class="grow"><b>{trade.picks.length} / {TRADE_UP_COUNT} {RARITY_LABEL[trade.from]} picked</b><div class="muted small">→ {RARITY_LABEL[nextRarity(trade.from)]} egg · duplicates count</div></div>
          <button class="btn text small" onClick={() => setTrade(null)}>Cancel</button>
          <button class="btn small" disabled={trade.picks.length !== TRADE_UP_COUNT} onClick={doTrade}>Trade</button>
        </div>
      ) : (
        <div class="chips" style="margin-top:12px">
          {RARITIES.filter((r) => nextRarity(r)).map((r) => {
            const n = Object.entries(copies).filter(([id]) => catalog.find((a) => a.id === id)?.rarity === r).reduce((t, [, l]) => t + l.length, 0)
            return <button key={r} class="chip" disabled={n < TRADE_UP_COUNT} style={n < TRADE_UP_COUNT ? 'opacity:.45' : ''} onClick={() => { setTier(r); setFilter('owned'); setTrade({ from: r, picks: [] }) }}>Trade up {RARITY_LABEL[r]} ({n})</button>
          })}
        </div>
      )}
      {!list.length ? <div class="empty">{filter === 'owned' && !Object.keys(copies).length ? 'No animals yet - hatch an egg to find your first.' : 'None of these yet.'}</div> : (
        <div class="zoo-grid section">
          {list.map((a) => {
            const have = copies[a.id]?.length || 0
            const locked = !have
            const picks = trade ? trade.picks.filter((x) => x === a.id).length : 0
            const foil = copies[a.id]?.some((c) => c.cert?.foil)
            return (
              <div key={a.id} class={`tile-animal ${locked ? 'locked' : ''} ${picks ? 'picked' : ''}`} style={{ borderColor: locked ? 'transparent' : RARITY_COLOR[a.rarity] }} onClick={() => (locked && !found.has(a.id) ? null : pick(a))}>
                <AnimalPhoto animal={a} />
                {foil && <div class="foil-sheen" />}
                {have > 1 && <span class="count">×{have}</span>}
                {picks > 0 && <span class="count" style="left:5px;right:auto;background:var(--primary);color:var(--on-primary)">{picks}</span>}
                {a.id === trophyId && <span class="count" style="left:5px;right:auto">🏆</span>}
                <div class="cap">{locked && !found.has(a.id) ? '???' : a.name}</div>
              </div>
            )
          })}
        </div>
      )}
      {open && <AnimalDialog animal={open} copies={copies[open.id] || []} trophyId={trophyId} onClose={() => setOpen(null)}
        onTrade={() => { setOpen(null); setTier(open.rarity); setFilter('owned'); setTrade({ from: open.rarity, picks: [open.id] }) }} />}
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
