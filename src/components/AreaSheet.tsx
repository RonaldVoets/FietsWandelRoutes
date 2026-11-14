import { useEffect, useMemo, useState } from 'react'
import { fmtKm, fmtTime } from '../lib/format'
import { LEVELS, trailKey, trailLength, type TrailHit } from '../lib/trails'
import type { Mode } from '../lib/types'
import Icon from './Icon'

type Sort = 'niveau' | 'kort' | 'lang'
const SORTS: [Sort, string][] = [
  ['niveau', 'Niveau'],
  ['kort', 'Kortste eerst'],
  ['lang', 'Langste eerst'],
]

interface Props {
  mode: Mode
  area: { hits: TrailHit[]; capped: boolean } | 'laden'
  onClose(): void
  onPick(hit: TrailHit): void
}

/** Lijst met alle bekende routes in het kaartbeeld, met afstand en geschatte duur. */
export default function AreaSheet({ mode, area, onClose, onPick }: Props) {
  const [sort, setSort] = useState<Sort>('niveau')
  const [lengths, setLengths] = useState<Record<string, number | null>>({})
  const hits = area === 'laden' ? null : area.hits

  // lengtes ophalen, vier tegelijk, zodat de routedienst niet overspoeld wordt
  useEffect(() => {
    if (!hits) return
    const ac = new AbortController()
    let i = 0
    const worker = async () => {
      while (i < hits.length && !ac.signal.aborted) {
        const h = hits[i++]
        const len = await trailLength(h, ac.signal).catch(() => null)
        if (!ac.signal.aborted) setLengths((l) => ({ ...l, [trailKey(h)]: len }))
      }
    }
    for (let n = 0; n < 4; n++) worker()
    return () => ac.abort()
  }, [hits])

  const sorted = useMemo(() => {
    if (!hits || sort === 'niveau') return hits
    const dir = sort === 'kort' ? 1 : -1
    // routes waarvan de lengte nog niet bekend is, staan onderaan
    return [...hits].sort((a, b) => {
      const la = lengths[trailKey(a)]
      const lb = lengths[trailKey(b)]
      if (la == null && lb == null) return a.name.localeCompare(b.name)
      if (la == null) return 1
      if (lb == null) return -1
      return (la - lb) * dir
    })
  }, [hits, sort, lengths])

  const row = (h: TrailHit, withLevel: boolean) => {
    const key = trailKey(h)
    const len = lengths[key]
    const extra = [withLevel && h.level, h.ref, h.mtb && 'MTB'].filter(Boolean).join(' · ')
    return (
      <li key={key}>
        <button className="route-item" onClick={() => onPick(h)}>
          <span className="route-text">
            <strong>{h.name}</strong>
            <span>
              {len === undefined ? (
                'Afstand ophalen…'
              ) : len === null ? (
                'Afstand onbekend'
              ) : (
                <>
                  <b>{fmtKm(len)} km</b> · ca. {fmtTime(len, 0, mode)}
                </>
              )}
              {extra && ` · ${extra}`}
            </span>
          </span>
          <span className="pick-go">Bekijk</span>
        </button>
      </li>
    )
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="Bekende routes in beeld" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>
            {mode === 'fiets' ? 'Fietsroutes' : 'Wandelroutes'} in beeld
            {hits && <span className="count">{hits.length}</span>}
          </h2>
          <button className="icon-btn" aria-label="Sluiten" onClick={onClose}>
            <Icon name="sluit" />
          </button>
        </div>
        {!hits || !sorted ? (
          <p className="empty">Routes ophalen…</p>
        ) : hits.length === 0 ? (
          <p className="empty">Geen bekende routes in dit kaartbeeld. Schuif of zoom uit en probeer het opnieuw.</p>
        ) : (
          <>
            <div className="sortbar" role="tablist" aria-label="Sorteren">
              {SORTS.map(([id, label]) => (
                <button key={id} role="tab" aria-selected={sort === id} onClick={() => setSort(id)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="area-list">
              {area !== 'laden' && area.capped && (
                <p className="empty">Er zijn meer routes dan hier passen. Zoom in voor de volledige lijst.</p>
              )}
              {sort === 'niveau' ? (
                LEVELS.map((lv) => {
                  const group = hits.filter((h) => h.level === lv)
                  if (group.length === 0) return null
                  return (
                    <section key={lv}>
                      <h3>
                        {lv} · {group.length}
                      </h3>
                      <ul className="routes">{group.map((h) => row(h, false))}</ul>
                    </section>
                  )
                })
              ) : (
                <ul className="routes">{sorted.map((h) => row(h, true))}</ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
