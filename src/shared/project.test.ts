import { describe, expect, it } from 'vitest'
import { baseName, dirName, fileRef, isProjectFile, relativePath } from './project'

describe('project paths', () => {
  it('makes paths relative to the project folder', () => {
    expect(relativePath('C:\\art\\castle', 'C:\\art\\castle\\tex\\wall.png')).toBe('tex/wall.png')
    expect(relativePath('C:\\art\\castle', 'c:\\Art\\shared\\rock.png')).toBe('../shared/rock.png')
    expect(relativePath('/home/me/art', '/home/me/art/wall.png')).toBe('wall.png')
    expect(relativePath('/home/me/art/', '/home/me/models/a.glb')).toBe('../models/a.glb')
    expect(relativePath('/home/me/Art', '/home/me/art/wall.png')).toBe('../art/wall.png')
    expect(relativePath('\\\\nas\\share\\p', '\\\\NAS\\share\\q\\x.png')).toBe('../q/x.png')
  })

  it('gives up across drives and for relative paths', () => {
    expect(relativePath('C:\\art', 'D:\\art\\wall.png')).toBeNull()
    expect(relativePath('C:\\art', 'wall.png')).toBeNull()
    expect(relativePath('\\\\nas\\a\\p', '\\\\nas\\b\\p\\x.png')).toBeNull()
  })

  it('splits folders and names', () => {
    expect(dirName('C:\\art\\castle.pxproj')).toBe('C:\\art')
    expect(dirName('/home/castle.pxproj')).toBe('/home')
    expect(dirName('/castle.pxproj')).toBe('/')
    expect(baseName('C:\\art\\wall.png')).toBe('wall.png')
    expect(baseName('/home/me/wall.png')).toBe('wall.png')
  })

  it('stores both the absolute and the relative path', () => {
    expect(fileRef('C:\\art\\castle.pxproj', 'C:\\art\\tex\\wall.png')).toEqual({ path: 'C:\\art\\tex\\wall.png', relative: 'tex/wall.png' })
    expect(fileRef('C:\\art\\castle.pxproj', 'D:\\wall.png')).toEqual({ path: 'D:\\wall.png' })
    expect(isProjectFile('Castle.PXPROJ')).toBe(true)
    expect(isProjectFile('castle.pxlook')).toBe(false)
  })
})
