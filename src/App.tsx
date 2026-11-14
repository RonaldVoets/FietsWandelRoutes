import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ElevationProfile from './components/ElevationProfile'
import Icon from './components/Icon'
import MapView, { type MapHandle } from './components/MapView'
import SearchBar from './components/SearchBar'
import { estimateMinutes, fmtDuration, fmtKm } from './lib/format'
import { buildRoute, nearestIndex } from './lib/geo'
import { parseGpx, shareGpx } from './lib/gpx'
import { fetchRoute } from './lib/routing'
import { loadDraft, loadRoutes, storeDraft, storeRoutes } from './lib/storage'
import type { LngLat, Mode, Route, SavedRoute } from './lib/types'

const MODE_LABEL: Record<Mode, string> = { fiets: 'Fietsen', wandel: 'Wandelen' }
const draft = loadDraft()

export default function App() {
  const map = useRef<MapHandle>(null)
  const panel = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const [mode, setMode] = useState<Mode>(draft.mode)
  const [waypoints, setWaypoints] = useState<LngLat[]>(draft.waypoints)
  const [history, setHistory] = useState<LngLat[][]>([])
  const [route, setRoute] = useState<Route | null>(null)
  const [imported, setImported] = useState(false)
  const [name, setName] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [scrub, setScrub] = useState<number | null>(null)
  const [showTrails, setShowTrails] = useState(true)
  const [userPos, setUserPos] = useState<LngLat | null>(null)
  const [saved, setSaved] = useState<SavedRoute[]>(loadRoutes)
  const [listOpen, setListOpen] = useState(false)
  const [saveName, setSaveName] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const notify = useCallback((msg: string) => setToast(msg), [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  // hoogte van het paneel, zodat kaartknoppen en bronvermelding erboven blijven
  useEffect(() => {
    const el = panel.current!
    const ro = new ResizeObserver(() =>
      document.documentElement.style.setProperty('--panel-h', `${el.offsetHeight}px`),
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    storeDraft({ mode, waypoints })
  }, [mode, waypoints])

  // route berekenen
  const routeKey = useRef('')
  useEffect(() => {
    if (waypoints.length < 2) {
      routeKey.current = ''
      setLoading(false)
      if (!imported) setRoute(null)
      return
    }
    const key = mode + JSON.stringify(waypoints)
    if (key === routeKey.current) {
      setLoading(false)
      return
    }
    const ac = new AbortController()
    setLoading(true)
    const t = setTimeout(() => {
      fetchRoute(waypoints, mode, ac.signal)
        .then((r) => {
          routeKey.current = key
          setRoute(r)
          setLoading(false)
        })
        .catch((e: Error) => {
          if (e.name === 'AbortError') return
          setLoading(false)
          notify(e instanceof TypeError ? 'Geen verbinding met de routedienst.' : e.message)
        })
    }, 120)
    return () => {
      clearTimeout(t)
      ac.abort()
    }
  }, [waypoints, mode, imported, notify])

  const commit = (next: LngLat[]) => {
    setHistory((h) => [...h.slice(-49), waypoints])
    setWaypoints(next)
    setSelected(null)
    setName(null)
  }

  const onTap = (p: LngLat) => {
    if (selected !== null) return setSelected(null)
    if (imported) return notify('Dit is een geïmporteerde route. Kies Wis om zelf te plannen.')
    commit([...waypoints, p])
  }

  const undo = () => {
    const prev = history[history.length - 1]
    if (!prev) return
    setHistory((h) => h.slice(0, -1))
    setWaypoints(prev)
    setSelected(null)
  }

  const clear = () => {
    if (imported) {
      setImported(false)
      setRoute(null)
      setWaypoints([])
      setHistory([])
    } else commit([])
    setName(null)
  }

  const closed =
    waypoints.length > 2 &&
    waypoints[0][0] === waypoints[waypoints.length - 1][0] &&
    waypoints[0][1] === waypoints[waypoints.length - 1][1]

  // ---- opslaan, laden, GPX ----
  const defaultName = () =>
    name ?? `${mode === 'fiets' ? 'Fietsroute' : 'Wandelroute'} ${route ? fmtKm(route.distance) : ''} km`

  const save = (routeName: string) => {
    if (!route) return
    const item: SavedRoute = {
      id: crypto.randomUUID(),
      name: routeName,
      mode,
      created: Date.now(),
      waypoints: imported ? [] : waypoints,
      coords: route.coords.map((c) => [+c[0].toFixed(5), +c[1].toFixed(5), Math.round(c[2])]),
      distance: route.distance,
      ascent: route.ascent,
    }
    const next = [item, ...saved]
    if (!storeRoutes(next)) return notify('Opslaan lukt niet: de opslag van dit toestel is vol.')
    setSaved(next)
    setName(routeName)
    notify('Route opgeslagen.')
  }

  const open = (s: SavedRoute) => {
    const r = buildRoute(s.coords, s.ascent)
    routeKey.current = s.waypoints.length >= 2 ? s.mode + JSON.stringify(s.waypoints) : ''
    setMode(s.mode)
    setWaypoints(s.waypoints)
    setImported(s.waypoints.length < 2)
    setHistory([])
    setSelected(null)
    setRoute(r)
    setName(s.name)
    setListOpen(false)
    map.current?.fit(r.coords)
  }

  const remove = (s: SavedRoute) => {
    if (!confirm(`"${s.name}" verwijderen?`)) return
    const next = saved.filter((x) => x.id !== s.id)
    storeRoutes(next)
    setSaved(next)
  }

  const importFile = async (file: File) => {
    try {
      const { name: gpxName, route: r } = parseGpx(await file.text())
      const item: SavedRoute = {
        id: crypto.randomUUID(),
        name: gpxName,
        mode,
        created: Date.now(),
        waypoints: [],
        coords: r.coords.map((c) => [+c[0].toFixed(5), +c[1].toFixed(5), Math.round(c[2])]),
        distance: r.distance,
        ascent: r.ascent,
      }
      const next = [item, ...saved]
      if (storeRoutes(next)) setSaved(next)
      open(item)
    } catch (e) {
      notify((e as Error).message)
    }
  }

  // ---- eigen locatie ----
  const watching = useRef(false)
  const locate = () => {
    if (userPos) return map.current?.flyTo(userPos, 15)
    if (watching.current) return
    if (!navigator.geolocation) return notify('Dit toestel geeft geen locatie door.')
    watching.current = true
    let first = true
    navigator.geolocation.watchPosition(
      (pos) => {
        const p: LngLat = [pos.coords.longitude, pos.coords.latitude]
        setUserPos(p)
        if (first) map.current?.flyTo(p, 15)
        first = false
      },
      () => {
        if (first) notify('Locatie niet beschikbaar. Sta locatietoegang toe voor deze site.')
      },
      { enableHighAccuracy: true, maximumAge: 5000 },
    )
  }

  const remaining = useMemo(() => {
    if (!route || !userPos) return null
    const n = nearestIndex(route, userPos)
    return n.dist < 200 ? route.distance - route.cum[n.index] : null
  }, [route, userPos])

  const hint = imported
    ? null
    : waypoints.length === 0
      ? 'Tik op de kaart om je startpunt te kiezen'
      : waypoints.length === 1
        ? 'Tik op de kaart voor je volgende punt'
        : null

  return (
    <div className="app" data-mode={mode}>
      <MapView
        ref={map}
        mode={mode}
        waypoints={waypoints}
        route={route}
        selected={selected}
        showTrails={showTrails}
        scrub={scrub}
        userPos={userPos}
        onTap={onTap}
        onMove={(i, p) => commit(waypoints.map((w, j) => (j === i ? p : w)))}
        onSelect={(i) => setSelected((s) => (s === i ? null : i))}
      />

      <header className="top">
        <SearchBar onPick={(p) => map.current?.flyTo(p, 13)} />
        <button className="fab" aria-label="Mijn routes" onClick={() => setListOpen(true)}>
          <Icon name="lijst" />
          {saved.length > 0 && <span className="badge">{saved.length}</span>}
        </button>
      </header>

      <div className="side">
        <button
          className={`fab${showTrails ? ' fab-on' : ''}`}
          aria-label="Bekende routes tonen"
          aria-pressed={showTrails}
          onClick={() => {
            setShowTrails(!showTrails)
            notify(showTrails ? 'Bekende routes verborgen' : `Bekende ${mode === 'fiets' ? 'fietsroutes' : 'wandelroutes'} zichtbaar`)
          }}
        >
          <Icon name="lagen" />
        </button>
        <button className={`fab${userPos ? ' fab-on' : ''}`} aria-label="Mijn locatie" onClick={locate}>
          <Icon name="locatie" />
        </button>
      </div>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      <section className="panel" ref={panel}>
        {loading && <div className="loading" />}
        <div className="segment" role="tablist" aria-label="Soort route">
          {(['fiets', 'wandel'] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}>
              <Icon name={m} size={20} />
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>

        {name && route && <div className="route-name">{name}</div>}

        {route && (
          <>
            <div className="stats">
              <div>
                <strong>{fmtKm(route.distance)}</strong>
                <span>km{remaining !== null && ` · nog ${fmtKm(remaining)}`}</span>
              </div>
              <div>
                <strong>{route.ascent.toLocaleString('nl-NL')}</strong>
                <span>m stijgen</span>
              </div>
              <div>
                <strong>{fmtDuration(estimateMinutes(route.distance, route.ascent, mode))}</strong>
                <span>geschat</span>
              </div>
            </div>
            <ElevationProfile route={route} scrub={scrub} onScrub={setScrub} />
          </>
        )}

        {selected !== null ? (
          <div className="selected-bar">
            <span>
              {selected === 0 ? 'Startpunt' : selected === waypoints.length - 1 ? 'Eindpunt' : `Punt ${selected + 1}`} · sleep om te
              verplaatsen
            </span>
            <button onClick={() => commit(waypoints.filter((_, i) => i !== selected))}>Verwijder</button>
          </div>
        ) : (
          hint && <p className="hint">{hint}</p>
        )}

        {(waypoints.length > 0 || route || history.length > 0) && (
          <div className="actions">
            {!imported && (
              <>
                <button onClick={undo} disabled={history.length === 0}>
                  <Icon name="undo" />
                  Terug
                </button>
                <button onClick={() => commit([...waypoints, waypoints[0]])} disabled={waypoints.length < 2 || closed}>
                  <Icon name="rondje" />
                  Rondje
                </button>
                <button onClick={() => commit([...waypoints].reverse())} disabled={waypoints.length < 2}>
                  <Icon name="omkeren" />
                  Omkeren
                </button>
              </>
            )}
            <button onClick={() => setSaveName(defaultName())} disabled={!route || loading}>
              <Icon name="opslaan" />
              Opslaan
            </button>
            <button
              onClick={() => route && shareGpx(defaultName(), route).catch(() => notify('Delen is niet gelukt.'))}
              disabled={!route || loading}
            >
              <Icon name="delen" />
              GPX
            </button>
            <button onClick={clear} disabled={waypoints.length === 0 && !route}>
              <Icon name="wis" />
              Wis
            </button>
          </div>
        )}
      </section>

      {listOpen && (
        <div className="overlay" onClick={() => setListOpen(false)}>
          <div className="sheet" role="dialog" aria-label="Mijn routes" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <h2>Mijn routes</h2>
              <button className="icon-btn" aria-label="Sluiten" onClick={() => setListOpen(false)}>
                <Icon name="sluit" />
              </button>
            </div>
            {saved.length === 0 ? (
              <p className="empty">
                Nog geen routes. Plan een route en kies Opslaan, of importeer een GPX-bestand uit komoot of RouteYou.
              </p>
            ) : (
              <ul className="routes">
                {saved.map((s) => (
                  <li key={s.id}>
                    <button className="route-item" data-mode={s.mode} onClick={() => open(s)}>
                      <span className="route-icon">
                        <Icon name={s.mode} size={20} />
                      </span>
                      <span className="route-text">
                        <strong>{s.name}</strong>
                        <span>
                          {fmtKm(s.distance)} km · {s.ascent} m stijgen ·{' '}
                          {fmtDuration(estimateMinutes(s.distance, s.ascent, s.mode))}
                        </span>
                      </span>
                    </button>
                    <button className="icon-btn" aria-label={`${s.name} verwijderen`} onClick={() => remove(s)}>
                      <Icon name="wis" size={20} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button className="primary" onClick={() => fileInput.current?.click()}>
              <Icon name="import" size={20} />
              GPX importeren
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".gpx,application/gpx+xml,application/xml,text/xml"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) importFile(f)
              }}
            />
          </div>
        </div>
      )}

      {saveName !== null && (
        <div className="overlay overlay-center" onClick={() => setSaveName(null)}>
          <form
            className="dialog"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault()
              save(saveName.trim() || defaultName())
              setSaveName(null)
            }}
          >
            <h2>Route opslaan</h2>
            <input
              autoFocus
              value={saveName}
              aria-label="Naam van de route"
              onChange={(e) => setSaveName(e.target.value)}
              onFocus={(e) => e.target.select()}
            />
            <div className="dialog-buttons">
              <button type="button" onClick={() => setSaveName(null)}>
                Annuleer
              </button>
              <button type="submit" className="primary">
                Opslaan
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
