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

/** Aantal dagen als de route te lang is voor één dag, anders null. */
export function multiDay(distance: number, mode: Mode): number | null {
  const km = distance / 1000
  if (mode === 'fiets') return km > 130 ? Math.ceil(km / 65) : null
  return km > 35 ? Math.ceil(km / 22) : null
}

export type Difficulty = 'Makkelijk' | 'Gemiddeld' | 'Zwaar'

/**
 * Dagtocht: inspanning uit afstand plus klimmen.
 * Meerdaagse route: hoe heuvelachtig hij is (stijgmeters per km).
 */
export function difficulty(distance: number, ascent: number, mode: Mode): Difficulty {
  const km = Math.max(distance / 1000, 0.1)
  let score: number
  let limits: [number, number]
  if (multiDay(distance, mode)) {
    score = ascent / km
    limits = mode === 'fiets' ? [8, 15] : [20, 40]
  } else if (mode === 'fiets') {
    score = km + ascent / 40
    limits = [35, 70]
  } else {
    score = km + ascent / 100
    limits = [12, 22]
  }
  return score < limits[0] ? 'Makkelijk' : score < limits[1] ? 'Gemiddeld' : 'Zwaar'
}

/** Duur als tekst: uren voor een dagtocht, dagen voor een meerdaagse route. */
export function fmtTime(distance: number, ascent: number, mode: Mode): string {
  const days = multiDay(distance, mode)
  return days ? `${days} dagen` : fmtDuration(estimateMinutes(distance, ascent, mode))
}

export function fmtDuration(min: number): string {
  const m = Math.max(1, Math.round(min))
  const h = Math.floor(m / 60)
  if (h === 0) return `${m} min`
  return `${h}:${String(m % 60).padStart(2, '0')} u`
}
