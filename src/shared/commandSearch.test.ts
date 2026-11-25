import { describe, expect, it } from 'vitest'
import { filterItems, matchScore, menuItems, type SearchItem } from './commandSearch'
import { appMenu } from './menu'

describe('menuItems', () => {
  const items = menuItems(appMenu('win32', false))

  it('flattens submenus into paths and keeps shortcuts', () => {
    expect(items.find((i) => i.value.kind === 'command' && i.value.command === 'theme-night')).toMatchObject({ label: 'Night', path: 'View › Theme' })
    expect(items.find((i) => i.value.kind === 'command' && i.value.command === 'open')).toMatchObject({
      label: 'Open Textures',
      path: 'File',
      accelerator: 'CmdOrCtrl+O'
    })
  })

  it('lists command search itself, and no clipboard roles', () => {
    expect(items.some((i) => i.value.kind === 'command' && i.value.command === 'command-search')).toBe(true)
    expect(items.some((i) => i.value.kind === 'role' && i.value.role === 'copy')).toBe(false)
    expect(items.some((i) => i.value.kind === 'role' && i.value.role === 'togglefullscreen')).toBe(true)
  })
})

describe('filterItems', () => {
  const item = (label: string, path = 'Menu'): SearchItem<string> => ({ label, path, value: label })
  const items = [item('Dithered cutout', 'Preset'), item('Export'), item('Open Textures', 'File'), item('Zoom Out', 'View'), item('Dark', 'View › Theme'), item('Pixel Grid', 'View')]

  it('returns everything for an empty query', () => {
    expect(filterItems(items, '  ')).toHaveLength(items.length)
  })

  it('ranks prefixes over word starts over substrings over query words over letters in order', () => {
    expect(matchScore('Open Textures', 'open')).toBeGreaterThan(matchScore('Pick Open', 'open'))
    expect(matchScore('Pick Open', 'open')).toBeGreaterThan(matchScore('Reopen', 'open'))
    expect(matchScore('Open Textures', 'open')).toBeGreaterThan(matchScore('Reopen', 'open'))
    expect(matchScore('Reopen', 'open')).toBeGreaterThan(matchScore('Open Textures', 'op tex'))
    expect(matchScore('Open Textures', 'op tex')).toBeGreaterThan(matchScore('Open Textures', 'otx'))
    expect(matchScore('Open Textures', 'xyz')).toBe(0)
  })

  it('matches labels, then paths', () => {
    expect(filterItems(items, 'grid').map((i) => i.label)).toEqual(['Pixel Grid'])
    expect(filterItems(items, 'theme').map((i) => i.label)).toEqual(['Dark'])
    // A word starting with the query (the Theme menu) beats the letters inside a word (Dithered).
    expect(filterItems(items, 'the').map((i) => i.label)).toEqual(['Dark', 'Dithered cutout'])
    expect(filterItems(items, 'zo')[0]!.label).toBe('Zoom Out')
    expect(filterItems(items, 'ex')[0]!.label).toBe('Export')
  })
})
