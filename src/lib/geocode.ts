import type { LngLat } from './types'

export interface Place {
  name: string
  detail: string
  pos: LngLat
}

// Engeland en Wales (ruim genomen); resultaten buiten GB vallen af.
const BBOX = '-5.9,49.9,1.9,55.9'

export async function searchPlaces(q: string, signal?: AbortSignal): Promise<Place[]> {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lang=en&bbox=${BBOX}`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error('Zoeken lukt nu niet.')
  const json = await res.json()
  const out: Place[] = []
  for (const f of json.features ?? []) {
    const p = f.properties ?? {}
    if (p.countrycode !== 'GB' || p.state === 'Scotland' || p.state === 'Northern Ireland') continue
    const name = p.name ?? p.street ?? p.city
    if (!name) continue
    const detail = [p.city !== name ? p.city : null, p.county, p.state?.replace('Cymru / ', '')]
      .filter(Boolean)
      .join(', ')
    out.push({ name, detail, pos: f.geometry.coordinates })
  }
  return out.slice(0, 6)
}
