import { describe, expect, it } from 'vitest'
import { checksumFor, compareVersions, normalizeUpdateSettings, parseRelease, pickAsset, DEFAULT_UPDATE_SETTINGS, type ReleaseAsset } from './update'

const asset = (name: string): ReleaseAsset => ({ name, url: `https://github.com/forfex/4fxelizer/releases/download/v1.2.0/${name}`, size: 1 })

const ASSETS = [
  '4fxelizer-1.2.0-amd64.deb',
  '4fxelizer-1.2.0-arm64.dmg',
  '4fxelizer-1.2.0-setup.exe',
  '4fxelizer-1.2.0-x64.dmg',
  '4fxelizer-1.2.0-x86_64.AppImage',
  'SHA256SUMS.txt'
].map(asset)

describe('compareVersions', () => {
  it('orders by major, minor, patch', () => {
    expect(compareVersions('1.1.1', '1.1.0')).toBeGreaterThan(0)
    expect(compareVersions('1.1.0', '1.2.0')).toBeLessThan(0)
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0)
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(compareVersions('v1.1.0', '1.1.0')).toBe(0)
  })

  it('puts pre-releases before their release', () => {
    expect(compareVersions('1.2.0-beta.1', '1.2.0')).toBeLessThan(0)
    expect(compareVersions('1.2.0-beta.2', '1.2.0-beta.10')).toBeLessThan(0)
    expect(compareVersions('1.2.0-alpha', '1.2.0-beta')).toBeLessThan(0)
    expect(compareVersions('1.2.0-beta', '1.2.0-beta.1')).toBeLessThan(0)
    expect(compareVersions('1.2.0-beta.1', '1.1.9')).toBeGreaterThan(0)
  })

  it('sorts invalid versions oldest', () => {
    expect(compareVersions('nightly', '0.0.1')).toBeLessThan(0)
    expect(compareVersions('1.0', '1.0')).toBe(0)
  })
})

describe('parseRelease', () => {
  const json = {
    tag_name: 'v1.2.0',
    name: '4FXELIZER v1.2.0',
    body: 'Notes',
    html_url: 'https://github.com/forfex/4fxelizer/releases/tag/v1.2.0',
    draft: false,
    prerelease: false,
    assets: [
      { name: 'a.exe', browser_download_url: 'https://github.com/x/a.exe', size: 10 },
      { name: 'bad', browser_download_url: 'http://example.com/bad', size: 1 },
      'junk'
    ]
  }

  it('reads version, page and https assets, not the release text', () => {
    expect(parseRelease(json)).toEqual({
      version: '1.2.0',
      name: '4FXELIZER v1.2.0',
      notes: '',
      page: 'https://github.com/forfex/4fxelizer/releases/tag/v1.2.0',
      assets: [{ name: 'a.exe', url: 'https://github.com/x/a.exe', size: 10 }]
    })
  })

  it('ignores drafts, pre-releases and odd tags', () => {
    expect(parseRelease({ ...json, draft: true })).toBeNull()
    expect(parseRelease({ ...json, prerelease: true })).toBeNull()
    expect(parseRelease({ ...json, tag_name: 'v1.3.0-beta.1' })).toBeNull()
    expect(parseRelease({ ...json, tag_name: 'latest' })).toBeNull()
    expect(parseRelease(null)).toBeNull()
  })

  it('keeps the page on GitHub', () => {
    expect(parseRelease({ ...json, html_url: 'https://example.com' })!.page).toBe('https://github.com/forfex/4fxelizer/releases')
  })
})

describe('pickAsset', () => {
  it('finds the file for each install kind', () => {
    expect(pickAsset(ASSETS, 'nsis', 'x64')?.name).toBe('4fxelizer-1.2.0-setup.exe')
    expect(pickAsset(ASSETS, 'dmg', 'arm64')?.name).toBe('4fxelizer-1.2.0-arm64.dmg')
    expect(pickAsset(ASSETS, 'dmg', 'x64')?.name).toBe('4fxelizer-1.2.0-x64.dmg')
    expect(pickAsset(ASSETS, 'appimage', 'x64')?.name).toBe('4fxelizer-1.2.0-x86_64.AppImage')
    expect(pickAsset(ASSETS, 'deb', 'x64')?.name).toBe('4fxelizer-1.2.0-amd64.deb')
  })

  it('finds nothing for an architecture the release lacks', () => {
    expect(pickAsset(ASSETS, 'appimage', 'arm64')).toBeNull()
    expect(pickAsset(ASSETS, 'deb', 'arm64')).toBeNull()
  })
})

describe('checksumFor', () => {
  const hash = 'a'.repeat(64)
  const other = 'B'.repeat(64)
  const listing = `${other}  4fxelizer-1.2.0-x64.dmg\r\n${hash}  4fxelizer-1.2.0-setup.exe\n${other} *4fxelizer-1.2.0-x86_64.AppImage\n`

  it('finds a file in a sha256sum listing', () => {
    expect(checksumFor(listing, '4fxelizer-1.2.0-setup.exe')).toBe(hash)
    expect(checksumFor(listing, '4fxelizer-1.2.0-x86_64.AppImage')).toBe('b'.repeat(64))
    expect(checksumFor(listing, 'setup.exe')).toBeNull()
    expect(checksumFor('garbage', 'x')).toBeNull()
  })
})

describe('normalizeUpdateSettings', () => {
  it('checks on launch, does not update automatically by default', () => {
    expect(normalizeUpdateSettings(undefined)).toEqual(DEFAULT_UPDATE_SETTINGS)
    expect(DEFAULT_UPDATE_SETTINGS).toEqual({ checkOnLaunch: true, auto: false, skipped: '' })
  })

  it('keeps valid values', () => {
    expect(normalizeUpdateSettings({ checkOnLaunch: false, auto: true, skipped: '1.2.0' })).toEqual({ checkOnLaunch: false, auto: true, skipped: '1.2.0' })
    expect(normalizeUpdateSettings({ auto: 'yes', skipped: 'soon' })).toEqual(DEFAULT_UPDATE_SETTINGS)
  })
})
