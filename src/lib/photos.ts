import { haversine } from './geo'
import type { Route } from './types'

// Foto's langs de route uit Wikimedia Commons: vrij te gebruiken, met naamsvermelding.
// Veel ervan komen uit Geograph, dat heel Groot-Brittannië per vierkante kilometer vastlegt.
const API = 'https://commons.wikimedia.org/w/api.php'

export interface Photo {
  id: number
  title: string
  thumb: string
  large: string
  page: string
  author: string
  licence: string
  pos: [number, number]
  /** index van het routepunt waar de foto bij hoort */
  at: number
}

const strip = (html?: string) =>
  (html ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .trim()

/** Leesbare titel uit de bestandsnaam: zonder "File:", extensie en Geograph-nummer. */
const titleOf = (file: string) =>
  file
    .replace(/^File:/, '')
    .replace(/\.\w+$/, '')
    .replace(/\s*-\s*geograph\.org\.uk\s*-\s*\d+$/i, '')
    .replace(/_/g, ' ')

async function near(lat: number, lon: number, radius: number, at: number, signal?: AbortSignal): Promise<Photo[]> {
  const q = new URLSearchParams({
    action: 'query',
    generator: 'geosearch',
    ggscoord: `${lat.toFixed(5)}|${lon.toFixed(5)}`,
    ggsradius: String(Math.round(radius)),
    ggsnamespace: '6',
    ggslimit: '20',
    prop: 'imageinfo|coordinates',
    iiprop: 'url|extmetadata|size|mime',
    iiextmetadatafilter: 'Artist|LicenseShortName',
    iiurlwidth: '960',
    format: 'json',
    origin: '*',
  })
  const res = await fetch(`${API}?${q}`, { signal })
  if (!res.ok) return []
  const pages = Object.values((await res.json()).query?.pages ?? {}) as any[]
  // de dienst geeft de dichtstbijzijnde eerst
  pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  const out: Photo[] = []
  for (const p of pages) {
    const i = p.imageinfo?.[0]
    const c = p.coordinates?.[0]
    // alleen liggende foto's: dat zijn meestal de uitzichten, en ze passen in de strook
    if (!i?.thumburl || !c || i.mime !== 'image/jpeg' || i.width < 600 || i.width <= i.height) continue
    out.push({
      id: p.pageid,
      title: titleOf(p.title),
      // dezelfde afbeelding, kleiner, voor de strook
      thumb: i.thumburl.replace(/\/\d+px-/, '/330px-'),
      large: i.thumburl,
      page: i.descriptionurl,
      author: strip(i.extmetadata?.Artist?.value) || 'Onbekend',
      licence: strip(i.extmetadata?.LicenseShortName?.value),
      pos: [c.lon, c.lat],
      at,
    })
  }
  return out
}

/** Hooguit 18 foto's, verspreid over de route en in looprichting. */
export async function routePhotos(route: Route, signal?: AbortSignal): Promise<Photo[]> {
  const n = route.coords.length
  if (n < 2) return []
  const spots = Math.min(6, Math.max(2, Math.round(route.distance / 2000)))
  // zoekstraal: de halve afstand tussen de zoekpunten, zodat ze elkaar net raken
  const radius = Math.min(2000, Math.max(400, route.distance / spots / 2))
  const idx: number[] = []
  let j = 0
  for (let k = 0; k < spots; k++) {
    const d = (route.distance * (k + 0.5)) / spots
    while (j < n - 1 && route.cum[j] < d) j++
    idx.push(j)
  }
  const lists = await Promise.all(
    idx.map((i) =>
      near(route.coords[i][1], route.coords[i][0], radius, i, signal).catch((e) => {
        if ((e as Error).name === 'AbortError') throw e
        return [] as Photo[]
      }),
    ),
  )
  const seen = new Set<number>()
  // foto's van dezelfde plek lijken op elkaar: houd er afstand tussen
  const apart = Math.min(250, Math.max(60, route.distance / 40))
  const perSpot = Math.ceil(18 / spots)
  const out: Photo[] = []
  for (const list of lists) {
    let taken = 0
    for (const p of list) {
      if (taken >= perSpot) break
      if (seen.has(p.id) || out.some((o) => haversine(o.pos, p.pos) < apart)) continue
      seen.add(p.id)
      out.push(p)
      taken++
    }
  }
  return out
}
