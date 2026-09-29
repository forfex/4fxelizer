export interface Gpu {
  adapter: GPUAdapter
  device: GPUDevice
}

export class GpuUnavailableError extends Error {}

/** low-power asks for the integrated GPU where there are two (Settings › GPU); otherwise the fastest. */
export async function initGpu(powerPreference: GPUPowerPreference = 'high-performance'): Promise<Gpu> {
  if (!('gpu' in navigator) || !navigator.gpu) {
    throw new GpuUnavailableError('WebGPU is not available (navigator.gpu is missing).')
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference })
  if (!adapter) {
    throw new GpuUnavailableError('No WebGPU adapter found. The GPU or its driver may be blocklisted.')
  }
  // Ask for the adapter's real limits: defaults cap textures at 8192², too small for some sources.
  const { limits } = adapter
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxTextureDimension2D: limits.maxTextureDimension2D,
      maxBufferSize: limits.maxBufferSize,
      maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize
    }
  })
  device.addEventListener('uncapturederror', (event) => {
    console.error('[webgpu]', (event as GPUUncapturedErrorEvent).error.message)
  })
  return { adapter, device }
}

export function adapterLabel(adapter: GPUAdapter): string {
  const { vendor, architecture, description, device } = adapter.info
  return description || [vendor, architecture, device].filter(Boolean).join(' ') || 'Unknown GPU'
}
