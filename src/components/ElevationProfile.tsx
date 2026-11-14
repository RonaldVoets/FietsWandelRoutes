import { useMemo, useRef } from 'react'
import type { Route } from '../lib/types'

const W = 600
const H = 72

interface Props {
  route: Route
  scrub: number | null
  onScrub(index: number | null): void
}

export default function ElevationProfile({ route, scrub, onScrub }: Props) {
  const svg = useRef<SVGSVGElement>(null)

  const { path, min, max } = useMemo(() => {
    const n = route.coords.length
    const step = Math.max(1, Math.floor(n / 300))
    let min = Infinity
    let max = -Infinity
    for (const c of route.coords) {
      if (c[2] < min) min = c[2]
      if (c[2] > max) max = c[2]
    }
    const span = Math.max(max - min, 20)
    const total = route.distance || 1
    let d = ''
    for (let i = 0; i < n; i += step) {
      const x = (route.cum[i] / total) * W
      const y = H - 4 - ((route.coords[i][2] - min) / span) * (H - 10)
      d += `${d ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
    }
    const lastY = H - 4 - ((route.coords[n - 1][2] - min) / span) * (H - 10)
    d += `L${W},${lastY.toFixed(1)}`
    return { path: d, min, max }
  }, [route])

  if (max - min < 1) return null

  const pick = (clientX: number) => {
    const r = svg.current!.getBoundingClientRect()
    const target = Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * route.distance
    let lo = 0
    let hi = route.cum.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (route.cum[mid] < target) lo = mid + 1
      else hi = mid
    }
    onScrub(lo)
  }

  const sx = scrub !== null ? (route.cum[scrub] / (route.distance || 1)) * W : null

  return (
    <div className="profile">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          pick(e.clientX)
        }}
        onPointerMove={(e) => {
          if (e.pointerType === 'mouse' || e.buttons > 0 || e.pressure > 0) pick(e.clientX)
        }}
        onPointerUp={() => onScrub(null)}
        onPointerCancel={() => onScrub(null)}
        onPointerLeave={() => onScrub(null)}
      >
        <path d={`${path}L${W},${H}L0,${H}Z`} className="profile-area" />
        <path d={path} className="profile-line" vectorEffect="non-scaling-stroke" />
        {sx !== null && <line x1={sx} x2={sx} y1={0} y2={H} className="profile-cursor" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="profile-legend">
        <span>
          {scrub !== null
            ? `${(route.cum[scrub] / 1000).toLocaleString('nl-NL', { maximumFractionDigits: 1 })} km · ${Math.round(route.coords[scrub][2])} m`
            : `Laagste ${Math.round(min)} m`}
        </span>
        <span>Hoogste {Math.round(max)} m</span>
      </div>
    </div>
  )
}
