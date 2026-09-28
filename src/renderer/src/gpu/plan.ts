// Stage caching, independent of the GPU so it can be unit-tested.
//
// Every stage output is cached under a key that hashes everything that produced it:
// the source image, and each earlier enabled stage's type + params, in order.
// So changing a setting re-runs only that stage and those after it, and reordering
// re-runs from the first stage whose upstream changed — with no explicit invalidation.

import type { StageBlend } from './pass'

export interface StageSpec {
  /** Stable identity of this stage instance in the stack (survives reordering). */
  uid: string
  passId: string
  params: unknown
  enabled: boolean
  /** How the stage's result is blended over its input (opacity + mode). */
  blend: StageBlend
}

export interface PlannedStage {
  stage: StageSpec
  /** Cache key of this stage's input (source key for the first enabled stage). */
  inputKey: string
  /** Cache key of this stage's output. Equals inputKey when the stage is disabled. */
  outputKey: string
  /** True when the output isn't cached yet and the stage has to run. */
  run: boolean
}

export interface ChainPlan {
  stages: PlannedStage[]
  /** Key of the final image (source key when no stage is enabled). */
  outputKey: string
  /** Keys that must stay cached; everything else can be released. */
  liveKeys: Set<string>
}

/** Deterministic JSON: object keys sorted, so {a,b} and {b,a} hash the same. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

/** cyrb53: fast 53-bit string hash, rendered as base36. */
export function hashString(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/**
 * @param depsKey  Signature of the project resources a stage reads (e.g. its palette's colors),
 *                 so editing a resource re-runs the stages that use it.
 */
export function planChain(
  sourceKey: string,
  stages: StageSpec[],
  isCached: (key: string) => boolean,
  depsKey: (stage: StageSpec) => string = () => ''
): ChainPlan {
  const planned: PlannedStage[] = []
  const liveKeys = new Set<string>([sourceKey])
  let key = sourceKey

  for (const stage of stages) {
    if (!stage.enabled) {
      planned.push({ stage, inputKey: key, outputKey: key, run: false })
      continue
    }
    const outputKey = hashString(
      `${key}>${stage.passId}:${stableStringify(stage.params)}|${stableStringify(stage.blend)}|${depsKey(stage)}`
    )
    // A cached entry under this key was produced from identical inputs, so it's valid
    // even if an upstream stage re-runs (it would produce the same input again).
    planned.push({ stage, inputKey: key, outputKey, run: !isCached(outputKey) })
    liveKeys.add(outputKey)
    key = outputKey
  }

  return { stages: planned, outputKey: key, liveKeys }
}
