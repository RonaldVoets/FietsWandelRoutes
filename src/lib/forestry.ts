import { ascentOf, buildRoute, haversine } from './geo'
import type { TrailHit } from './trails'
import type { LngLat, Mode, Route } from './types'

// Officiële wandel- en fietsroutes in de bossen van Forestry England (Open Government Licence).
// De dienst levert losse stukken; stukken met dezelfde naam vormen samen één route.
// De bosroutes in Wales (Natural Resources Wales) komen uit een bestand dat
// scripts/import-wales-forest.mjs uit de open data van Trail Lines maakt.
const QUERY =
  'https://services2.arcgis.com/mHXjwgl3OARRqqD4/ArcGIS/rest/services/Forestry_England_Recreation_Routes/FeatureServer/0/query'

const CATEGORIES: Record<Mode, string[]> = {
  fiets: ['Cycling', 'Multi User Trails'],
  wandel: ['Walking', 'Multi User Trails'],
}

const GRADES: [string, string][] = [
  ['Green', 'groen'],
  ['Blue', 'blauw'],
  ['Red', 'rood'],
  ['Double black', 'dubbelzwart'],
  ['Black', 'zwart'],
  ['Orange', 'oranje'],
  ['Easy', 'makkelijk'],
  ['Moderate', 'gemiddeld'],
  ['Difficult', 'moeilijk'],
]
const grade = (g?: string) => GRADES.find(([en]) => g?.startsWith(en))?.[1]

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`
const where = (mode: Mode) =>
  `category IN (${CATEGORIES[mode].map(quote).join(',')}) AND status LIKE '% - Official' AND asset_name <> 'Unknown'`
const tidy = (s: string) => s.trim().replace(/\s+/g, ' ')

interface Attr {
  OBJECTID: number
  asset_name: string | null
  route_type: string | null
  route_grade: string | null
  category: string
  Shape__Length: number
}

async function query(params: Record<string, string>, signal?: AbortSignal) {
  const res = await fetch(`${QUERY}?${new URLSearchParams(params)}`, {
    signal,
  })
  if (!res.ok) throw new Error('Forestry England is nu niet bereikbaar.')
  return res.json()
}

interface WalesRoute {
  id: number
  name: string
  cat: string
  grade: string
  type: string
  len: number
  box: [number, number, number, number]
  line: LngLat[][]
}

const WALES = [-5.6, 51.2, -2.5, 53.6]
const overlaps = (a: number[], b: number[]) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
let wales: Promise<WalesRoute[]> | null = null
/** Het bestand met de Welshe bosroutes; pas opgehaald als de kaart Wales laat zien. */
function walesRoutes(): Promise<WalesRoute[]> {
  wales ??= fetch(`${import.meta.env.BASE_URL}data/wales-forest.json`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Welshe bosroutes zijn nu niet op te halen.'))))
    .then((j) => j.routes as WalesRoute[])
    .catch((e) => {
      wales = null
      throw e
    })
  return wales
}

async function walesList(mode: Mode, box: number[]): Promise<TrailHit[]> {
  if (!overlaps(box, WALES)) return []
  const routes = await walesRoutes()
  return routes
    .filter((r) => CATEGORIES[mode].includes(r.cat) && overlaps(box, r.box))
    .map((r) => ({
      type: 'nrw',
      id: r.id,
      host: 'fe' as const,
      name: r.name,
      ref: ['Natural Resources Wales', grade(r.grade)].filter(Boolean).join(' '),
      level: 'Lokaal' as const,
      mtb: r.type === 'Mountain Bike' || r.type === 'Downhill',
      length: r.len,
    }))
}

/** Bosroutes die het kaartvak [west, zuid, oost, noord] raken, in Engeland en Wales. */
export async function forestryList(mode: Mode, box: number[], signal?: AbortSignal): Promise<TrailHit[]> {
  const [england, welsh] = await Promise.all([
    englandList(mode, box, signal).catch(() => [] as TrailHit[]),
    walesList(mode, box).catch(() => [] as TrailHit[]),
  ])
  return [...england, ...welsh]
}

async function englandList(mode: Mode, box: number[], signal?: AbortSignal): Promise<TrailHit[]> {
  const json = await query(
    {
      where: where(mode),
      geometry: box.map((v) => v.toFixed(5)).join(','),
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'OBJECTID,asset_name,route_type,route_grade,category,Shape__Length',
      returnGeometry: 'false',
      f: 'json',
    },
    signal,
  )
  const groups = new Map<string, TrailHit>()
  for (const f of (json.features ?? []) as { attributes: Attr }[]) {
    const a = f.attributes
    const name = tidy(a.asset_name ?? '')
    if (!name) continue
    const key = `${name.toLowerCase()}|${a.category}|${a.route_grade}`
    const g = groups.get(key)
    if (g) {
      g.id = Math.min(g.id, a.OBJECTID)
      g.length = (g.length ?? 0) + a.Shape__Length
    } else {
      groups.set(key, {
        type: 'fe',
        id: a.OBJECTID,
        host: 'fe',
        name,
        ref: ['Forestry England', grade(a.route_grade ?? '')].filter(Boolean).join(' '),
        level: 'Lokaal',
        mtb: a.route_type === 'Mountain Bike' || a.route_type === 'Downhill',
        length: a.Shape__Length,
      })
    }
  }
  // losse stukjes en oefenterreintjes zijn geen route
  return [...groups.values()].filter((h) => (h.length ?? 0) >= 1000)
}

type Part = { pts: LngLat[]; ids: number }

/** Zet de stukken achter elkaar: steeds het stuk dat het dichtst bij het huidige eindpunt begint. */
function chain(parts: Part[]): LngLat[][] {
  const left = [...parts]
  const ends = (p: Part) => [p.pts[0], p.pts[p.pts.length - 1]]
  // begin bij een los uiteinde als dat er is, anders bij het eerste stuk
  let startAt = 0
  let flip = false
  outer: for (let i = 0; i < left.length; i++) {
    for (const [k, e] of ends(left[i]).entries()) {
      const touched = left.some((o, j) => j !== i && ends(o).some((x) => haversine(x, e) < 30))
      if (!touched) {
        startAt = i
        flip = k === 1
        break outer
      }
    }
  }
  const first = left.splice(startAt, 1)[0]
  const line: LngLat[][] = [flip ? [...first.pts].reverse() : [...first.pts]]
  while (left.length) {
    const cur = line[line.length - 1]
    const tail = cur[cur.length - 1]
    let best = 0
    let bestD = Infinity
    let rev = false
    left.forEach((p, i) => {
      const [a, b] = ends(p)
      const da = haversine(tail, a)
      const db = haversine(tail, b)
      if (Math.min(da, db) < bestD) {
        bestD = Math.min(da, db)
        best = i
        rev = db < da
      }
    })
    const next = left.splice(best, 1)[0]
    const pts = rev ? [...next.pts].reverse() : next.pts
    if (bestD > 20) line.push([...pts])
    else cur.push(...pts.slice(1))
  }
  return line
}

/** Hoogtes langs de lijn (Open-Meteo, hooguit 100 punten per vraag); null als dat niet lukt. */
async function elevations(pts: LngLat[], signal?: AbortSignal): Promise<number[] | null> {
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/elevation?latitude=${pts.map((p) => p[1].toFixed(5)).join(',')}&longitude=${pts
        .map((p) => p[0].toFixed(5))
        .join(',')}`,
      { signal },
    )
    if (!res.ok) return null
    const ele = (await res.json()).elevation
    return Array.isArray(ele) && ele.length === pts.length ? ele : null
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    return null
  }
}

export async function forestryTrail(
  type: string,
  id: number,
  signal?: AbortSignal,
): Promise<{ name: string; route: Route }> {
  if (type === 'nrw') {
    const r = (await walesRoutes()).find((x) => x.id === id)
    if (!r) throw new Error('Deze route is niet meer bekend.')
    return { name: r.name, route: await lineRoute(r.line, signal) }
  }
  const one = await query(
    {
      objectIds: String(id),
      outFields: 'asset_name,category,route_grade',
      returnGeometry: 'false',
      f: 'json',
    },
    signal,
  )
  const a = one.features?.[0]?.attributes as Attr | undefined
  if (!a?.asset_name) throw new Error('Deze route is nu niet op te halen.')

  const gradeClause = a.route_grade ? `route_grade = ${quote(a.route_grade)}` : 'route_grade IS NULL'
  const json = await query(
    {
      where: `asset_name = ${quote(a.asset_name)} AND category = ${quote(a.category)} AND ${gradeClause} AND status LIKE '% - Official'`,
      outFields: 'OBJECTID',
      outSR: '4326',
      f: 'geojson',
    },
    signal,
  )
  const parts: Part[] = []
  for (const f of json.features ?? []) {
    const g = f.geometry
    const lines: number[][][] =
      g?.type === 'LineString' ? [g.coordinates] : g?.type === 'MultiLineString' ? g.coordinates : []
    for (const l of lines)
      if (l.length > 1)
        parts.push({
          pts: l.map((c) => [c[0], c[1]] as LngLat),
          ids: f.properties?.OBJECTID ?? f.id,
        })
  }
  if (parts.length === 0) throw new Error('Van deze route is geen lijn bekend.')

  // dezelfde naam komt in meer bossen voor: alleen de stukken die bij het gekozen stuk horen
  const group = new Set<Part>(parts.filter((p) => p.ids === id))
  if (group.size === 0) group.add(parts[0])
  for (let grown = true; grown;) {
    grown = false
    for (const p of parts) {
      if (group.has(p)) continue
      const near = [...group].some((q) =>
        [p.pts[0], p.pts[p.pts.length - 1]].some((e) =>
          [q.pts[0], q.pts[q.pts.length - 1]].some((x) => haversine(e, x) < 500),
        ),
      )
      if (near) {
        group.add(p)
        grown = true
      }
    }
  }

  return { name: tidy(a.asset_name), route: await lineRoute(chain([...group]), signal) }
}

/** Maakt van een lijn een route met hoogteprofiel. */
export async function lineRoute(line: LngLat[][], signal?: AbortSignal): Promise<Route> {
  const flat = line.flat()
  const plain = buildRoute(
    flat.map((p) => [p[0], p[1], 0] as [number, number, number]),
    0,
  )

  // hoogte op hooguit 100 punten, gelijk verdeeld over de afstand; daartussen rechtlijnig
  const n = Math.min(100, flat.length)
  const idx: number[] = []
  let j = 0
  for (let k = 0; k < n; k++) {
    const d = (plain.distance * k) / Math.max(1, n - 1)
    while (j < flat.length - 1 && plain.cum[j] < d) j++
    if (idx[idx.length - 1] !== j) idx.push(j)
  }
  const ele = await elevations(
    idx.map((i) => flat[i]),
    signal,
  )
  let route = plain
  if (ele) {
    let s = 0
    const coords = flat.map((p, i) => {
      while (s < idx.length - 2 && i > idx[s + 1]) s++
      const i0 = idx[s]
      const i1 = idx[Math.min(s + 1, idx.length - 1)]
      const span = plain.cum[i1] - plain.cum[i0]
      const t = span > 0 ? Math.min(1, Math.max(0, (plain.cum[i] - plain.cum[i0]) / span)) : 0
      const e1 = ele[Math.min(s + 1, ele.length - 1)]
      return [p[0], p[1], Math.round(ele[s] + (e1 - ele[s]) * t)] as [number, number, number]
    })
    route = buildRoute(coords, ascentOf(coords))
  }
  // sprongen tussen losse stukken tellen niet mee in de afstand
  let own = 0
  for (const part of line) for (let i = 1; i < part.length; i++) own += haversine(part[i - 1], part[i])
  if (own > 0 && route.distance > own) {
    const f = own / route.distance
    route.cum = route.cum.map((c) => c * f)
    route.distance = own
  }
  route.line = line
  return route
}
