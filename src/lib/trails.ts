import { AOF } from '../data/aof'
import { forestryList, forestryTrail } from './forestry'
import { ascentOf, buildRoute } from './geo'
import type { LngLat, Mode, Route } from './types'

// Bekende (bewegwijzerde) routes uit OpenStreetMap, via Waymarked Trails.
// Fietsen combineert de fietsroutes met de mountainbikeroutes.
// 'fe' zijn de officiële bosroutes van Forestry England (zie forestry.ts).
export type TrailHost = 'hiking' | 'cycling' | 'mtb' | 'fe'
type WmtHost = Exclude<TrailHost, 'fe'>
export const TRAIL_HOSTS: Record<Mode, WmtHost[]> = {
  fiets: ['cycling', 'mtb'],
  wandel: ['hiking'],
}
const api = (host: WmtHost) => `https://${host}.waymarkedtrails.org/api/v1`

const R = 6378137
const toMerc = (p: ArrayLike<number>): [number, number] => [
  ((p[0] * Math.PI) / 180) * R,
  Math.log(Math.tan(Math.PI / 4 + (p[1] * Math.PI) / 360)) * R,
]
const toLonLat = (x: number, y: number): LngLat => [
  ((x / R) * 180) / Math.PI,
  ((2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180) / Math.PI,
]

export const LEVELS = ['Nationaal', 'Regionaal', 'Lokaal'] as const
export type Level = (typeof LEVELS)[number]
const GROUP: Record<string, Level> = {
  INT: 'Nationaal',
  NAT: 'Nationaal',
  REG: 'Regionaal',
  LOC: 'Lokaal',
}

export interface TrailRef {
  type: string
  id: number
  /** ontbreekt bij routes die vóór de MTB-uitbreiding zijn opgeslagen */
  host?: TrailHost
}

export interface TrailHit extends TrailRef {
  name: string
  ref?: string
  level: Level
  mtb: boolean
  /** lengte in meters, als de bron die meteen meegeeft */
  length?: number
  /** rondwandeling, volgens het register van Adventure On Foot */
  circular?: boolean
  /** stijging in meters, volgens datzelfde register */
  ascent?: number
}

const LIMIT = 100

async function list(host: WmtHost, bbox: number[], signal?: AbortSignal): Promise<TrailHit[]> {
  const res = await fetch(`${api(host)}/list/by_area?bbox=${bbox.map((v) => v.toFixed(0)).join(',')}&limit=${LIMIT}`, {
    signal,
  })
  if (!res.ok) return []
  const json = await res.json()
  return (json.results ?? []).map((t: Record<string, string> & { id: number }): TrailHit => {
    const extra = host === 'hiking' && t.type === 'relation' ? AOF[t.id] : undefined
    return {
      circular: extra ? extra[0] === 1 : undefined,
      ascent: extra?.[1] || undefined,
      type: t.type,
      id: t.id,
      host,
      // routes met alleen een nummer (zoals het National Cycle Network) heten "Route 6"
      name: t.name ?? (t.ref ? `Route ${t.ref}` : 'Naamloze route'),
      ref: t.name && t.ref !== t.name ? t.ref : undefined,
      level: GROUP[t.group] ?? 'Lokaal',
      mtb: host === 'mtb',
    }
  })
}

async function listAll(mode: Mode, bbox: number[], signal?: AbortSignal) {
  const [w, s] = toLonLat(bbox[0], bbox[1])
  const [e, n] = toLonLat(bbox[2], bbox[3])
  const [forest, ...lists] = await Promise.all([
    forestryList(mode, [w, s, e, n], signal).catch(() => [] as TrailHit[]),
    ...TRAIL_HOSTS[mode].map((h) => list(h, bbox, signal).catch(() => [] as TrailHit[])),
  ])
  const hits = [...lists.flat(), ...forest]
  hits.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || a.name.localeCompare(b.name))
  return { hits, capped: lists.some((l) => l.length >= LIMIT) }
}

/** Bekende routes op de aangetikte plek (straal van ongeveer een vingertop). */
export async function trailsAt(mode: Mode, pos: LngLat, zoom: number, signal?: AbortSignal): Promise<TrailHit[]> {
  const [x, y] = toMerc(pos)
  const r = (16 * 78271.517) / 2 ** zoom
  return (await listAll(mode, [x - r, y - r, x + r, y + r], signal)).hits.slice(0, 8)
}

/** Alle bekende routes in het kaartbeeld; capped = er zijn er meer dan de dienst in één keer geeft. */
export function trailsInView(
  mode: Mode,
  bounds: [number, number, number, number],
  signal?: AbortSignal,
): Promise<{ hits: TrailHit[]; capped: boolean }> {
  const [x0, y0] = toMerc([bounds[0], bounds[1]])
  const [x1, y1] = toMerc([bounds[2], bounds[3]])
  return listAll(mode, [x0, y0, x1, y1], signal)
}

interface Way {
  id: number
  geometry: { coordinates: [number, number][] }
}

/** Loopt de routeboom af en geeft de wegen in looprichting terug. */
function collect(node: any, out: Way[]) {
  if (!node) return
  if (node.route_type === 'base') {
    if (node.geometry?.coordinates?.length) out.push(node)
    return
  }
  for (const child of node.main ?? node.forward ?? node.ways ?? []) collect(child, out)
}

interface ElePoint {
  x: number
  y: number
  ele: number
}

const sq = (a: ArrayLike<number>, b: ArrayLike<number>) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2

export async function fetchTrail(
  mode: Mode,
  ref: TrailRef,
  signal?: AbortSignal,
): Promise<{ name: string; route: Route }> {
  if (ref.host === 'fe') return forestryTrail(ref.id, signal)
  const base = `${api(ref.host ?? TRAIL_HOSTS[mode][0])}/details/${ref.type}/${ref.id}`
  const res = await fetch(base, { signal })
  if (!res.ok) throw new Error('Deze route is nu niet op te halen.')
  const detail = await res.json()
  const length: number = detail.route?.length ?? 0

  const ways: Way[] = []
  collect(detail.route, ways)
  if (ways.length === 0) throw new Error('Van deze route is geen lijn bekend.')

  // hoogte per weg; bij lange routes grover bemonsterd, net als de site zelf doet
  const simplify = length < 5000 ? 10 : Math.floor(length / 500)
  let segments: Record<string, { elevation: ElePoint[] }> = {}
  try {
    const er = await fetch(`${base}/way-elevation?simplify=${simplify}`, {
      signal,
    })
    if (er.ok) segments = (await er.json()).segments ?? {}
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
  }

  const line: LngLat[][] = []
  const coords: [number, number, number][] = []
  /** beginindex in coords van elk aaneengesloten stuk */
  const partStart: number[] = []
  let prevEnd: [number, number] | null = null
  let lastEle = 0
  for (const w of ways) {
    const g = w.geometry.coordinates
    // lijn op volle detail voor de kaart; nieuw stuk bij een gat van meer dan 5 m
    if (!prevEnd || sq(prevEnd, g[0]) > 25) {
      line.push([])
      partStart.push(coords.length)
    }
    const cur = line[line.length - 1]
    for (let i = cur.length ? 1 : 0; i < g.length; i++) cur.push(toLonLat(g[i][0], g[i][1]))
    prevEnd = g[g.length - 1]

    const seg = segments[w.id]?.elevation
    if (seg?.length) {
      const forward = sq([seg[0].x, seg[0].y], g[0]) <= sq([seg[0].x, seg[0].y], g[g.length - 1])
      for (let i = 0; i < seg.length; i++) {
        const p = seg[forward ? i : seg.length - 1 - i]
        lastEle = p.ele
        const ll = toLonLat(p.x, p.y)
        coords.push([ll[0], ll[1], p.ele])
      }
    } else {
      for (const c of g) {
        const ll = toLonLat(c[0], c[1])
        coords.push([ll[0], ll[1], lastEle])
      }
    }
  }

  // stijging per aaneengesloten stuk, zodat een sprong tussen losse stukken niet als klim telt
  let ascent = 0
  partStart.forEach((from, i) => (ascent += ascentOf(coords.slice(from, partStart[i + 1]))))
  const route = buildRoute(coords, ascent)
  // de in kaart gebrachte lengte is leidend; de bemonsterde punten snijden bochten af
  if (length > 0 && route.distance > 0) {
    const f = length / route.distance
    route.cum = route.cum.map((c) => c * f)
    route.distance = length
  }
  route.line = line
  return { name: detail.name ?? detail.ref ?? 'Bekende route', route }
}

export const trailKey = (t: TrailRef) => `${t.host}/${t.type}/${t.id}`

// ---- lengte per route voor de lijst ----
// De lijst van de dienst bevat geen lengte; die staat alleen in de routedetails, en die zijn
// voor lange routes megabytes groot. De lengte staat vooraan in dat antwoord, dus we lezen
// alleen het begin en breken dan af. Gevonden lengtes bewaren we op het toestel.
const LEN_STORE = 'fwr.trailLen'
const LEN_RE = /"route":\s*\{\s*"route_type":\s*"\w+",\s*"length":\s*(\d+)/
let lenCache: Record<string, number> | null = null

function lengths(): Record<string, number> {
  if (!lenCache) {
    try {
      lenCache = JSON.parse(localStorage.getItem(LEN_STORE) ?? '{}')
    } catch {
      lenCache = {}
    }
  }
  return lenCache!
}

/** Lengte in meters, of null als die niet te bepalen is. */
export async function trailLength(t: TrailRef, signal?: AbortSignal): Promise<number | null> {
  const key = trailKey(t)
  const cached = lengths()[key]
  if (cached !== undefined) return cached
  if (!t.host || t.host === 'fe') return null
  const ac = new AbortController()
  const stop = () => ac.abort()
  signal?.addEventListener('abort', stop)
  try {
    const res = await fetch(`${api(t.host)}/details/${t.type}/${t.id}`, {
      signal: ac.signal,
    })
    if (!res.ok || !res.body) return null
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let text = ''
    while (text.length < 300_000) {
      const { done, value } = await reader.read()
      if (done) break
      text += dec.decode(value, { stream: true })
      const m = LEN_RE.exec(text)
      if (m) {
        const len = Number(m[1])
        lengths()[key] = len
        try {
          localStorage.setItem(LEN_STORE, JSON.stringify(lengths()))
        } catch {
          // opslag vol: dan alleen in het geheugen
        }
        return len
      }
    }
    return null
  } finally {
    signal?.removeEventListener('abort', stop)
    ac.abort()
  }
}
