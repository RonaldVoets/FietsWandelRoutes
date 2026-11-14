import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { AttributionControl, LngLatBounds, Map as MlMap, Marker, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { LngLat, Mode, Route } from '../lib/types'

export const MODE_COLOR: Record<Mode, string> = { fiets: '#0b63ce', wandel: '#c2410c' }

// Vite bundelt de kaart-worker zelf; zonder dit vindt MapLibre hem niet.
setWorkerUrl(workerUrl)

// Beginbeeld: Engeland, van Land's End tot de Schotse grens
const START_BOUNDS: [LngLat, LngLat] = [
  [-5.4, 50.0],
  [1.8, 55.6],
]

const TRAILS_ATTR =
  'Routes: <a href="https://waymarkedtrails.org" target="_blank" rel="noreferrer">Waymarked Trails</a>, ' +
  '<a href="https://adventureonfoot.co.uk/registry/licence" target="_blank" rel="noreferrer">Adventure On Foot</a>. ' +
  'Forest routes in Wales: Natural Resources Wales (OGL), via <a href="https://www.traillines.co.uk/open-data" target="_blank" rel="noreferrer">Trail Lines</a>. ' +
  'Contains, or is based on, information supplied by the Forestry Commission. ' +
  '© Crown copyright and database right 2026 Ordnance Survey AC0000814847'

interface Props {
  mode: Mode
  waypoints: LngLat[]
  route: Route | null
  selected: number | null
  showTrails: boolean
  /** index in route.coords van het punt onder de vinger in het hoogteprofiel */
  scrub: number | null
  userPos: LngLat | null
  onTap(p: LngLat, zoom: number): void
  onMove(index: number, p: LngLat): void
  onSelect(index: number): void
}

export interface MapHandle {
  flyTo(p: LngLat, zoom?: number): void
  fit(coords: ArrayLike<number>[]): void
  /** kaartbeeld als [west, zuid, oost, noord] */
  bounds(): [number, number, number, number] | null
}

function padding() {
  const h = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--panel-h')) || 200
  return { top: 110, bottom: h + 40, left: 48, right: 48 }
}

function dot(className: string, label = ''): HTMLDivElement {
  const el = document.createElement('div')
  el.className = className
  el.textContent = label
  return el
}

const MapView = forwardRef<MapHandle, Props>(function MapView(props, ref) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const latest = useRef(props)
  latest.current = props
  const [ready, setReady] = useState(false)
  const { mode, waypoints, route, selected, showTrails, scrub, userPos } = props

  const fit = (coords: ArrayLike<number>[]) => {
    const map = mapRef.current
    if (!map || coords.length === 0) return
    if (coords.length === 1) {
      map.flyTo({ center: [coords[0][0], coords[0][1]], zoom: 13 })
      return
    }
    const b = new LngLatBounds()
    for (const c of coords) b.extend([c[0], c[1]])
    map.fitBounds(b, { padding: padding(), maxZoom: 15, duration: 600 })
  }

  useImperativeHandle(ref, () => ({
    flyTo: (p, zoom = 13) => mapRef.current?.flyTo({ center: p, zoom: Math.max(zoom, mapRef.current.getZoom()) }),
    fit,
    bounds: () => {
      const b = mapRef.current?.getBounds()
      return b ? [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] : null
    },
  }))

  useEffect(() => {
    const map = new MlMap({
      container: container.current!,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      bounds: START_BOUNDS,
      // ruimte voor de zoekbalk boven en het paneel onder
      fitBoundsOptions: { padding: { top: 76, bottom: 236, left: 6, right: 6 } },
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      maxPitch: 0,
    })
    mapRef.current = map
    map.touchZoomRotate.disableRotation()
    map.addControl(new AttributionControl({ compact: true }), 'bottom-left')

    map.on('load', () => {
      for (const m of ['wandel', 'fiets', 'mtb'] as const) {
        map.addSource(`trails-${m}`, {
          type: 'raster',
          tiles: [`https://tile.waymarkedtrails.org/${m === 'fiets' ? 'cycling' : m === 'mtb' ? 'mtb' : 'hiking'}/{z}/{x}/{y}.png`],
          tileSize: 256,
          attribution: TRAILS_ATTR,
        })
        map.addLayer({
          id: `trails-${m}`,
          type: 'raster',
          source: `trails-${m}`,
          layout: { visibility: 'none' },
          paint: { 'raster-opacity': 0.75 },
        })
      }
      map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'route-casing',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.9 },
      })
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': MODE_COLOR[latest.current.mode], 'line-width': 5 },
      })
      // bronvermelding start ingeklapt (i-knop), zodat hij de kaart niet bedekt
      const attrib = container.current?.querySelector('.maplibregl-ctrl-attrib')
      attrib?.classList.remove('maplibregl-compact-show')
      attrib?.removeAttribute('open')
      const p = latest.current
      if (p.waypoints.length) fit(p.waypoints)
      setReady(true)
    })

    map.on('click', (e) => latest.current.onTap([e.lngLat.lng, e.lngLat.lat], map.getZoom()))

    return () => {
      mapRef.current = null
      map.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // routelijn
  useEffect(() => {
    if (!ready) return
    const src = mapRef.current!.getSource('route') as GeoJSONSource
    src.setData(
      route
        ? {
            type: 'Feature',
            properties: {},
            geometry: route.line
              ? { type: 'MultiLineString', coordinates: route.line }
              : { type: 'LineString', coordinates: route.coords },
          }
        : { type: 'FeatureCollection', features: [] },
    )
  }, [ready, route])

  // kleur en bekende routes per modus
  useEffect(() => {
    if (!ready) return
    const map = mapRef.current!
    map.setPaintProperty('route-line', 'line-color', MODE_COLOR[mode])
    // bij fietsen ook de mountainbikeroutes
    for (const m of ['wandel', 'fiets', 'mtb'] as const) {
      const on = showTrails && (m === 'mtb' ? mode === 'fiets' : m === mode)
      map.setLayoutProperty(`trails-${m}`, 'visibility', on ? 'visible' : 'none')
    }
  }, [ready, mode, showTrails])

  // punten
  const imported = waypoints.length === 0 && route !== null
  useEffect(() => {
    if (!ready) return
    const map = mapRef.current!
    const pts: ArrayLike<number>[] = imported ? [route!.coords[0], route!.coords[route!.coords.length - 1]] : waypoints
    const markers = pts.map((p, i) => {
      const kind = i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'mid'
      const el = dot(`wp wp-${kind}${selected === i ? ' wp-selected' : ''}`, kind === 'mid' ? String(i) : '')
      const marker = new Marker({ element: el, draggable: !imported }).setLngLat([p[0], p[1]]).addTo(map)
      if (!imported) {
        el.addEventListener('click', (e) => {
          e.stopPropagation()
          latest.current.onSelect(i)
        })
        marker.on('dragend', () => {
          const ll = marker.getLngLat()
          latest.current.onMove(i, [ll.lng, ll.lat])
        })
      }
      return marker
    })
    return () => markers.forEach((m) => m.remove())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, waypoints, selected, imported, imported ? route : null])

  // punt uit het hoogteprofiel
  useEffect(() => {
    if (!ready || scrub === null || !route) return
    const c = route.coords[scrub]
    if (!c) return
    const marker = new Marker({ element: dot('scrub-dot') }).setLngLat([c[0], c[1]]).addTo(mapRef.current!)
    return () => void marker.remove()
  }, [ready, scrub, route])

  // eigen positie
  const userMarker = useRef<Marker | null>(null)
  useEffect(() => {
    if (!ready) return
    if (!userPos) {
      userMarker.current?.remove()
      userMarker.current = null
      return
    }
    if (!userMarker.current)
      userMarker.current = new Marker({ element: dot('user-dot') }).setLngLat(userPos).addTo(mapRef.current!)
    else userMarker.current.setLngLat(userPos)
  }, [ready, userPos])

  return <div ref={container} className="map" />
})

export default MapView
