// Small layout helpers shared by the canvas charts.

/** Spreads points on one axis so no two are closer than [gap], each as near its own [y] as it can
 *  be, all within [min, max]: overlapping runs are pushed apart around their middle. Returns id -> y. */
export function spreadApart(items, gap, min, max) {
  const sorted = [...items].sort((a, b) => a.y - b.y)
  // Groups of points that have to move together; each sits centred on its members' wishes.
  let groups = sorted.map((it) => ({ ids: [it.id], want: [it.y], top: it.y }))
  const size = (g) => (g.ids.length - 1) * gap
  const place = (g) => {
    const mean = g.want.reduce((t, v, i) => t + v - i * gap, 0) / g.want.length
    g.top = Math.min(Math.max(mean, min), Math.max(min, max - size(g)))
  }
  let merged = true
  while (merged) {
    merged = false
    groups.forEach(place)
    for (let i = 0; i < groups.length - 1; i++) {
      const a = groups[i], b = groups[i + 1]
      if (a.top + size(a) + gap > b.top + 0.01) {
        groups.splice(i, 2, { ids: [...a.ids, ...b.ids], want: [...a.want, ...b.want], top: a.top })
        merged = true
        break
      }
    }
  }
  groups.forEach(place)
  const out = new Map()
  for (const g of groups) g.ids.forEach((id, i) => out.set(id, g.top + i * gap))
  return out
}
