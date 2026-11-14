export type Mode = 'fiets' | 'wandel'
export type LngLat = [number, number]

export interface Route {
  /** [lon, lat, hoogte in m] */
  coords: [number, number, number][]
  /** cumulatieve afstand in m per punt */
  cum: number[]
  distance: number
  ascent: number
}

export interface SavedRoute {
  id: string
  name: string
  mode: Mode
  created: number
  /** leeg bij een geïmporteerde GPX */
  waypoints: LngLat[]
  coords: [number, number, number][]
  distance: number
  ascent: number
}
