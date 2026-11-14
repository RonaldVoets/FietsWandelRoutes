import { ascentOf, buildRoute } from './geo'
import type { LngLat, Mode, Route } from './types'

// Bekende (bewegwijzerde) routes uit OpenStreetMap, via Waymarked Trails.
const HOST: Record<Mode, string> = { fiets: 'cycling', wandel: 'hiking' }
const api = (mode: Mode) => `https://${HOST[mode]}.waymarkedtrails.org/api/v1`

const R = 6378137
const toMerc = (p: ArrayLike<number>): [number, number] => [
  ((p[0] * Math.PI) / 180) * R,
  Math.log(Math.tan(Math.PI / 4 + (p[1] * Math.PI) / 360)) * R,
]
const toLonLat = (x: number, y: number): LngLat => [
  ((x / R) * 180) / Math.PI,
  ((2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180) / Math.PI,
]

const GROUP: Record<string, string> = {
  INT: 'Internationaal',
  NAT: 'Nationaal',
  REG: 'Regionaal',
  LOC: 'Lokaal',
}

export interface TrailHit {
  type: string
  id: number
  name: string
  ref?: string
  /** Nationaal, Regionaal, Lokaal */
  level?: string
}

/** Bekende routes op de aangetikte plek (straal van ongeveer een vingertop). */
export async function trailsAt(mode: Mode, pos: LngLat, zoom: number, signal?: AbortSignal): Promise<TrailHit[]> {
  const [x, y] = toMerc(pos)
  const r = (16 * 78271.517) / 2 ** zoom
  const bbox = [x - r, y - r, x + r, y + r].map((v) => v.toFixed(0)).join(',')
  const res = await fetch(`${api(mode)}/list/by_area?bbox=${bbox}&limit=8`, { signal })
  if (!res.ok) return []
  const json = await res.json()
  return (json.results ?? []).map((t: Record<string, string> & { id: number }) => ({
    type: t.type,
    id: t.id,
    name: t.name ?? t.ref ?? 'Naamloze route',
    ref: t.name ? t.ref : undefined,
    level: GROUP[t.group],
  }))
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
  hit: Pick<TrailHit, 'type' | 'id'>,
  signal?: AbortSignal,
): Promise<{ name: string; route: Route }> {
  const base = `${api(mode)}/details/${hit.type}/${hit.id}`
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
    const er = await fetch(`${base}/way-elevation?simplify=${simplify}`, { signal })
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
