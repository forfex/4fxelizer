// The bits of OBJ material libraries (.mtl) the app needs: each material's diffuse color and
// diffuse texture. three's MTLLoader would also load the textures, which the app does itself.

export interface MtlMaterial {
  /** Kd, 0–1. */
  color: [number, number, number] | null
  /** map_Kd file reference, as written. */
  map: string | null
}

/** Options of map_* statements and how many values each takes. */
const MAP_OPTIONS: Record<string, number> = {
  '-blendu': 1, '-blendv': 1, '-boost': 1, '-mm': 2, '-o': 3, '-s': 3, '-t': 3,
  '-texres': 1, '-clamp': 1, '-bm': 1, '-imfchan': 1, '-type': 1, '-cc': 1
}

/** File name of a map statement's arguments, after its options. */
function mapFile(args: string[]): string | null {
  let i = 0
  while (i < args.length && args[i]!.startsWith('-')) {
    const count = MAP_OPTIONS[args[i]!.toLowerCase()] ?? 0
    i++
    // -o/-s/-t take 1–3 numbers: skip the ones that are there.
    for (let k = 0; k < count && i < args.length && (count === 1 || /^[-+.\d]/.test(args[i]!)); k++) i++
  }
  const rest = args.slice(i).join(' ').trim()
  return rest || null
}

export function parseMtl(text: string): Map<string, MtlMaterial> {
  const out = new Map<string, MtlMaterial>()
  let current: MtlMaterial | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const [keyword, ...args] = line.split(/\s+/)
    const key = keyword!.toLowerCase()
    if (key === 'newmtl') {
      current = { color: null, map: null }
      out.set(args.join(' '), current)
    } else if (current && key === 'kd' && args.length >= 3) {
      const [r, g, b] = args.map(Number)
      if ([r, g, b].every((v) => Number.isFinite(v))) current.color = [r!, g!, b!]
    } else if (current && key === 'map_kd') {
      current.map = mapFile(args)
    }
  }
  return out
}

/** Material libraries an OBJ file refers to (mtllib statements). */
export function objMaterialLibraries(text: string): string[] {
  const out: string[] = []
  for (const match of text.matchAll(/^[ \t]*mtllib[ \t]+(.+?)[ \t]*$/gm)) {
    const names = match[1]!
    // Usually one name; several are separated by spaces (names with spaces then can't be told apart).
    if (/\.mtl$/i.test(names) && names.split(/\s+/).filter((n) => /\.mtl$/i.test(n)).length === 1) out.push(names)
    else out.push(...names.split(/\s+/).filter(Boolean))
  }
  return [...new Set(out)]
}
