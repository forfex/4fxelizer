// Projects: saving the session (stack, palettes, texture, maps, model) to a .pxproj file and
// opening it again, plus the "unsaved changes" question before a project is replaced or the
// window closes.

import { useMemo } from 'react'
import type { OpenedFile } from '@shared/api'
import { MAP_SLOTS } from '@shared/maps'
import { baseName, fileRef, PROJECT_SUFFIX } from '@shared/project'
import { clearMaps, loadImageFile, loadMapInto } from '@/actions'
import { getEngine } from '@/engine'
import { readTextureRgba8 } from '@/gpu/textureIO'
import { encodePng } from '@/image/png'
import { closeModel, loadModelFile, stopBake } from '@/modelActions'
import { base64ToBytes, bytesToBase64, parseProject, projectSignature, serializeProject, type ProjectData, type ProjectMap } from '@/stack/project'
import { useApp, type AppState } from '@/store'

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

const withoutSuffix = (name: string): string => name.replace(/\.[^.]+$/, '')

/** Whether the open project has changes that aren't saved (false when no project is open). */
export function projectDirty(state: AppState = useApp.getState()): boolean {
  return !!state.project && projectSignature(state) !== state.project.saved
}

/** projectDirty() for components; recomputed only when something a project saves changes. */
export function useProjectDirty(): boolean {
  const project = useApp((s) => s.project)
  const stages = useApp((s) => s.stages)
  const palettes = useApp((s) => s.palettes)
  const outputLock = useApp((s) => s.outputLock)
  const image = useApp((s) => s.image)
  const maps = useApp((s) => s.maps)
  const model = useApp((s) => s.model)
  const material = useApp((s) => s.modelMaterial)
  const uvSet = useApp((s) => s.modelUvSet)
  return useMemo(
    () => !!project && projectDirty(useApp.getState()),
    [project, stages, palettes, outputLock, image, maps, model, material, uvSet]
  )
}

async function texturePng(texture: GPUTexture): Promise<string> {
  const engine = getEngine()!
  return bytesToBase64(await encodePng(await readTextureRgba8(engine.gpu.device, texture)))
}

/** What the project file holds, for a project saved at `path`. */
async function snapshot(state: AppState, path: string): Promise<{ data: ProjectData; notes: string[] }> {
  const engine = getEngine()!
  const notes: string[] = []
  const { image, model } = state

  let texture: ProjectData['texture'] = null
  if (image?.path) texture = { name: image.name, file: fileRef(path, image.path) }
  else if (image && engine.sourceTexture) texture = { name: image.name, png: await texturePng(engine.sourceTexture) }

  const maps: ProjectMap[] = []
  for (const { id: slot } of MAP_SLOTS) {
    const map = state.maps[slot]
    if (!map) continue
    const base = { slot, channel: map.channel, name: map.name }
    if (map.path && !map.baked) {
      maps.push({ ...base, file: fileRef(path, map.path) })
      continue
    }
    const gpuTexture = engine.mapTexture(slot)
    if (gpuTexture) maps.push({ ...base, png: await texturePng(gpuTexture), ...(map.baked ? { baked: true as const } : {}) })
  }

  let projectModel: ProjectData['model'] = null
  if (model?.path) projectModel = { name: model.name, file: fileRef(path, model.path), material: state.modelMaterial, uvSet: state.modelUvSet }
  else if (model) notes.push(`${model.name} has no file on disk, so the project doesn't include it.`)

  const doc = { stages: state.stages, palettes: state.palettes, outputLock: state.outputLock }
  return { data: { doc, presetName: state.presetName, texture, maps, model: projectModel }, notes }
}

function suggestedName(state: AppState): string {
  const name = state.project?.name ?? (state.image ? withoutSuffix(state.image.name) : state.model ? withoutSuffix(state.model.name) : 'Untitled')
  return `${name}${PROJECT_SUFFIX}`
}

/**
 * Saves the project to its file, or asks where first (Save As, or nothing saved yet). Returns
 * true when it was written.
 */
export async function saveProject(opts: { as?: boolean } = {}): Promise<boolean> {
  const state = useApp.getState()
  if (!getEngine()) return false
  let path = state.project?.path ?? null
  if (!path || opts.as) path = await window.fx.chooseProjectPath(suggestedName(state))
  if (!path) return false
  // What's saved is the state when Save was chosen (reading maps back from the GPU takes a moment).
  const current = useApp.getState()
  const signature = projectSignature(current)
  try {
    const { data, notes } = await snapshot(current, path)
    await window.fx.writeProject(path, serializeProject(data))
    const name = withoutSuffix(baseName(path))
    useApp.getState().setProject({ path, name, saved: signature })
    useApp.getState().setMessage({ kind: notes.length ? 'error' : 'info', text: `Saved project ${name}.${notes.length ? ` ${notes.join(' ')}` : ''}` })
    return true
  } catch (e) {
    useApp.getState().setMessage({ kind: 'error', text: `Couldn't save the project: ${errorText(e)}` })
    return false
  }
}

// ── Unsaved changes ────────────────────────────────────────────────────────

let answer: ((choice: 'save' | 'discard' | 'cancel') => void) | null = null

/** The unsaved-changes dialog's buttons. */
export function answerUnsaved(choice: 'save' | 'discard' | 'cancel'): void {
  const resolve = answer
  answer = null
  useApp.getState().setUnsavedPrompt(null)
  resolve?.(choice)
}

/**
 * Before the open project is replaced or closed: asks whether to save its changes. Resolves true
 * when it's fine to go on (nothing to save, saved, or discarded).
 */
export async function confirmDiscard(before: string): Promise<boolean> {
  const state = useApp.getState()
  if (!projectDirty(state)) return true
  answer?.('cancel')
  const choice = await new Promise<'save' | 'discard' | 'cancel'>((resolve) => {
    answer = resolve
    state.setUnsavedPrompt(`Save the changes to ${state.project!.name} before ${before}?`)
  })
  if (choice === 'cancel') return false
  return choice === 'discard' || (await saveProject())
}

/**
 * Tells main whether the project has unsaved changes (it then holds back closing the window) and
 * asks when the user closes it.
 */
export function startProjectGuard(): () => void {
  let sent = false
  const unsubscribe = useApp.subscribe((s, prev) => {
    const relevant =
      s.project !== prev.project ||
      s.stages !== prev.stages ||
      s.palettes !== prev.palettes ||
      s.outputLock !== prev.outputLock ||
      s.image !== prev.image ||
      s.maps !== prev.maps ||
      s.model !== prev.model ||
      s.modelMaterial !== prev.modelMaterial ||
      s.modelUvSet !== prev.modelUvSet
    if (!relevant) return
    const dirty = projectDirty(s)
    if (dirty === sent) return
    sent = dirty
    window.fx.setDocumentEdited(dirty)
  })
  const offClose = window.fx.onCloseRequested(() => {
    void confirmDiscard('closing').then((ok) => ok && window.fx.closeWindow())
  })
  return () => {
    unsubscribe()
    offClose()
  }
}

// ── Opening ────────────────────────────────────────────────────────────────

export async function openProject(): Promise<void> {
  if (!(await confirmDiscard('opening another project'))) return
  const file = await window.fx.openProject()
  if (file) await openProjectFile(file, { confirmed: true })
}

/**
 * Opens a project: its stack and palettes (with fresh undo history), texture, model and maps.
 * Files that moved are looked up next to the project; missing ones are reported.
 */
export async function openProjectFile(file: OpenedFile, opts: { confirmed?: boolean } = {}): Promise<void> {
  const app = useApp.getState()
  if (!getEngine()) return
  if (!file.path) {
    app.setMessage({ kind: 'error', text: `Couldn't open ${file.name}: its location on disk is unknown.` })
    return
  }
  const projectPath = file.path
  let parsed: ReturnType<typeof parseProject>
  try {
    parsed = parseProject(new TextDecoder().decode(file.bytes))
  } catch (e) {
    app.setMessage({ kind: 'error', text: `Couldn't open ${file.name}: ${errorText(e)}` })
    return
  }
  if (!opts.confirmed && !(await confirmDiscard('opening another project'))) return
  const { project, warnings } = parsed
  const missing: string[] = []
  const read = (ref: Parameters<typeof window.fx.readProjectFile>[1]): Promise<OpenedFile | null> =>
    window.fx.readProjectFile(projectPath, ref).catch(() => null)

  stopBake()
  // A project replaces every open texture.
  for (const t of useApp.getState().textures) useApp.getState().closeTexture(t.id)
  // The stack first, so the texture is processed with it right away.
  app.loadDoc(project.doc)
  app.clearHistory()
  app.setPresetName(project.presetName)

  const { texture } = project
  if (texture) {
    const f = 'file' in texture ? await read(texture.file) : { name: texture.name, bytes: base64ToBytes(texture.png) }
    if (f) await loadImageFile(f.name, f.bytes, f.path, { findMaps: false })
    if (!f || useApp.getState().image?.name !== f.name) missing.push(texture.name)
  }
  // The project lists its maps; the ones open now belong to the previous texture and model.
  clearMaps()

  if (project.model) {
    const f = await read(project.model.file)
    if (f) await loadModelFile(f.name, f.bytes, f.path, { restore: { material: project.model.material, uvSet: project.model.uvSet } })
    if (!f || useApp.getState().model?.path !== f.path) {
      missing.push(project.model.name)
      closeModel()
    }
  } else if (useApp.getState().model) closeModel()

  // After the model: loading one clears baked maps.
  for (const map of project.maps) {
    const f = 'file' in map ? await read(map.file) : { name: map.name, bytes: base64ToBytes(map.png) }
    if (!f) {
      missing.push(map.name)
      continue
    }
    try {
      await loadMapInto([{ slot: map.slot, channel: map.channel }], 'file' in map ? f.name : map.name, f.bytes, f.path, { baked: 'baked' in map })
    } catch (e) {
      warnings.push(`Couldn't load ${map.name}: ${errorText(e)}.`)
    }
  }

  const name = withoutSuffix(file.name)
  useApp.getState().setProject({ path: projectPath, name, saved: projectSignature(useApp.getState()) })
  const problems = [
    ...(missing.length ? [`Couldn't find ${[...new Set(missing)].join(', ')}; saving leaves them out of the project.`] : []),
    ...warnings
  ]
  useApp.getState().setMessage({ kind: problems.length ? 'error' : 'info', text: `Opened project ${name}.${problems.length ? ` ${problems.join(' ')}` : ''}` })
}
