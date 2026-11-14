import type { Route } from './types'

const R = 6371000
const rad = (d: number) => (d * Math.PI) / 180

export function haversine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const dLat = rad(b[1] - a[1])
  const dLon = rad(b[0] - a[0])
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Stijging met een drempel van 5 m, zodat GPS-ruis niet meetelt. */
export function ascentOf(coords: [number, number, number][]): number {
  let total = 0
  let ref = coords[0]?.[2] ?? 0
  for (const c of coords) {
    const d = c[2] - ref
    if (d >= 5) {
      total += d
      ref = c[2]
    } else if (d <= -5) {
      ref = c[2]
    }
  }
  return Math.round(total)
}

export function buildRoute(coords: [number, number, number][], ascent?: number): Route {
  const cum = new Array<number>(coords.length)
  let d = 0
  for (let i = 0; i < coords.length; i++) {
    if (i > 0) d += haversine(coords[i - 1], coords[i])
    cum[i] = d
  }
  return { coords, cum, distance: d, ascent: ascent ?? ascentOf(coords) }
}

/** Index van het routepunt dat het dichtst bij een positie ligt, met de afstand ernaartoe. */
export function nearestIndex(route: Route, pos: ArrayLike<number>): { index: number; dist: number } {
  let index = 0
  let dist = Infinity
  for (let i = 0; i < route.coords.length; i++) {
    const d = haversine(route.coords[i], pos)
    if (d < dist) {
      dist = d
      index = i
    }
  }
  return { index, dist }
}
