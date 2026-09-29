import { app } from 'electron'
import type { GpuPreference } from '@shared/api'

/**
 * Chromium switches that make WebGPU available where it isn't on by default, and pick the GPU the
 * user chose in Settings (on machines with an integrated and a discrete one).
 * Windows and macOS ship WebGPU enabled; Linux still needs it unlocked for many drivers.
 * No `--enable-features=Vulkan`: Chromium can't use Vulkan under Wayland, so it crashed the GPU
 * process on Ubuntu's default session (and left the viewer white under X11); WebGPU picks its
 * backend without it.
 * Set FXELIZER_NO_GPU_FLAGS=1 to launch without them (for comparing driver behavior).
 */
export function applyGpuFlags(preference: GpuPreference): string[] {
  if (process.env.FXELIZER_NO_GPU_FLAGS === '1') return []
  const flags: [string, string?][] = []
  if (process.platform === 'linux') {
    flags.push(['enable-unsafe-webgpu'])
  }
  if (preference === 'high-performance') flags.push(['force_high_performance_gpu'])
  if (preference === 'low-power') flags.push(['force_low_power_gpu'])
  for (const [name, value] of flags) app.commandLine.appendSwitch(name, value)
  return flags.map(([name, value]) => (value ? `--${name}=${value}` : `--${name}`))
}
