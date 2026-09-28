import type { PassDef } from '../pass'
import { posterize } from './posterize'

export const PASSES: ReadonlyMap<string, PassDef<never>> = new Map(
  [posterize].map((p) => [p.id, p as PassDef<never>])
)
