import { buildRoute } from './geo'
import type { LngLat, Mode, Route } from './types'

// BRouter: gratis routedienst op OpenStreetMap, met profielen voor fietsen en wandelen.
const PROFILE: Record<Mode, string> = { fiets: 'trekking', wandel: 'hiking-mountain' }

export async function fetchRoute(points: LngLat[], mode: Mode, signal?: AbortSignal): Promise<Route> {
  const lonlats = points.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join('|')
  const url = `https://brouter.de/brouter?lonlats=${lonlats}&profile=${PROFILE[mode]}&alternativeidx=0&format=geojson`
  const res = await fetch(url, { signal })
  if (!res.ok) {
    const text = (await res.text()).toLowerCase()
    if (text.includes('not mapped') || text.includes('position'))
      throw new Error('Een punt ligt te ver van een weg of pad. Versleep het punt.')
    throw new Error('Geen route gevonden tussen deze punten.')
  }
  const json = await res.json()
  const f = json.features?.[0]
  const raw: number[][] = f?.geometry?.coordinates ?? []
  if (raw.length < 2) throw new Error('Geen route gevonden tussen deze punten.')
  let last = raw.find((c) => c.length > 2)?.[2] ?? 0
  const coords = raw.map((c) => {
    if (c.length > 2) last = c[2]
    return [c[0], c[1], last] as [number, number, number]
  })
  const asc = Number(f.properties?.['filtered ascend'])
  return buildRoute(coords, Number.isFinite(asc) ? asc : undefined)
}
