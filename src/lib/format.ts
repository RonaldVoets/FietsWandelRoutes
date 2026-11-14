import type { Mode } from './types'

export function fmtKm(m: number): string {
  const km = m / 1000
  return km.toLocaleString('nl-NL', {
    minimumFractionDigits: km < 100 ? 1 : 0,
    maximumFractionDigits: km < 100 ? 1 : 0,
  })
}

/** Schatting: fiets 18 km/u, wandelen 4,5 km/u, plus extra tijd voor klimmen. */
export function estimateMinutes(distance: number, ascent: number, mode: Mode): number {
  const km = distance / 1000
  return mode === 'fiets' ? (km / 18) * 60 + ascent / 25 : (km / 4.5) * 60 + ascent / 10
}

export function fmtDuration(min: number): string {
  const m = Math.max(1, Math.round(min))
  const h = Math.floor(m / 60)
  if (h === 0) return `${m} min`
  return `${h}:${String(m % 60).padStart(2, '0')} u`
}
