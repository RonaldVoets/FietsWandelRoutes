import type { TrailRef } from './trails'
import type { LngLat, Mode, Route } from './types'

// Een route delen als link: de ontvanger opent de app met dezelfde route.
// De route zit in het deel na de # van het adres, dus er gaat niets naar een server.
//  - bekende route:   #t=<bron>.<soort>.<id>
//  - geplande route:  #w=<punten>          (wordt bij openen opnieuw berekend)
//  - overige routes:  #p=<vereenvoudigde lijn>&d=<lengte in m>

export type Shared =
  | { kind: 'trail'; mode: Mode; trail: TrailRef }
  | { kind: 'points'; mode: Mode; name: string | null; waypoints: LngLat[] }
  | { kind: 'line'; mode: Mode; name: string | null; line: LngLat[]; distance: number }

// ---- lijn compact opslaan: verschillen tussen punten, als variabele-lengte-getallen in base64url ----
function pack(pts: LngLat[]): string {
  const bytes: number[] = []
  let px = 0
  let py = 0
  for (const p of pts) {
    const x = Math.round(p[0] * 1e5)
    const y = Math.round(p[1] * 1e5)
    for (const d of [x - px, y - py]) {
      let v = d < 0 ? -2 * d - 1 : 2 * d
      while (v >= 128) {
        bytes.push((v % 128) + 128)
        v = Math.floor(v / 128)
      }
      bytes.push(v)
    }
    px = x
    py = y
  }
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function unpack(text: string): LngLat[] {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  const nums: number[] = []
  let v = 0
  let mul = 1
  for (let i = 0; i < bin.length; i++) {
    const b = bin.charCodeAt(i)
    v += (b & 127) * mul
    if (b < 128) {
      nums.push(v % 2 ? -(v + 1) / 2 : v / 2)
      v = 0
      mul = 1
    } else mul *= 128
  }
  const pts: LngLat[] = []
  let x = 0
  let y = 0
  for (let i = 0; i + 1 < nums.length; i += 2) {
    x += nums[i]
    y += nums[i + 1]
    pts.push([x / 1e5, y / 1e5])
  }
  return pts
}

/** Douglas-Peucker: laat punten weg die minder dan tol (in graden) van de lijn afwijken. */
function simplify(pts: LngLat[], tol: number): LngLat[] {
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  const k = Math.cos((pts[0][1] * Math.PI) / 180)
  while (stack.length) {
    const [a, b] = stack.pop()!
    const ax = pts[a][0] * k
    const ay = pts[a][1]
    const dx = pts[b][0] * k - ax
    const dy = pts[b][1] - ay
    const len = dx * dx + dy * dy
    let worst = -1
    let far = 0
    for (let i = a + 1; i < b; i++) {
      const qx = pts[i][0] * k - ax
      const qy = pts[i][1] - ay
      const t = len ? Math.min(1, Math.max(0, (qx * dx + qy * dy) / len)) : 0
      const d = (qx - t * dx) ** 2 + (qy - t * dy) ** 2
      if (d > far) {
        far = d
        worst = i
      }
    }
    if (worst > 0 && far > tol * tol) {
      keep[worst] = 1
      stack.push([a, worst], [worst, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}

/** Hooguit zoveel punten in een link, zodat hij in een bericht past. */
const MAX_POINTS = 300

export function shareUrl(o: {
  mode: Mode
  name: string | null
  trail: TrailRef | null
  waypoints: LngLat[]
  route: Route
}): string {
  const q = new URLSearchParams()
  if (o.trail?.host) {
    q.set('t', `${o.trail.host}.${o.trail.type}.${o.trail.id}`)
  } else if (o.waypoints.length >= 2) {
    q.set('w', o.waypoints.map((p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join(';'))
  } else {
    let pts = o.route.coords.map((c) => [c[0], c[1]] as LngLat)
    // steeds grover tot het past; begint bij ongeveer 5 meter
    for (let tol = 0.00005; pts.length > MAX_POINTS; tol *= 1.6) pts = simplify(pts, tol)
    q.set('p', pack(pts))
    q.set('d', String(Math.round(o.route.distance)))
  }
  q.set('m', o.mode)
  if (o.name && !o.trail?.host) q.set('n', o.name)
  return `${location.origin}${location.pathname}#${q}`
}

/** Leest een gedeelde route uit het adres; null als er geen (geldige) in staat. */
export function readShared(hash: string): Shared | null {
  try {
    const q = new URLSearchParams(hash.replace(/^#/, ''))
    const mode: Mode = q.get('m') === 'fiets' ? 'fiets' : 'wandel'
    const name = q.get('n')?.slice(0, 80) || null
    const ok = (p: LngLat) =>
      Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90
    const t = q.get('t')?.split('.')
    if (
      t?.length === 3 &&
      ['hiking', 'cycling', 'mtb', 'fe'].includes(t[0]) &&
      /^\w+$/.test(t[1]) &&
      /^\d+$/.test(t[2])
    )
      return { kind: 'trail', mode, trail: { host: t[0] as TrailRef['host'], type: t[1], id: Number(t[2]) } }
    const w = q.get('w')
    if (w) {
      const waypoints = w.split(';').map((s) => s.split(',').map(Number) as LngLat)
      if (waypoints.length >= 2 && waypoints.length <= 60 && waypoints.every((p) => p.length === 2 && ok(p)))
        return { kind: 'points', mode, name, waypoints }
    }
    const p = q.get('p')
    if (p) {
      const line = unpack(p)
      if (line.length >= 2 && line.every(ok))
        return { kind: 'line', mode, name, line, distance: Number(q.get('d')) || 0 }
    }
  } catch {
    // onleesbare link: gewoon de app openen
  }
  return null
}

/** Opent het deelvenster van het toestel (WhatsApp, Mail, ...); zonder deelvenster wordt de link gekopieerd. */
export async function shareLink(
  title: string,
  text: string,
  url: string,
): Promise<'gedeeld' | 'gekopieerd' | 'geannuleerd'> {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url })
      return 'gedeeld'
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'geannuleerd'
    }
  }
  await navigator.clipboard.writeText(`${text}\n${url}`)
  return 'gekopieerd'
}
