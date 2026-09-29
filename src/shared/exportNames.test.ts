import { describe, expect, it } from 'vitest'
import { isExportFileName, uniqueFileNames } from './exportNames'

describe('export file names', () => {
  it('accepts plain image file names only', () => {
    expect(isExportFileName('rock_4fx.png')).toBe(true)
    expect(isExportFileName('Rock 01_4fx.TGA')).toBe(true)
    expect(isExportFileName('rock.exe')).toBe(false)
    expect(isExportFileName('../rock.png')).toBe(false)
    expect(isExportFileName('sub/rock.png')).toBe(false)
    expect(isExportFileName('C:rock.png')).toBe(false)
    expect(isExportFileName('')).toBe(false)
    expect(isExportFileName('rock.png ')).toBe(false)
  })

  it('numbers names that would clash', () => {
    expect(uniqueFileNames(['a.png', 'b.png', 'A.png', 'a.png'])).toEqual(['a.png', 'b.png', 'A (2).png', 'a (3).png'])
  })
})
