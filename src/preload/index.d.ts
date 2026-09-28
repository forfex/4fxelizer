import type { FxApi } from '../shared/api'

declare global {
  interface Window {
    fx: FxApi
  }
}
