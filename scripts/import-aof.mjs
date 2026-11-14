// Haalt de kwartaaluitgave van het Adventure On Foot-register op en maakt er een compacte
// tabel van: OpenStreetMap-relatie -> [rondwandeling ja/nee, stijging in m].
// Daarmee krijgen de wandelroutes in de lijst het label "Rondje" en een betere tijdsduur.
// Gebruik: node scripts/import-aof.mjs [url-van-de-uitgave]
import { writeFileSync } from 'node:fs'

const url = process.argv[2] ?? 'https://adventureonfoot.co.uk/registry/releases/aof-registry-2026-10.csv'
const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
if (!res.ok) throw new Error(`Ophalen mislukt: ${res.status}`)
const text = await res.text()

const rows = []
let row = []
let cell = ''
let quoted = false
for (let i = 0; i < text.length; i++) {
  const ch = text[i]
  if (quoted) {
    if (ch === '"') {
      if (text[i + 1] === '"') {
        cell += '"'
        i++
      } else quoted = false
    } else cell += ch
  } else if (ch === '"') quoted = true
  else if (ch === ',') {
    row.push(cell)
    cell = ''
  } else if (ch === '\n') {
    row.push(cell)
    rows.push(row)
    row = []
    cell = ''
  } else if (ch !== '\r') cell += ch
}
const head = rows.shift()
const col = (name) => head.indexOf(name)
const [cStatus, cRegion, cShape, cAscent, cRel] = ['status', 'region', 'shape', 'ascent_m', 'osm_relations'].map(col)

const out = {}
for (const r of rows) {
  if (r[cStatus] !== 'live' || r[cRegion] === 'SC' || r[cRegion] === 'NI') continue
  // alleen routes die uit precies één relatie bestaan; bij meer gaat het om etappes
  if (!/^\d+$/.test(r[cRel] ?? '')) continue
  if (!r[cShape] && !r[cAscent]) continue
  out[r[cRel]] = [r[cShape] === 'circular' ? 1 : 0, Math.round(Number(r[cAscent]) || 0)]
}

const file = new URL('../src/data/aof.ts', import.meta.url)
writeFileSync(
  file,
  `// Gegenereerd door scripts/import-aof.mjs uit ${url}
// © OpenStreetMap contributors; Adventure On Foot (Open Database Licence)
// OpenStreetMap-relatie -> [rondwandeling (1/0), stijging in m (0 = onbekend)]
export const AOF: Record<number, [number, number]> = ${JSON.stringify(out)}
`,
)
console.log(`${Object.keys(out).length} routes geschreven`)
