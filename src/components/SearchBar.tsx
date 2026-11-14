import { useEffect, useState } from 'react'
import { searchPlaces, type Place } from '../lib/geocode'
import type { LngLat } from '../lib/types'
import Icon from './Icon'

export default function SearchBar({ onPick }: { onPick(pos: LngLat): void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Place[] | null>(null)

  useEffect(() => {
    const term = q.trim()
    if (term.length < 3) {
      setResults(null)
      return
    }
    const ac = new AbortController()
    const t = setTimeout(() => {
      searchPlaces(term, ac.signal)
        .then(setResults)
        .catch((e) => {
          if (e.name !== 'AbortError') setResults([])
        })
    }, 300)
    return () => {
      clearTimeout(t)
      ac.abort()
    }
  }, [q])

  const pick = (p: Place) => {
    onPick(p.pos)
    setQ('')
    setResults(null)
    ;(document.activeElement as HTMLElement | null)?.blur()
  }

  return (
    <div className="search">
      <div className="search-field">
        <Icon name="zoek" size={20} />
        <input
          type="search"
          inputMode="search"
          enterKeyHint="search"
          placeholder="Zoek plaats in Engeland of Wales"
          aria-label="Zoek plaats"
          autoComplete="off"
          autoCorrect="off"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results?.[0]) pick(results[0])
          }}
        />
        {q && (
          <button className="search-clear" aria-label="Wis zoekopdracht" onClick={() => setQ('')}>
            <Icon name="sluit" size={18} />
          </button>
        )}
      </div>
      {results && (
        <ul className="search-results">
          {results.length === 0 && <li className="search-empty">Niets gevonden</li>}
          {results.map((p, i) => (
            <li key={i}>
              <button onClick={() => pick(p)}>
                <strong>{p.name}</strong>
                {p.detail && <span>{p.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
