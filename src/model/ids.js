// Data made before sync (and phone backups) numbers its records 1, 2, 3... - fine on one device,
// but two devices' "entry 5" would be taken for the same record once synced. Before a device
// starts syncing, every such id is swapped for a device-unique one, with every reference to it
// (an entry's language, a trade-in's copy and egg, an egg record's key) moved along.
import { uid, ANKI_ID } from '../store.js'

const SMALL = 1e12 // uid()s are ~1.8e15; anything below is a local counter id

export function remapIds(s) {
  const profileMap = new Map()
  for (const p of s.profiles) {
    if (p.isAnki) profileMap.set(p.id, ANKI_ID)
    else if (p.id < SMALL || p.id === ANKI_ID) profileMap.set(p.id, uid())
  }
  // Only one Anki profile, with the shared id.
  const firstAnki = s.profiles.find((p) => p.isAnki)
  s.profiles = s.profiles.filter((p) => !p.isAnki || p === firstAnki)
  for (const p of s.profiles) if (profileMap.has(p.id)) p.id = profileMap.get(p.id)
  const entryMap = new Map()
  for (const e of s.entries) {
    if (e.id < SMALL) { const n = uid(); entryMap.set(e.id, n); e.id = n }
    if (e.languageProfileId != null && profileMap.has(e.languageProfileId)) e.languageProfileId = profileMap.get(e.languageProfileId)
  }
  for (const k of Object.keys(s.paused || {})) {
    const p = s.paused[k]
    if (p.languageProfileId != null && profileMap.has(p.languageProfileId)) p.languageProfileId = profileMap.get(p.languageProfileId)
    if (p.entryId != null && entryMap.has(p.entryId)) p.entryId = entryMap.get(p.entryId)
  }
  const openingMap = new Map()
  for (const o of s.zoo.openings) if (o.id < SMALL) { const n = uid(); openingMap.set(o.id, n); o.id = n }
  const grantMap = new Map()
  for (const g of s.zoo.grants) if (g.id < SMALL) { const n = uid(); grantMap.set(g.id, n); g.id = n }
  for (const t of s.zoo.tradeIns) {
    if (t.id < SMALL) t.id = uid()
    if (t.openingId != null && openingMap.has(t.openingId)) t.openingId = openingMap.get(t.openingId)
    if (grantMap.has(t.grantId)) t.grantId = grantMap.get(t.grantId)
  }
  const eggs = {}
  for (const [key, egg] of Object.entries(s.zoo.eggs)) {
    const m = key.match(/^grant:(\d+)$/)
    eggs[m && grantMap.has(+m[1]) ? `grant:${grantMap.get(+m[1])}` : key] = egg
  }
  s.zoo.eggs = eggs
  return s
}
