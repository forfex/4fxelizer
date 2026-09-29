// The graphics cards Chromium found (app.getGPUInfo('basic').gpuDevice in main), for Settings › GPU.

export interface GpuEntry {
  name: string
  /** The GPU Chromium renders on. */
  active: boolean
}

const VENDORS: Record<number, string> = {
  0x10de: 'NVIDIA',
  0x1002: 'AMD',
  0x1022: 'AMD',
  0x8086: 'Intel',
  0x106b: 'Apple',
  0x5143: 'Qualcomm',
  0x13b5: 'Arm'
}

/** Software renderers (Microsoft Basic Render Driver, SwiftShader) and unknown ids aren't GPUs to pick. */
const SOFTWARE = new Set([0, 0x1414, 0x1ae0])

interface RawDevice {
  active?: unknown
  vendorId?: unknown
  deviceId?: unknown
  vendorString?: unknown
  deviceString?: unknown
}

const hex = (n: number): string => `0x${n.toString(16).padStart(4, '0')}`

/** Hardware GPUs from Electron's GPU info, named as well as the info allows. */
export function listGpus(gpuInfo: unknown): GpuEntry[] {
  const devices = (gpuInfo as { gpuDevice?: unknown } | null)?.gpuDevice
  if (!Array.isArray(devices)) return []
  const out: GpuEntry[] = []
  for (const d of devices as RawDevice[]) {
    const vendorId = typeof d?.vendorId === 'number' ? d.vendorId : 0
    if (SOFTWARE.has(vendorId)) continue
    const deviceId = typeof d.deviceId === 'number' ? d.deviceId : 0
    const vendor = (typeof d.vendorString === 'string' && d.vendorString) || VENDORS[vendorId] || `Vendor ${hex(vendorId)}`
    const name = (typeof d.deviceString === 'string' && d.deviceString) || `${vendor} GPU ${hex(deviceId)}`
    out.push({ name, active: d.active === true })
  }
  return out
}
