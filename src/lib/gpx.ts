import { buildRoute } from './geo'
import type { Route } from './types'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function toGpx(name: string, route: Route): string {
  const pts = route.coords
    .map((c) => `<trkpt lat="${c[1].toFixed(6)}" lon="${c[0].toFixed(6)}"><ele>${c[2].toFixed(1)}</ele></trkpt>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="FietsWandelRoutes" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>${esc(name)}</name></metadata>
<trk><name>${esc(name)}</name><trkseg>
${pts}
</trkseg></trk>
</gpx>
`
}

export function parseGpx(text: string): { name: string; route: Route } {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('Dit is geen geldig GPX-bestand.')
  let nodes = Array.from(doc.getElementsByTagName('trkpt'))
  if (nodes.length < 2) nodes = Array.from(doc.getElementsByTagName('rtept'))
  if (nodes.length < 2) throw new Error('Er staat geen route in dit GPX-bestand.')
  let last = 0
  const coords: [number, number, number][] = []
  for (const n of nodes) {
    const lat = Number(n.getAttribute('lat'))
    const lon = Number(n.getAttribute('lon'))
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const ele = Number(n.getElementsByTagName('ele')[0]?.textContent)
    if (Number.isFinite(ele)) last = ele
    coords.push([lon, lat, last])
  }
  if (coords.length < 2) throw new Error('Er staat geen route in dit GPX-bestand.')
  const name = doc.getElementsByTagName('name')[0]?.textContent?.trim() || 'Geïmporteerde route'
  return { name, route: buildRoute(coords) }
}

/** Deelt het GPX-bestand via het iPhone-deelmenu, of downloadt het als delen niet kan. */
export async function shareGpx(name: string, route: Route): Promise<void> {
  const filename = `${name.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'route'}.gpx`
  const file = new File([toGpx(name, route)], filename, { type: 'application/gpx+xml' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') throw e
    }
    return
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(file)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
