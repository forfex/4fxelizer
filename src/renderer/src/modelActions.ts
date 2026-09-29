// Connects the UI to 3D models: opening one (with the files it refers to and its base color
// texture), choosing the texture set shown with the open texture, and baking maps from it.

import { BAKE_MAPS, type BakeMap } from '@shared/bake'
import { modelFormat } from '@shared/model'
import { clearMaps, loadImageFile, nextMapVersion, reloadImageFile, thumbnail } from '@/actions'
import { getEngine } from '@/engine'
import { Baker } from '@/gpu/bake/baker'
import { readTextureRgba8 } from '@/gpu/textureIO'
import { gbufferAsync, loadModelAsync } from '@/model/modelAsync'
import type { ModelData, TextureRef } from '@/model/model'
import { objMaterialLibraries } from '@/model/mtl'
import { useApp, type ModelInfo } from '@/store'

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path

/** The texture's file name as the user knows it (for matching and messages). */
export function textureName(ref: TextureRef | null): string | null {
  if (!ref) return null
  return ref.kind === 'embedded' ? ref.name : fileName(ref.reference.replace(/\\/g, '/'))
}

/** Files the model needs before it can be parsed: glTF buffers, OBJ material libraries. */
function resourceNames(name: string, bytes: Uint8Array): string[] {
  const format = modelFormat(name)
  if (format === 'obj') return objMaterialLibraries(new TextDecoder().decode(bytes))
  // A .glb starts with "glTF"; a .gltf is JSON.
  if (format === 'gltf' && bytes[0] !== 0x67) {
    try {
      const json = JSON.parse(new TextDecoder().decode(bytes)) as { buffers?: { uri?: string }[] }
      return (json.buffers ?? []).map((b) => b.uri).filter((u): u is string => !!u && !u.startsWith('data:'))
    } catch {
      return []
    }
  }
  return []
}

async function readResources(
  name: string,
  bytes: Uint8Array,
  path: string | undefined
): Promise<{ resources: Record<string, Uint8Array>; paths: string[]; missing: string[] }> {
  const resources: Record<string, Uint8Array> = {}
  const paths: string[] = []
  const missing: string[] = []
  for (const ref of resourceNames(name, bytes)) {
    const file = path ? await window.fx.readModelFile(path, ref).catch(() => null) : null
    if (file) {
      resources[ref] = file.bytes
      if (file.path) paths.push(file.path)
    } else missing.push(ref)
  }
  return { resources, paths, missing }
}

/** The material a texture file belongs to, matched by file name; -1 = none. */
function materialOfTexture(model: ModelData, texture: string): number {
  const name = texture.toLowerCase()
  return model.materials.findIndex((m) => textureName(m.texture)?.toLowerCase() === name)
}

/** Reads a material's base color texture and opens it. Returns its name, or null when it couldn't. */
async function openMaterialTexture(model: ModelData, material: number, path: string | undefined): Promise<string | null> {
  const ref = model.materials[material]?.texture
  if (!ref) return null
  if (ref.kind === 'embedded') {
    await loadImageFile(ref.name, ref.bytes)
    return useApp.getState().image?.name === ref.name ? ref.name : null
  }
  const file = path ? await window.fx.readModelFile(path, ref.reference).catch(() => null) : null
  if (!file) return null
  await loadImageFile(file.name, file.bytes, file.path)
  return useApp.getState().image?.name === file.name ? file.name : null
}

function summary(model: ModelData, path: string | undefined, resources: string[]): Omit<ModelInfo, 'version'> {
  return {
    name: model.name,
    path,
    resources,
    triangles: model.indices.length / 3,
    vertices: model.positions.length / 3,
    uvSets: model.uvSets.length,
    materials: model.materials.map((m, i) => ({ name: m.name, triangles: model.parts[i]!.count, texture: textureName(m.texture) })),
    warnings: model.warnings
  }
}

let loading = 0

/**
 * Opens a model in the 3D view. The texture set shown with the open texture is the one using that
 * texture; otherwise the model's first textured material, whose texture is then opened.
 * `reload`: the open model's file changed on disk; the texture set, UV set and view mode stay, and
 * a texture embedded in the model is loaded again.
 */
export async function loadModelFile(
  name: string,
  bytes: Uint8Array,
  path?: string,
  opts: { reload?: boolean; restore?: { material: number; uvSet: number } } = {}
): Promise<void> {
  const engine = getEngine()
  const app = useApp.getState()
  if (!engine) return
  const job = ++loading
  const previous = opts.reload ? { material: app.modelMaterial, uvSet: app.modelUvSet } : null
  if (!opts.reload) app.setMessage({ kind: 'info', text: `Loading ${name}…` })
  try {
    const { resources, paths, missing } = await readResources(name, bytes, path)
    const { model, bvh } = await loadModelAsync({ name, bytes, resources })
    if (job !== loading) return
    if (missing.length) model.warnings.push(`Missing files: ${missing.join(', ')}.`)
    if (opts.reload) stopBake()
    engine.setModel(model, bvh)
    clearMaps({ onlyBaked: true })

    // The open texture may already be this model's; else open the first texture it has.
    const image = useApp.getState().image
    let material = image ? materialOfTexture(model, image.name) : -1
    let opened: string | null = null
    let failed: string | null = null
    if (previous && material < 0 && previous.material < model.materials.length) material = previous.material
    // A project names the texture set; its texture is the project's (already open).
    if (opts.restore) material = opts.restore.material < model.materials.length ? opts.restore.material : Math.max(material, 0)
    // A texture embedded in the model changes with it.
    const ref = material >= 0 ? model.materials[material]!.texture : null
    if (previous && ref?.kind === 'embedded' && image && !image.path && image.name === ref.name) {
      await reloadImageFile({ name: ref.name, bytes: ref.bytes })
    }
    if (material < 0) {
      const textured = model.materials.findIndex((m) => m.texture)
      if (textured >= 0) {
        material = textured
        opened = await openMaterialTexture(model, textured, path).catch(() => null)
        if (!opened) failed = textureName(model.materials[textured]!.texture)
      } else {
        // Untextured: the material with the most triangles.
        material = model.parts.reduce((best, p, i) => (p.count > model.parts[best]!.count ? i : best), 0)
      }
    }
    if (job !== loading) return
    useApp.getState().setModel(summary(model, path, paths), material)
    if (opts.restore && opts.restore.uvSet < model.uvSets.length) useApp.getState().setModelUvSet(opts.restore.uvSet)
    const tris = `${(model.indices.length / 3).toLocaleString('en-US')} triangles`
    if (previous) {
      if (previous.uvSet < model.uvSets.length) useApp.getState().setModelUvSet(previous.uvSet)
      const warn = model.warnings.length ? ` ${model.warnings.join(' ')}` : ''
      useApp.getState().setMessage({ kind: warn ? 'error' : 'info', text: `Reloaded ${name} (${tris}).${warn}` })
      return
    }
    // Show the model: the 2D viewer alone switches to 2D and 3D side by side.
    if (useApp.getState().viewMode === '2d') useApp.getState().setViewMode('split')

    const detail = opened ? ` with its texture ${opened}` : failed ? `; its texture ${failed} couldn’t be opened` : ''
    const warn = model.warnings.length ? ` ${model.warnings.join(' ')}` : ''
    useApp.getState().setMessage({ kind: failed || warn ? 'error' : 'info', text: `Loaded ${name} (${tris})${detail}.${warn}` })
  } catch (e) {
    if (job === loading) useApp.getState().setMessage({ kind: 'error', text: `Couldn’t open ${name}: ${errorText(e)}` })
  }
}

export async function openModel(): Promise<void> {
  const file = await window.fx.openModel()
  if (file) await loadModelFile(file.name, file.bytes, file.path)
}

export function closeModel(): void {
  stopBake()
  getEngine()?.setModel(null, null)
  clearMaps({ onlyBaked: true })
  useApp.getState().setModel(null)
}

/** Opens the base color texture of a texture set (Bake panel). */
export async function openTextureOf(material: number): Promise<void> {
  const model = getEngine()?.model?.data
  const info = useApp.getState().model
  if (!model || !info) return
  const name = await openMaterialTexture(model, material, info.path).catch(() => null)
  if (!name) {
    const texture = textureName(model.materials[material]?.texture ?? null)
    useApp.getState().setMessage({ kind: 'error', text: texture ? `Couldn’t find or open ${texture}.` : 'That material has no texture.' })
  }
}

// ── Baking ─────────────────────────────────────────────────────────────────

/** How often (ms) a running bake writes its maps, so masks and the 3D view follow it. */
const PUBLISH_MS = 500

let bakeRun: { stop: boolean } | null = null

const MAP_NAMES: Record<BakeMap, string> = {
  ao: 'AO',
  cavity: 'cavity',
  curvature: 'curvature',
  edge: 'edge',
  thickness: 'thickness',
  height: 'height',
  up: 'up-facing'
}

/** Bakes the chosen maps from the model into the map slots, refining them step by step. */
export async function startBake(): Promise<void> {
  const engine = getEngine()
  const s = useApp.getState()
  const model = engine?.model
  if (!engine || !model || !s.model || bakeRun) return
  const run = { stop: false }
  bakeRun = run
  const settings = s.bake
  const size = settings.size
  const setJob = useApp.getState().setBakeJob
  setJob({ status: 'running', progress: 0, label: 'Preparing' })
  let baker: Baker | null = null
  try {
    if (!BAKE_MAPS.some((m) => settings.maps[m])) throw new Error('Choose at least one map to bake.')
    const gbuffer = await gbufferAsync({ material: s.modelMaterial, uvSet: s.modelUvSet, width: size, height: size, padding: settings.padding })
    if (engine.model !== model) return
    if (!gbuffer.covered) throw new Error('That texture set has no UVs to bake into.')
    baker = new Baker(engine.gpu.device, model, gbuffer, settings)
    const b = baker

    // Maps handed to the slots so far. One the user replaced or cleared since is left alone.
    const published = new Set<BakeMap>()
    const ours = (map: BakeMap, texture: GPUTexture): boolean => !published.has(map) || engine.mapTexture(map) === texture
    const publish = (thumbnails: Map<BakeMap, string | null> = new Map()): void => {
      b.resolve(ours)
      for (const { map, texture } of b.outputs) {
        if (!ours(map, texture)) continue
        const version = nextMapVersion()
        published.add(map)
        engine.setMapTexture(map, texture, version)
        useApp.getState().setMap(map, {
          name: `Baked ${MAP_NAMES[map]}`,
          width: b.width,
          height: b.height,
          channel: 'luma',
          version,
          thumbnail: thumbnails.get(map) ?? useApp.getState().maps[map]?.thumbnail ?? null,
          baked: true
        })
      }
    }

    let lastPublish = performance.now()
    while (!b.finished && !run.stop && engine.model === model) {
      await b.step()
      const { done, total, label } = b.progress
      setJob({ status: 'running', progress: total ? done / total : 1, label })
      if (performance.now() - lastPublish > PUBLISH_MS) {
        publish()
        lastPublish = performance.now()
      }
      // Let the UI draw between steps.
      await new Promise((r) => setTimeout(r, 0))
    }
    if (engine.model !== model) return

    publish()
    const thumbnails = new Map<BakeMap, string | null>()
    for (const { map, texture } of b.outputs) {
      if (!ours(map, texture)) continue
      const rgba = await readTextureRgba8(engine.gpu.device, texture)
      const bitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(rgba.data.buffer as ArrayBuffer, rgba.data.byteOffset, rgba.data.length), rgba.width, rgba.height))
      thumbnails.set(map, thumbnail(bitmap))
      bitmap.close()
    }
    publish(thumbnails)

    const maps = b.outputs.map((o) => MAP_NAMES[o.map]).join(', ')
    const overlap = gbuffer.overlapping / gbuffer.covered
    const note =
      overlap > 0.01
        ? ` ${Math.round(overlap * 100)}% of the texels have more than one triangle on them (mirrored or overlapping UVs); each shows one of them.`
        : ''
    setJob({ status: 'done', label: `${run.stop ? 'Stopped' : 'Baked'} ${maps} at ${size}×${size}.` })
    // Mirrored UVs are normal on symmetric models, so the overlap note is information, not an error.
    useApp.getState().setMessage({ kind: 'info', text: `${run.stop ? 'Stopped baking' : 'Baked'} ${maps} (${size}×${size}).${note}` })
  } catch (e) {
    setJob(null)
    useApp.getState().setMessage({ kind: 'error', text: `Baking failed: ${errorText(e)}` })
  } finally {
    // Textures that never reached their slot (an abandoned bake) belong to no one else.
    for (const { map, texture } of baker?.outputs ?? []) if (engine.mapTexture(map) !== texture) texture.destroy()
    baker?.dispose()
    if (bakeRun === run) bakeRun = null
    if (useApp.getState().bakeJob?.status === 'running') setJob(null)
  }
}

/** Stops a running bake; the maps keep the samples taken so far. */
export function stopBake(): void {
  if (bakeRun) bakeRun.stop = true
}
