// Live reload: the open textures, their maps and the model (with the files it was parsed with) reload
// when their files change on disk, e.g. when the artist saves from Photoshop or re-exports from
// Blender. Main watches the files (src/main/watch.ts); this keeps its list current and reloads
// what changed. File > Reload Changed Files turns it off.

import type { OpenedFile } from '@shared/api'
import { reloadImageFile, reloadMapFile } from './actions'
import { loadModelFile } from './modelActions'
import { useApp } from './store'
import { changedRoles, watchedPaths } from './watchedFiles'

/** A model reload is queued and hasn't started: more changes to its files (an export writes the model and its .mtl or .bin) join it. */
let modelQueued = false

async function reload(path: string, roles: ReturnType<typeof changedRoles>): Promise<void> {
  if (roles.textures.length || roles.map) {
    const file = await window.fx.readWatchedFile(path)
    if (file) for (const id of roles.textures) await reloadImageFile(file, id)
    if (file && roles.map) await reloadMapFile(file)
  }
  if (roles.model) {
    modelQueued = false
    await reloadModel()
  }
}

/** Reads the model file again (also when one of its buffers or material libraries changed). */
async function reloadModel(): Promise<void> {
  const path = useApp.getState().model?.path
  const file: OpenedFile | null = path ? await window.fx.readWatchedFile(path) : null
  if (file) await loadModelFile(file.name, file.bytes, file.path, { reload: true })
}

/** Keeps main's watch list in step with what's open, and reloads files as they change. */
export function startLiveReload(): () => void {
  let sent = ''
  const sync = (): void => {
    const paths = watchedPaths(useApp.getState())
    const key = paths.join('\n')
    if (key === sent) return
    sent = key
    window.fx.watchFiles(paths)
  }
  // One reload at a time, in the order the changes came in.
  let queue = Promise.resolve()
  const offChange = window.fx.onFileChanged((path) => {
    const roles = changedRoles(useApp.getState(), path)
    if (roles.model && modelQueued) roles.model = false
    if (!roles.textures.length && !roles.map && !roles.model) return
    if (roles.model) modelQueued = true
    queue = queue.then(() => reload(path, roles)).catch((e) => console.warn('Live reload failed:', e))
  })
  const unsubscribe = useApp.subscribe((s, prev) => {
    if (s.liveReload !== prev.liveReload || s.textures !== prev.textures || s.model !== prev.model) sync()
  })
  sync()
  return () => {
    unsubscribe()
    offChange()
    window.fx.watchFiles([])
  }
}
