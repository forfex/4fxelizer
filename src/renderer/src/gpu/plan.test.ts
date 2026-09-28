import { describe, expect, it } from 'vitest'
import { planChain, stableStringify, type StageSpec } from './plan'

const stage = (uid: string, params: unknown = {}, enabled = true): StageSpec => ({
  uid,
  passId: `pass-${uid}`,
  params,
  enabled,
  blend: { opacity: 1, mode: 'normal' }
})

/** Plans, then "runs" by caching every output key — like the GPU chain does. */
function runner() {
  const cache = new Set<string>()
  return (stages: StageSpec[], source = 'src') => {
    const plan = planChain(source, stages, (k) => cache.has(k))
    for (const s of plan.stages) if (s.run) cache.add(s.outputKey)
    for (const k of [...cache]) if (!plan.liveKeys.has(k)) cache.delete(k)
    return plan.stages.filter((s) => s.run).map((s) => s.stage.uid)
  }
}

describe('planChain', () => {
  it('runs everything the first time, nothing when unchanged', () => {
    const run = runner()
    const stages = [stage('a'), stage('b'), stage('c')]
    expect(run(stages)).toEqual(['a', 'b', 'c'])
    expect(run(stages)).toEqual([])
  })

  it('re-runs only the changed stage and everything after it', () => {
    const run = runner()
    run([stage('a'), stage('b', { n: 1 }), stage('c')])
    expect(run([stage('a'), stage('b', { n: 2 }), stage('c')])).toEqual(['b', 'c'])
  })

  it('re-runs from the first moved stage when reordering', () => {
    const run = runner()
    run([stage('a'), stage('b'), stage('c'), stage('d')])
    expect(run([stage('a'), stage('c'), stage('b'), stage('d')])).toEqual(['c', 'b', 'd'])
  })

  it('treats disabled stages as pass-through', () => {
    const run = runner()
    run([stage('a'), stage('b')])
    const plan = planChain('src', [stage('a', {}, false), stage('b')], () => false)
    expect(plan.stages[0]!.outputKey).toBe('src')
    expect(plan.stages[1]!.inputKey).toBe('src')
    // Re-enabling restores the previously cached result only if it's still live.
    expect(run([stage('a', {}, false), stage('b')])).toEqual(['b'])
  })

  it('invalidates everything when the source changes', () => {
    const run = runner()
    run([stage('a'), stage('b')], 'img-v1')
    expect(run([stage('a'), stage('b')], 'img-v2')).toEqual(['a', 'b'])
  })

  it('returns the source key when no stage is enabled', () => {
    expect(planChain('src', [stage('a', {}, false)], () => false).outputKey).toBe('src')
  })

  it('hashes params independently of key order', () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(stableStringify({ a: [1, { c: 3, d: 2 }], b: 1 }))
    const p1 = planChain('src', [stage('a', { x: 1, y: 2 })], () => false)
    const p2 = planChain('src', [stage('a', { y: 2, x: 1 })], () => false)
    expect(p1.outputKey).toBe(p2.outputKey)
  })

  it('re-runs a stage when its blend changes', () => {
    const run = runner()
    run([stage('a'), stage('b')])
    expect(run([stage('a'), { ...stage('b'), blend: { opacity: 0.5, mode: 'normal' } }])).toEqual(['b'])
  })

  it('re-runs a stage and its successors when a resource it reads changes', () => {
    const cache = new Set<string>()
    const plan = (palette: string) => {
      const p = planChain('src', [stage('a'), stage('q'), stage('c')], (k) => cache.has(k), (s) =>
        s.uid === 'q' ? palette : ''
      )
      for (const s of p.stages) if (s.run) cache.add(s.outputKey)
      return p.stages.filter((s) => s.run).map((s) => s.stage.uid)
    }
    expect(plan('#000,#fff')).toEqual(['a', 'q', 'c'])
    expect(plan('#000,#fff')).toEqual([])
    expect(plan('#000,#f00')).toEqual(['q', 'c'])
  })
})
