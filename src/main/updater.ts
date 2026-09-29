// Updates from GitHub releases (see @shared/update). The Windows installer build and the Linux
// AppImage update in place: the new file is downloaded, checked against the release's
// SHA256SUMS.txt and installed when the app quits, which then starts again. Other builds (macOS,
// .deb, unpacked) open the release page instead.

import { app, BrowserWindow, net, shell } from 'electron'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, open, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { IPC } from '@shared/api'
import {
  checksumFor,
  compareVersions,
  CHECKSUMS_ASSET,
  LATEST_RELEASE_URL,
  parseRelease,
  pickAsset,
  RELEASES_PAGE,
  type InstallKind,
  type Release,
  type UpdateState
} from '@shared/update'
import { getSettings } from './settings'

/**
 * Development only: `FXELIZER_UPDATE_AS=<version>` pretends the app is that version, so a check
 * finds the latest release; downloads and checksums run for real, but nothing is installed.
 */
const pretendVersion = !app.isPackaged ? process.env.FXELIZER_UPDATE_AS : undefined

export const currentVersion = (): string => pretendVersion || app.getVersion()

function installKind(): InstallKind | null {
  if (process.platform === 'win32') return 'nsis'
  if (process.platform === 'darwin') return 'dmg'
  if (process.platform === 'linux') return process.env.APPIMAGE ? 'appimage' : 'deb'
  return null
}

/** Whether this copy can replace itself: installed by the NSIS installer (it leaves its uninstaller next to the exe), or an AppImage. */
function canInstallInPlace(kind: InstallKind | null): boolean {
  if (kind !== 'nsis' && kind !== 'appimage') return false
  if (pretendVersion) return true
  if (!app.isPackaged) return false
  if (kind === 'appimage') return true
  return existsSync(join(dirname(process.execPath), `Uninstall ${app.getName()}.exe`))
}

let state: UpdateState = { status: 'idle' }
/** The downloaded update, installed when the app quits with the 'update' intent. */
let downloaded: { kind: InstallKind; file: string } | null = null
let busy: Promise<void> | null = null
let quitToInstall: () => void = () => app.quit()

function setState(next: UpdateState): void {
  state = next
  for (const win of BrowserWindow.getAllWindows()) if (!win.webContents.isDestroyed()) win.webContents.send(IPC.updateState, state)
}

export const updateState = (): UpdateState => state

async function fetchLatest(): Promise<Release> {
  const response = await net.fetch(LATEST_RELEASE_URL, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `4FXELIZER/${app.getVersion()}` },
    cache: 'no-store'
  })
  if (response.status === 404) throw new Error('No release has been published yet.')
  if (response.status === 403 || response.status === 429) throw new Error('GitHub is limiting requests right now. Try again later.')
  if (!response.ok) throw new Error(`GitHub answered ${response.status}.`)
  const release = parseRelease(await response.json())
  if (!release) throw new Error('The latest release could not be read.')
  return release
}

const message = (e: unknown): string => {
  const text = e instanceof Error ? e.message : String(e)
  return /net::|fetch failed|ENOTFOUND|ECONN/i.test(text) ? 'Could not reach GitHub. Check the internet connection.' : text
}

/**
 * Looks for a newer release. `launch`: the startup check, which installs it straight away with
 * automatic updates on, and otherwise asks unless the user skipped that version.
 */
export function checkForUpdates(launch = false): Promise<void> {
  if (busy) return busy
  if (state.status === 'ready') return Promise.resolve()
  busy = (async () => {
    setState({ status: 'checking' })
    try {
      const release = await fetchLatest()
      if (compareVersions(release.version, currentVersion()) <= 0) {
        setState({ status: 'up-to-date', latest: release.version })
        return
      }
      const kind = installKind()
      const installable = canInstallInPlace(kind) && kind !== null && pickAsset(release.assets, kind, process.arch) !== null
      const { auto, skipped } = getSettings().updates
      if (launch && auto && installable) {
        setState({ status: 'available', release, installable, prompt: false })
        await download(release)
        if (downloaded) quitToInstall()
        return
      }
      setState({ status: 'available', release, installable, prompt: launch && skipped !== release.version })
    } catch (e) {
      console.warn('Update check failed:', e)
      setState({ status: 'error', message: message(e), release: 'release' in state ? state.release : undefined })
    }
  })().finally(() => {
    busy = null
  })
  return busy
}

async function fetchText(url: string): Promise<string> {
  const response = await net.fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Download failed (${response.status}).`)
  return response.text()
}

/** Downloads the release's file for this build into the temp folder and checks its SHA-256. */
async function download(release: Release): Promise<void> {
  const kind = installKind()
  const asset = kind && pickAsset(release.assets, kind, process.arch)
  const sums = release.assets.find((a) => a.name === CHECKSUMS_ASSET)
  if (!kind || !asset) throw new Error('This release has no download for this computer.')
  if (!sums) throw new Error('This release has no checksums, so the download could not be verified.')

  const expected = checksumFor(await fetchText(sums.url), asset.name)
  if (!expected) throw new Error(`${CHECKSUMS_ASSET} does not list ${asset.name}.`)

  const dir = join(app.getPath('temp'), '4fxelizer-update')
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const file = join(dir, basename(asset.name))

  const response = await net.fetch(asset.url, { cache: 'no-store' })
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}).`)
  const total = Number(response.headers.get('content-length')) || asset.size
  const hash = createHash('sha256')
  const out = await open(file, 'w')
  let received = 0
  let reported = 0
  try {
    const reader = response.body.getReader()
    setState({ status: 'downloading', release, received, total })
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value)
      await out.write(value)
      received += value.byteLength
      if (received - reported > 256 * 1024 || received === total) {
        reported = received
        setState({ status: 'downloading', release, received, total })
      }
    }
  } finally {
    await out.close()
  }
  if (hash.digest('hex') !== expected) {
    await rm(file, { force: true })
    throw new Error('The download was damaged (its checksum does not match). Try again.')
  }
  downloaded = { kind, file }
  setState({ status: 'ready', release })
}

/**
 * The user chose to update: builds that install in place download and then quit to install
 * (asking about unsaved changes first); the others open the release page.
 */
export async function installUpdate(): Promise<void> {
  if (state.status === 'ready') return quitToInstall()
  const release = state.status === 'available' || state.status === 'error' ? state.release : undefined
  if (!release) return
  const installable = canInstallInPlace(installKind())
  if (!installable) {
    await shell.openExternal(release.page.startsWith('https://github.com/') ? release.page : RELEASES_PAGE)
    return
  }
  if (busy) return busy
  busy = download(release)
    .then(() => quitToInstall())
    .catch((e: unknown) => {
      console.warn('Update download failed:', e)
      setState({ status: 'error', message: message(e), release })
    })
    .finally(() => {
      busy = null
    })
  return busy
}

/** How the app quits to install a downloaded update (index.ts: the unsaved-changes question, then quit). */
export function setQuitToInstall(quit: () => void): void {
  quitToInstall = () => {
    void prepareInstall().then((ok) => ok && quit())
  }
}

/** Before quitting to update: puts the new AppImage in place of the old one (the running app keeps its mounted copy). */
async function prepareInstall(): Promise<boolean> {
  if (!downloaded) return false
  if (!app.isPackaged) {
    console.log(`Development build: would install ${downloaded.file} and restart.`)
    return false
  }
  if (downloaded.kind === 'appimage') {
    const target = process.env.APPIMAGE!
    // Next to the old file first, so the swap is a rename on the same drive.
    const staged = `${target}.update`
    try {
      await copyFile(downloaded.file, staged)
      await chmod(staged, 0o755)
      await rename(staged, target)
    } catch (e) {
      await rm(staged, { force: true })
      setState({ status: 'error', message: `Could not replace ${basename(target)}: ${message(e)}`, release: 'release' in state ? state.release : undefined })
      downloaded = null
      return false
    }
  }
  return true
}

/** Starts the installer or the new AppImage (from will-quit, after prepareInstall succeeded). */
export function runInstaller(): void {
  if (!downloaded || !app.isPackaged) return
  if (downloaded.kind === 'nsis') {
    // Silent, same install mode and folder as before (from the registry); --force-run starts the app afterwards.
    spawn(downloaded.file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref()
  } else {
    const env = { ...process.env }
    for (const key of ['APPIMAGE', 'APPDIR', 'ARGV0', 'OWD']) delete env[key]
    spawn(process.env.APPIMAGE!, [], { detached: true, stdio: 'ignore', env }).unref()
  }
}
