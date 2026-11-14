import type { LngLat, Mode, SavedRoute } from './types'

const ROUTES = 'fwr.routes'
const DRAFT = 'fwr.draft'

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export const loadRoutes = () => read<SavedRoute[]>(ROUTES, [])
export const storeRoutes = (r: SavedRoute[]) => write(ROUTES, r)

export interface Draft {
  mode: Mode
  waypoints: LngLat[]
}
export const loadDraft = () => read<Draft>(DRAFT, { mode: 'fiets', waypoints: [] })
export const storeDraft = (d: Draft) => write(DRAFT, d)
