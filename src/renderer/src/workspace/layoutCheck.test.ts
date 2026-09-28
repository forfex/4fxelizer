import { describe, expect, it } from 'vitest'
import { layoutProblem } from './layoutCheck'

const known = { components: ['viewer', 'stack'], tabComponents: ['viewer'], required: 'viewer' }
const layout = (panels: Record<string, unknown>) => ({ grid: { root: {}, width: 1, height: 1 }, panels })

describe('layoutProblem', () => {
  it('accepts a layout made of known panels', () => {
    const ok = layout({
      viewer: { id: 'viewer', contentComponent: 'viewer', tabComponent: 'viewer' },
      stack: { id: 'stack', contentComponent: 'stack' }
    })
    expect(layoutProblem(ok, known)).toBeNull()
  })

  it('rejects unknown components and tabs', () => {
    const viewer = { id: 'viewer', contentComponent: 'viewer' }
    expect(layoutProblem(layout({ viewer, old: { id: 'old', contentComponent: 'generate' } }), known)).toMatch(/unknown component/)
    expect(layoutProblem(layout({ viewer, stack: { contentComponent: 'stack', tabComponent: 'fancy' } }), known)).toMatch(/unknown tab/)
    expect(layoutProblem(layout({ viewer, stack: { id: 'stack' } }), known)).toMatch(/unknown component/)
  })

  it('requires the viewer', () => {
    expect(layoutProblem(layout({ stack: { id: 'stack', contentComponent: 'stack' } }), known)).toMatch(/missing/)
  })

  it('rejects things that are not layouts', () => {
    for (const bad of [null, 3, [], {}, { grid: {} }, { grid: {}, panels: [] }, layout({ viewer: 'x' })]) {
      expect(layoutProblem(bad, known)).not.toBeNull()
    }
  })
})
