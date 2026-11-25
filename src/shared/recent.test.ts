import { describe, expect, it } from 'vitest'
import { addRecent, MAX_RECENT, normalizeRecent, recentLabel, removeRecent } from './recent'

describe('recent files', () => {
  it('puts newly opened files first, the first of them on top', () => {
    expect(addRecent(['a.png', 'b.png'], ['c.png', 'd.png'])).toEqual(['c.png', 'd.png', 'a.png', 'b.png'])
  })

  it('moves a file opened again to the front instead of repeating it', () => {
    expect(addRecent(['a.png', 'b.png', 'c.png'], ['B.PNG'])).toEqual(['B.PNG', 'a.png', 'c.png'])
  })

  it('keeps the newest ten', () => {
    const many = Array.from({ length: 14 }, (_, i) => `${i}.png`)
    const list = addRecent(many, ['new.png'])
    expect(list).toHaveLength(MAX_RECENT)
    expect(list[0]).toBe('new.png')
    expect(list).not.toContain('13.png')
  })

  it('removes a file whatever its letter case', () => {
    expect(removeRecent(['A.png', 'b.png'], 'a.PNG')).toEqual(['b.png'])
  })

  it('reads a stored list, dropping what is not a path', () => {
    expect(normalizeRecent(['a.png', 3, '', 'a.png', null, 'b.png'])).toEqual(['a.png', 'b.png'])
    expect(normalizeRecent('a.png')).toEqual([])
    expect(normalizeRecent(undefined)).toEqual([])
  })

  it('labels a file with its name and folder', () => {
    expect(recentLabel('C:\\art\\textures\\rock.png')).toBe('rock.png — textures')
    expect(recentLabel('/home/me/game/level.pxproj')).toBe('level.pxproj — game')
    expect(recentLabel('rock.png')).toBe('rock.png')
  })
})
