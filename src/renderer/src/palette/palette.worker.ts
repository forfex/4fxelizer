// Runs palette generation off the UI thread.

import { generatePalette, type GenerateOptions } from './generate'

export interface GenerateRequest {
  id: number
  rgba: Uint8Array
  options: GenerateOptions
}

export type GenerateResponse = { id: number; colors: string[] } | { id: number; error: string }

self.onmessage = (e: MessageEvent<GenerateRequest>) => {
  const { id, rgba, options } = e.data
  try {
    self.postMessage({ id, colors: generatePalette(rgba, options) } satisfies GenerateResponse)
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) } satisfies GenerateResponse)
  }
}
