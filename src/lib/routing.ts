import { buildRoute } from './geo'
import type { LngLat, Mode, Route } from './types'

// BRouter: gratis routedienst op OpenStreetMap, met profielen voor fietsen en wandelen.
const PROFILE: Record<Mode, string> = { fiets: 'trekking', wandel: 'hiking-mountain' }

const NO_ROUTE = 'Geen route gevonden tussen deze punten.'

async function request(query: string, mode: Mode, signal?: AbortSignal): Promise<Route> {
  const url = `https://brouter.de/brouter?${query}&profile=${PROFILE[mode]}&alternativeidx=0&format=geojson`
  const res = await fetch(url, { signal })
  if (!res.ok) {
    const text = (await res.text()).toLowerCase()
    if (text.includes('not mapped') || text.includes('position'))
      throw new Error('Een punt ligt te ver van een weg of pad. Versleep het punt.')
    throw new Error(NO_ROUTE)
  }
  const json = await res.json()
  const f = json.features?.[0]
  const raw: number[][] = f?.geometry?.coordinates ?? []
  if (raw.length < 2) throw new Error(NO_ROUTE)
  let last = raw.find((c) => c.length > 2)?.[2] ?? 0
  const coords = raw.map((c) => {
    if (c.length > 2) last = c[2]
    return [c[0], c[1], last] as [number, number, number]
  })
  const asc = Number(f.properties?.['filtered ascend'])
  return buildRoute(coords, Number.isFinite(asc) ? asc : undefined)
}

const lonlat = (p: LngLat) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`

export function fetchRoute(points: LngLat[], mode: Mode, signal?: AbortSignal): Promise<Route> {
  return request(`lonlats=${points.map(lonlat).join('|')}`, mode, signal)
}

/**
 * Rondje vanaf een startpunt met ongeveer de gevraagde lengte.
 * BRouter vraagt een straal, geen lengte: het rondje wordt grofweg 7x de straal.
 * Daarom sturen we de straal bij tot de lengte binnen 12% van het doel ligt (hooguit 4 pogingen).
 */
export async function fetchRoundTrip(start: LngLat, mode: Mode, target: number, signal?: AbortSignal): Promise<Route> {
  const direction = Math.floor(Math.random() * 360)
  let radius = target / 7
  let best: Route | null = null
  for (let i = 0; i < 4; i++) {
    let r: Route
    try {
      r = await request(
        `lonlats=${lonlat(start)}&engineMode=4&roundTripDistance=${Math.round(radius)}&direction=${direction}`,
        mode,
        signal,
      )
    } catch (e) {
      if ((e as Error).name === 'AbortError' || !best) throw e
      break
    }
    if (!best || Math.abs(r.distance - target) < Math.abs(best.distance - target)) best = r
    if (Math.abs(r.distance - target) / target < 0.12) break
    radius *= target / r.distance
  }
  if (!best) throw new Error('Hier is geen rondje te maken. Kies een ander startpunt.')
  return best
}
