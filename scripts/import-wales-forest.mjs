// Haalt de bosroutes van Natural Resources Wales uit de open data van Trail Lines
// (vectortegels in forest.pmtiles) en schrijft ze als één bestand naar public/data.
// De tegels knippen elke route in stukken; hier worden die weer aan elkaar gezet.
// Gebruik: node scripts/import-wales-forest.mjs [url-van-forest.pmtiles]
import { writeFileSync, mkdirSync } from 'node:fs'
import { PMTiles } from 'pmtiles'
import { VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'

const url = process.argv[2] ?? 'https://maps.traillinesmaps.co.uk/uk/v34/forest.pmtiles'
const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
if (!res.ok) throw new Error(`Ophalen mislukt: ${res.status}`)
const buf = new Uint8Array(await res.arrayBuffer())
const archive = new PMTiles({
  getKey: () => url,
  getBytes: async (offset, length) => ({ data: buf.slice(offset, offset + length).buffer }),
})

const Z = 14
const N = 2 ** Z
const tx = (lon) => Math.floor(((lon + 180) / 360) * N)
const ty = (lat) => {
  const r = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N)
}
const lon = (x) => (x / N) * 360 - 180
const lat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / N))) * 180) / Math.PI

const R = 6371000
const rad = (d) => (d * Math.PI) / 180
const dist = (a, b) => {
  const h =
    Math.sin(rad(b[1] - a[1]) / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Knipt een lijn op de tegelrand af, zodat de overlap tussen buurtegels verdwijnt. */
function clip(line, E) {
  const inside = (p) => p.x >= 0 && p.x <= E && p.y >= 0 && p.y <= E
  const cross = (a, b) => {
    // snijpunt van a->b met de tegelrand, gezien vanaf het punt dat binnen ligt
    let t = 1
    const d = { x: b.x - a.x, y: b.y - a.y }
    for (const k of ['x', 'y']) {
      if (d[k] > 0) t = Math.min(t, (E - a[k]) / d[k])
      else if (d[k] < 0) t = Math.min(t, (0 - a[k]) / d[k])
    }
    return { x: a.x + d.x * t, y: a.y + d.y * t }
  }
  const out = []
  let cur = null
  for (let i = 0; i < line.length; i++) {
    const p = line[i]
    const prev = line[i - 1]
    if (inside(p)) {
      if (!cur) {
        cur = []
        if (prev) cur.push(cross(p, prev))
      }
      cur.push(p)
    } else if (cur) {
      cur.push(cross(prev, p))
      out.push(cur)
      cur = null
    }
  }
  if (cur) out.push(cur)
  return out.filter((l) => l.length > 1)
}

// Wales, ruim genomen; de filter op beheerder doet de rest
const pieces = new Map()
let tiles = 0
for (let x = tx(-5.6); x <= tx(-2.5); x++) {
  for (let y = ty(53.6); y <= ty(51.2); y++) {
    const t = await archive.getZxy(Z, x, y)
    if (!t?.data) continue
    tiles++
    const layer = new VectorTile(new PbfReader(new Uint8Array(t.data))).layers.forest
    if (!layer) continue
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i)
      const p = f.properties
      if (p.operator !== 'Natural Resources Wales') continue
      const name = String(p.asset_name ?? '')
        .trim()
        .replace(/\s+/g, ' ')
      if (!name || name === '.' || name.toLowerCase() === 'unknown') continue
      const key = `${name.toLowerCase()}|${p.category}|${p.route_grade ?? ''}`
      if (!pieces.has(key))
        pieces.set(key, { name, cat: p.category, grade: p.route_grade ?? '', type: p.route_type ?? '', parts: [] })
      for (const ring of f.loadGeometry())
        for (const l of clip(ring, layer.extent))
          pieces.get(key).parts.push(l.map((q) => [lon(x + q.x / layer.extent), lat(y + q.y / layer.extent)]))
    }
  }
}

/** Zet stukken achter elkaar: steeds het stuk dat het dichtst bij het huidige eindpunt begint. */
function chain(parts) {
  const left = [...parts]
  const ends = (p) => [p[0], p[p.length - 1]]
  let startAt = 0
  let flip = false
  outer: for (let i = 0; i < left.length; i++) {
    for (const [k, e] of ends(left[i]).entries()) {
      if (!left.some((o, j) => j !== i && ends(o).some((q) => dist(q, e) < 30))) {
        startAt = i
        flip = k === 1
        break outer
      }
    }
  }
  const first = left.splice(startAt, 1)[0]
  const line = [flip ? [...first].reverse() : [...first]]
  while (left.length) {
    const cur = line[line.length - 1]
    const tail = cur[cur.length - 1]
    let best = 0
    let bestD = Infinity
    let rev = false
    left.forEach((p, i) => {
      const da = dist(tail, p[0])
      const db = dist(tail, p[p.length - 1])
      if (Math.min(da, db) < bestD) {
        bestD = Math.min(da, db)
        best = i
        rev = db < da
      }
    })
    const next = left.splice(best, 1)[0]
    const pts = rev ? [...next].reverse() : next
    if (bestD > 20) line.push([...pts])
    else cur.push(...pts.slice(1))
  }
  return line
}

// vaste id uit naam en ligging, zodat opgeslagen routes een nieuwe import overleven
const hash = (s) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

const routes = []
for (const [key, g] of pieces) {
  // dezelfde naam komt in meer bossen voor: groepeer stukken die bij elkaar liggen
  const todo = [...g.parts]
  while (todo.length) {
    const group = [todo.pop()]
    for (let grown = true; grown;) {
      grown = false
      for (let i = todo.length - 1; i >= 0; i--) {
        const e = [todo[i][0], todo[i][todo[i].length - 1]]
        if (group.some((q) => e.some((a) => dist(a, q[0]) < 500 || dist(a, q[q.length - 1]) < 500))) {
          group.push(todo.splice(i, 1)[0])
          grown = true
        }
      }
    }
    const line = chain(group).map((l) => l.map((p) => [Number(p[0].toFixed(5)), Number(p[1].toFixed(5))]))
    let len = 0
    for (const l of line) for (let i = 1; i < l.length; i++) len += dist(l[i - 1], l[i])
    if (len < 1000) continue
    const flat = line.flat()
    const box = [
      Math.min(...flat.map((p) => p[0])),
      Math.min(...flat.map((p) => p[1])),
      Math.max(...flat.map((p) => p[0])),
      Math.max(...flat.map((p) => p[1])),
    ]
    routes.push({
      id: hash(`${key}|${box[0].toFixed(2)}|${box[1].toFixed(2)}`),
      name: g.name,
      cat: g.cat,
      grade: g.grade,
      type: g.type,
      len: Math.round(len),
      box,
      line,
    })
  }
}
routes.sort((a, b) => a.name.localeCompare(b.name))
const ids = new Set(routes.map((r) => r.id))
if (ids.size !== routes.length) throw new Error('Dubbele id; pas de hash aan.')

mkdirSync(new URL('../public/data/', import.meta.url), { recursive: true })
writeFileSync(
  new URL('../public/data/wales-forest.json', import.meta.url),
  JSON.stringify({
    source: url,
    attribution:
      'Forest routes from Natural Resources Wales (Open Government Licence), via Trail Lines open data (Open Database Licence)',
    routes,
  }),
)
const byCat = {}
for (const r of routes) byCat[r.cat] = (byCat[r.cat] ?? 0) + 1
console.log(`${tiles} tegels gelezen, ${routes.length} routes geschreven`, byCat)
