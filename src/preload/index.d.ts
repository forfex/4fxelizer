import type { FxApi } from '../shared/api'
import type { PickerApi } from '../shared/screenPick'

declare global {
  interface Window {
    fx: FxApi
    /** Only in the screen picker's overlay windows. */
    picker: PickerApi
  }
}
