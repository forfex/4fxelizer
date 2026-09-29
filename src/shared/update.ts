// Updates from the project's GitHub releases: which release is newer, and which of its files
// installs on this machine. Main does the network and file work (src/main/updater.ts).

export const RELEASES_REPO = 'forfex/4fxelizer'
export const LATEST_RELEASE_URL = `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`
export const RELEASES_PAGE = `https://github.com/${RELEASES_REPO}/releases`
/** The release asset listing every file's SHA-256 (made by the release workflow). */
export const CHECKSUMS_ASSET = 'SHA256SUMS.txt'
/**
 * The release asset with the short "What's new" list the update window shows (WHATSNEW.md in the
 * repo, uploaded by the release workflow). The GitHub release text is not shown in the app.
 */
export const WHATS_NEW_ASSET = 'WHATSNEW.md'
/** Longest "What's new" text read (characters). */
export const MAX_WHATS_NEW = 16 * 1024

export interface ReleaseAsset {
  name: string
  url: string
  size: number
}

export interface Release {
  /** "1.2.0" (the tag without its "v"). */
  version: string
  name: string
  /** The short "What's new" list (markdown, from WHATS_NEW_ASSET); '' when the release has none. */
  notes: string
  /** The release's page on GitHub. */
  page: string
  assets: ReleaseAsset[]
}

/** Update settings, in UserSettings. */
export interface UpdateSettings {
  /** Look for a new version when the app starts. */
  checkOnLaunch: boolean
  /** Download and install a new version at startup, then restart into it, without asking. */
  auto: boolean
  /** Version the user chose to skip (no popup for it at startup); '' = none. */
  skipped: string
  /** Last version whose "What's new" was shown at launch; '' = none yet (a new install shows it). */
  seen: string
}

export const DEFAULT_UPDATE_SETTINGS: UpdateSettings = { checkOnLaunch: true, auto: false, skipped: '', seen: '' }

/**
 * Where updating stands, as main reports it to the renderer. `prompt`: found by the startup
 * check, so the renderer asks the user (for an error: one the user didn't see coming, so the
 * update window opens to show it). `ready`: downloaded; the renderer asks about unsaved work, then
 * restarts to install. `installable`: this build can install it in place
 * (otherwise the release page is opened to download it).
 */
export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'up-to-date'; latest: string }
  | { status: 'available'; release: Release; installable: boolean; prompt: boolean }
  | { status: 'downloading'; release: Release; received: number; total: number }
  | { status: 'ready'; release: Release }
  | { status: 'error'; message: string; release?: Release; prompt?: boolean }

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** Semantic version parts, or null when `text` isn't one ("v1.2.3" and "1.2.3-beta.1" are). */
export function parseVersion(text: string): { core: [number, number, number]; pre: string[] } | null {
  const m = VERSION.exec(text.trim())
  if (!m) return null
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] }
}

/** <0 when a is older than b, 0 when equal, >0 when newer (semver precedence); invalid versions sort oldest. */
export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a)
  const vb = parseVersion(b)
  if (!va || !vb) return (va ? 1 : 0) - (vb ? 1 : 0)
  for (let i = 0; i < 3; i++) if (va.core[i] !== vb.core[i]) return va.core[i]! - vb.core[i]!
  // A pre-release is older than its release.
  if (!va.pre.length || !vb.pre.length) return (va.pre.length ? -1 : 0) + (vb.pre.length ? 1 : 0)
  for (let i = 0; i < Math.min(va.pre.length, vb.pre.length); i++) {
    const x = va.pre[i]!
    const y = vb.pre[i]!
    if (x === y) continue
    const nx = /^\d+$/.test(x)
    const ny = /^\d+$/.test(y)
    if (nx && ny) return Number(x) - Number(y)
    if (nx !== ny) return nx ? -1 : 1
    return x < y ? -1 : 1
  }
  return va.pre.length - vb.pre.length
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * A release from GitHub's releases API; null for drafts, pre-releases or anything unexpected.
 * `notes` stays empty: it is read from WHATS_NEW_ASSET afterwards.
 */
export function parseRelease(json: unknown): Release | null {
  if (!isObject(json) || json.draft === true || json.prerelease === true) return null
  const tag = str(json.tag_name)
  const parsed = parseVersion(tag)
  if (!parsed || parsed.pre.length) return null
  const assets: ReleaseAsset[] = []
  for (const a of Array.isArray(json.assets) ? json.assets : []) {
    if (!isObject(a)) continue
    const name = str(a.name)
    const url = str(a.browser_download_url)
    if (!name || !url.startsWith('https://')) continue
    assets.push({ name, url, size: typeof a.size === 'number' && a.size >= 0 ? a.size : 0 })
  }
  const page = str(json.html_url)
  return {
    version: tag.replace(/^v/, ''),
    name: str(json.name) || tag,
    notes: '',
    page: page.startsWith('https://github.com/') ? page : RELEASES_PAGE,
    assets
  }
}

/**
 * How this copy of the app was installed, which decides the file an update needs: `nsis` (the
 * Windows installer), `appimage` (Linux AppImage), `dmg` (macOS) or `deb`.
 */
export type InstallKind = 'nsis' | 'appimage' | 'dmg' | 'deb'

/** The release file for this install kind and CPU architecture (Node's `process.arch`), if the release has one. */
export function pickAsset(assets: ReleaseAsset[], kind: InstallKind, arch: string): ReleaseAsset | null {
  const lower = (a: ReleaseAsset): string => a.name.toLowerCase()
  const find = (test: (name: string) => boolean): ReleaseAsset | null => assets.find((a) => test(lower(a))) ?? null
  switch (kind) {
    case 'nsis':
      return find((n) => n.endsWith('-setup.exe'))
    case 'dmg':
      return find((n) => n.endsWith(`-${arch}.dmg`))
    case 'appimage': {
      const names: Record<string, string> = { x64: 'x86_64', arm64: 'arm64', ia32: 'i386', arm: 'armv7l' }
      return find((n) => n.endsWith(`-${names[arch] ?? arch}.appimage`))
    }
    case 'deb': {
      const names: Record<string, string> = { x64: 'amd64', arm64: 'arm64', ia32: 'i386', arm: 'armv7l' }
      return find((n) => n.endsWith(`_${names[arch] ?? arch}.deb`) || n.endsWith(`-${names[arch] ?? arch}.deb`))
    }
  }
}

/** The SHA-256 (lower-case hex) that a `sha256sum` listing gives for `file`, if it lists it. */
export function checksumFor(listing: string, file: string): string | null {
  for (const line of listing.split(/\r?\n/)) {
    // "<hash>  <name>" (text mode) or "<hash> *<name>" (binary mode).
    const m = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line.trim())
    if (m && m[2]!.trim() === file) return m[1]!.toLowerCase()
  }
  return null
}

export function normalizeUpdateSettings(raw: unknown): UpdateSettings {
  const r = isObject(raw) ? raw : {}
  return {
    checkOnLaunch: typeof r.checkOnLaunch === 'boolean' ? r.checkOnLaunch : DEFAULT_UPDATE_SETTINGS.checkOnLaunch,
    auto: typeof r.auto === 'boolean' ? r.auto : DEFAULT_UPDATE_SETTINGS.auto,
    skipped: typeof r.skipped === 'string' && parseVersion(r.skipped) ? r.skipped : '',
    seen: typeof r.seen === 'string' && parseVersion(r.seen) ? r.seen : ''
  }
}
