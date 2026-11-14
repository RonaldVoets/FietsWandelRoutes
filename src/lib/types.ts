export type Mode = 'fiets' | 'wandel'
export type LngLat = [number, number]

export interface Route {
  /** [lon, lat, hoogte in m] */
  coords: [number, number, number][]
  /** cumulatieve afstand in m per punt */
  cum: number[]
  distance: number
  ascent: number
  /** lijn op volle detail voor de kaart (bekende routes); anders tekent de kaart coords */
  line?: LngLat[][]
}

export interface SavedRoute {
  id: string
  name: string
  mode: Mode
  created: number
  /** bekende route: wordt bij openen opnieuw opgehaald, coords blijft dan leeg */
  trail?: { type: string; id: number; host?: 'hiking' | 'cycling' | 'mtb' }
  /** leeg bij een geïmporteerde GPX of bekende route */
  waypoints: LngLat[]
  coords: [number, number, number][]
  distance: number
  ascent: number
}
