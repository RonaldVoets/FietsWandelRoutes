import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { nearestIndex } from '../lib/geo'
import { routePhotos, type Photo } from '../lib/photos'
import type { Route } from '../lib/types'
import Icon from './Icon'

const PREF = 'fwr.photos'

interface Props {
  route: Route
  /** laat op kaart en profiel zien waar de foto genomen is */
  onLocate(index: number | null): void
}

/** Optionele strook met foto's langs de route; de keuze aan/uit wordt onthouden. */
export default function RoutePhotos({ route, onLocate }: Props) {
  const [on, setOn] = useState(() => localStorage.getItem(PREF) === '1')
  const [photos, setPhotos] = useState<Photo[] | null | 'fout'>(null)
  const [open, setOpen] = useState<number | null>(null)

  useEffect(() => {
    setPhotos(null)
    setOpen(null)
    if (!on) return
    const ac = new AbortController()
    routePhotos(route, ac.signal)
      .then(setPhotos)
      .catch((e: Error) => e.name !== 'AbortError' && setPhotos('fout'))
    return () => ac.abort()
  }, [route, on])

  const toggle = () => {
    const next = !on
    setOn(next)
    try {
      localStorage.setItem(PREF, next ? '1' : '0')
    } catch {
      // geen opslag: dan alleen voor nu
    }
  }

  const show = (i: number | null) => {
    setOpen(i)
    if (i === null || !Array.isArray(photos)) return onLocate(null)
    onLocate(nearestIndex(route, photos[i].pos).index)
  }

  const list = Array.isArray(photos) ? photos : []
  const cur = open !== null ? list[open] : null

  return (
    <div className="photos">
      <button className="photos-toggle" aria-pressed={on} onClick={toggle}>
        <Icon name="foto" size={18} />
        {on ? "Foto's verbergen" : "Foto's langs de route"}
      </button>
      {on &&
        (photos === null ? (
          <p className="photos-note">Foto's ophalen…</p>
        ) : photos === 'fout' ? (
          <p className="photos-note">Foto's zijn nu niet op te halen.</p>
        ) : list.length === 0 ? (
          <p className="photos-note">Geen foto's gevonden langs deze route.</p>
        ) : (
          <div className="photo-strip">
            {list.map((p, i) => (
              <button key={p.id} onClick={() => show(i)} aria-label={p.title}>
                <img src={p.thumb} alt={p.title} loading="lazy" />
              </button>
            ))}
          </div>
        ))}

      {/* buiten het paneel getekend, zodat de foto het hele scherm vult */}
      {cur &&
        open !== null &&
        createPortal(
          <div className="lightbox" role="dialog" aria-label={cur.title} onClick={() => show(null)}>
            <button className="icon-btn lightbox-close" aria-label="Sluiten" onClick={() => show(null)}>
              <Icon name="sluit" />
            </button>
            <img src={cur.large} alt={cur.title} onClick={(e) => e.stopPropagation()} />
            <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
              <button disabled={open === 0} onClick={() => show(open - 1)} aria-label="Vorige foto">
                ‹
              </button>
              <p>
                <strong>{cur.title}</strong>
                <span>
                  {open + 1} van {list.length} · © {cur.author}
                  {cur.licence && ` · ${cur.licence}`} ·{' '}
                  <a href={cur.page} target="_blank" rel="noreferrer">
                    Wikimedia Commons
                  </a>
                </span>
              </p>
              <button disabled={open === list.length - 1} onClick={() => show(open + 1)} aria-label="Volgende foto">
                ›
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
