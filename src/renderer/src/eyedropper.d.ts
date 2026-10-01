// Chromium's EyeDropper API (not in TypeScript's DOM lib yet): picks a color from anywhere on
// screen. https://wicg.github.io/eyedropper-api/

interface ColorSelectionResult {
  /** `#rrggbb`. */
  sRGBHex: string
}

interface ColorSelectionOptions {
  signal?: AbortSignal
}

declare class EyeDropper {
  /** Opens the picker; needs a user gesture. Rejects with an AbortError when cancelled (Esc). */
  open(options?: ColorSelectionOptions): Promise<ColorSelectionResult>
}
