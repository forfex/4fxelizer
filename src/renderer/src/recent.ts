// File › Open Recent: remembers the files the user opened (not the ones a project or a model
// brings along), and opens one again.

import { addRecent, removeRecent } from '@shared/recent'
import { isProjectFile } from '@shared/project'
import { openDroppedFiles } from '@/actions'
import { confirmDiscard, openProjectFile } from '@/projectActions'
import { savedSettings, saveSettings } from '@/settings'
import { useApp } from '@/store'

/** Puts files the user just opened or saved at the top of the list. */
export function noteRecent(paths: readonly (string | undefined)[]): void {
  const known = paths.filter((p): p is string => !!p)
  if (known.length) saveSettings({ recentFiles: addRecent(savedSettings().recentFiles, known) })
}

export function clearRecent(): void {
  saveSettings({ recentFiles: [] })
}

/** Opens the file at a place in the list; one that is gone is taken off it. */
export async function openRecent(index: number): Promise<void> {
  const path = savedSettings().recentFiles[index]
  if (!path) return
  const project = isProjectFile(path)
  if (project && !(await confirmDiscard('opening another project', { unsavedWork: true }))) return
  const file = await window.fx.openRecent(path)
  if (!file) {
    saveSettings({ recentFiles: removeRecent(savedSettings().recentFiles, path) })
    useApp.getState().setMessage({ kind: 'error', text: `${path} is no longer there.` })
    return
  }
  if (project) await openProjectFile(file, { confirmed: true })
  else await openDroppedFiles([file])
  noteRecent([path])
}
