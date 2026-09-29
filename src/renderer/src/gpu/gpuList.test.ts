import { describe, expect, it } from 'vitest'
import { listGpus } from './gpuList'

describe('listGpus', () => {
  it('names hardware GPUs and skips software renderers', () => {
    const info = {
      gpuDevice: [
        { active: true, vendorId: 0x10de, deviceId: 0x2684, deviceString: 'NVIDIA GeForce RTX 4090' },
        { active: false, vendorId: 0x8086, deviceId: 0x46a6 },
        { active: false, vendorId: 0x1414, deviceId: 0x8c }
      ]
    }
    expect(listGpus(info)).toEqual([
      { name: 'NVIDIA GeForce RTX 4090', active: true },
      { name: 'Intel GPU 0x46a6', active: false }
    ])
  })

  it('copes with missing or odd info', () => {
    expect(listGpus(null)).toEqual([])
    expect(listGpus({ error: 'nope' })).toEqual([])
    expect(listGpus({ gpuDevice: [null, { vendorId: 0x1234, deviceId: 1 }] })).toEqual([{ name: 'Vendor 0x1234 GPU 0x0001', active: false }])
  })
})
