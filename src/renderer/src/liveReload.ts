// Live reload: the open texture, its maps and the model (with the files it was parsed with) reload
// when their files change on disk, e.g. when the artist saves from Photoshop or re-exports from
// Blender. Main watches the files (src/main/watch.ts); this keeps its list current and reloads
// what changed. File > Reload Changed Files turns it off.

import type { OpenedFile } from '@shared/api'
import { reloadImageFile, reloadMapFile } from './actions'
import { loadModelFile } from './modelActions'
import { useApp } from './store'
import { changedRoles, watchedPaths } from './watchedFiles'

async function reload(path: string): Promise<void> {
  const roles = changedRoles(useApp.getState(), path)
  if (!roles.texture && !roles.map && !roles.model) return
  const file = await window.fx.readWatchedFile(path)
  if (!file) return
  if (roles.texture) await reloadImageFile(file)
  if (roles.map) await reloadMapFile(file)
  if (roles.model) await reloadModel()
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
    queue = queue.then(() => reload(path)).catch((e) => console.warn('Live reload failed:', e))
  })
  const unsubscribe = useApp.subscribe((s, prev) => {
    if (s.liveReload !== prev.liveReload || s.image !== prev.image || s.maps !== prev.maps || s.model !== prev.model) sync()
  })
  sync()
  return () => {
    unsubscribe()
    offChange()
    window.fx.watchFiles([])
  }
}
