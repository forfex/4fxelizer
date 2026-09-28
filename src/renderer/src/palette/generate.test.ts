import { describe, expect, it } from 'vitest'
import { oklabToRgb, rgbToOklab } from '@/color/oklab'
import { CenterIndex, generatePalette, histogram } from './generate'
import { mergeGenerated, normalizeHex, snapHexTo15bit, sortColors } from './palette'

/** RGBA8 image made of equal-sized runs of the given colors. */
function image(colors: [number, number, number, number][], each = 50): Uint8Array {
  return new Uint8Array(colors.flatMap((c) => Array.from({ length: each }, () => c).flat()))
}

describe('oklab', () => {
  it('round-trips sRGB', () => {
    for (const rgb of [[0, 0, 0], [1, 1, 1], [1, 0, 0], [0.2, 0.6, 0.9], [0.5, 0.5, 0.5]] as const) {
      const back = oklabToRgb(rgbToOklab([...rgb]))
      back.forEach((v, i) => expect(v).toBeCloseTo(rgb[i]!, 4))
    }
  })

  it('puts white at L=1 and gray on the neutral axis', () => {
    const [L, a, b] = rgbToOklab([1, 1, 1])
    expect(L).toBeCloseTo(1, 4)
    expect(Math.abs(a) + Math.abs(b)).toBeLessThan(1e-4)
  })
})

describe('histogram', () => {
  it('ignores transparent pixels and keeps exact means', () => {
    const bins = histogram(image([[10, 20, 30, 255], [200, 0, 0, 0]], 3))
    expect(bins).toHaveLength(1)
    expect(bins[0]!.w).toBe(3)
    expect(bins[0]!.rgb.map((v) => Math.round(v * 255))).toEqual([10, 20, 30])
  })
})

describe('generatePalette', () => {
  const four = image([
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 255],
    [20, 20, 20, 255]
  ])

  for (const method of ['median-cut', 'wu', 'octree', 'kmeans'] as const) {
    it(`${method} recovers the exact colors of a 4-color image`, () => {
      const out = generatePalette(four, { method, count: 4, quality: 8, lumaWeight: 1, chromaWeight: 1, locked: [] })
      expect(new Set(out)).toEqual(new Set(['#ff0000', '#00ff00', '#0000ff', '#141414']))
    })
  }

  it('never returns more colors than the image has', () => {
    const out = generatePalette(four, { method: 'kmeans', count: 16, quality: 4, lumaWeight: 1, chromaWeight: 1, locked: [] })
    expect(out).toHaveLength(4)
  })

  it('fills around locked colors', () => {
    const out = generatePalette(four, {
      method: 'kmeans',
      count: 4,
      quality: 8,
      lumaWeight: 1,
      chromaWeight: 1,
      locked: ['#ff0000']
    })
    expect(out).toHaveLength(3)
    expect(out).not.toContain('#ff0000')
    expect(new Set(out)).toEqual(new Set(['#00ff00', '#0000ff', '#141414']))
  })

  it('sorts dark to light', () => {
    const out = generatePalette(four, { method: 'median-cut', count: 4, quality: 0, lumaWeight: 1, chromaWeight: 1, locked: [] })
    expect(out[0]).toBe('#141414')
  })
})

describe('palette helpers', () => {
  it('normalizes hex input', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc')
    expect(normalizeHex('ff8000')).toBe('#ff8000')
    expect(normalizeHex('xyz')).toBeNull()
  })

  it('snaps to 15-bit color', () => {
    expect(snapHexTo15bit('#ffffff')).toBe('#ffffff')
    expect(snapHexTo15bit('#010203')).toBe('#000000')
    expect(snapHexTo15bit('#808080')).toBe('#848484')
  })

  it('merges generated colors around locked slots', () => {
    const merged = mergeGenerated(
      [{ hex: '#000000' }, { hex: '#ff0000', locked: true }, { hex: '#00ff00' }],
      ['#111111', '#222222', '#333333'],
      4
    )
    expect(merged).toEqual([{ hex: '#111111' }, { hex: '#ff0000', locked: true }, { hex: '#222222' }, { hex: '#333333' }])
    expect(mergeGenerated([{ hex: '#000000' }, { hex: '#ff0000', locked: true }], ['#111111'], 1)).toEqual([
      { hex: '#ff0000', locked: true }
    ])
  })

  it('sorts by lightness', () => {
    const sorted = sortColors([{ hex: '#ffffff' }, { hex: '#000000' }, { hex: '#808080' }], 'lightness')
    expect(sorted.map((c) => c.hex)).toEqual(['#000000', '#808080', '#ffffff'])
  })
})

describe('large palettes', () => {
  /** Deterministic pseudo-random RGBA noise with smooth structure (lots of distinct colors). */
  function noiseImage(width: number, height: number): Uint8Array {
    const out = new Uint8Array(width * height * 4)
    let s = 12345
    const rand = (): number => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296)
    for (let i = 0; i < width * height; i++) {
      const x = i % width
      const y = Math.floor(i / width)
      out.set([(x * 255) / width + rand() * 40, (y * 255) / height + rand() * 40, rand() * 255, 255].map((v) => Math.min(255, v)), i * 4)
    }
    return out
  }

  it('CenterIndex matches a linear scan exactly', () => {
    let s = 7
    const rand = (): number => ((s = (Math.imul(s, 48271) + 1) >>> 0) / 4294967296)
    const centers = Array.from({ length: 500 }, () => [rand(), rand() - 0.5, rand() - 0.5] as [number, number, number])
    centers.push([...centers[3]!]) // a duplicate: ties must go to the lower index
    const index = new CenterIndex(centers)
    for (let n = 0; n < 2000; n++) {
      const p: [number, number, number] = [rand(), rand() - 0.5, rand() - 0.5]
      let best = 0
      let bestD = Infinity
      centers.forEach((c, i) => {
        const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2
        if (d < bestD) {
          bestD = d
          best = i
        }
      })
      expect(index.nearest(p)).toBe(best)
    }
  })

  for (const method of ['median-cut', 'wu', 'octree'] as const) {
    it(`${method} fills (nearly) every slot with distinct colors`, () => {
      const out = generatePalette(noiseImage(128, 128), { method, count: 64, quality: 0, lumaWeight: 1, chromaWeight: 1, locked: [] })
      expect(out.length).toBeLessThanOrEqual(64)
      expect(out.length).toBeGreaterThan(56)
      expect(new Set(out).size).toBe(out.length)
    })
  }

  it('wu and octree generate thousands of colors in reasonable time', () => {
    const rgba = noiseImage(512, 512)
    for (const method of ['wu', 'octree'] as const) {
      const t = performance.now()
      const out = generatePalette(rgba, { method, count: 4096, quality: 0, lumaWeight: 1, chromaWeight: 1, locked: [] })
      expect(out.length).toBeGreaterThan(3000)
      expect(performance.now() - t).toBeLessThan(10_000)
    }
  }, 30_000)

  it('generates thousands of colors in reasonable time', () => {
    const rgba = noiseImage(512, 512)
    const t = performance.now()
    const out = generatePalette(rgba, { method: 'kmeans', count: 4096, quality: 8, lumaWeight: 1, chromaWeight: 1, locked: [] })
    const ms = performance.now() - t
    expect(out.length).toBeGreaterThan(3500)
    expect(new Set(out).size).toBe(out.length)
    expect(ms).toBeLessThan(10_000)
  }, 20_000)
})
