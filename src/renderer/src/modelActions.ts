// Connects the UI to 3D models: opening one (with the files it refers to and its base color
// texture) and choosing the texture set shown with the open texture.

import { modelFormat } from '@shared/model'
import { clearMaps, loadImageFile } from '@/actions'
import { getEngine } from '@/engine'
import { loadModelAsync } from '@/model/modelAsync'
import type { ModelData, TextureRef } from '@/model/model'
import { objMaterialLibraries } from '@/model/mtl'
import { useApp, type ModelInfo } from '@/store'
import { showPanel } from '@/workspace/workspace'

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

async function readResources(name: string, bytes: Uint8Array, path: string | undefined): Promise<{ resources: Record<string, Uint8Array>; missing: string[] }> {
  const resources: Record<string, Uint8Array> = {}
  const missing: string[] = []
  for (const ref of resourceNames(name, bytes)) {
    const file = path ? await window.fx.readModelFile(path, ref).catch(() => null) : null
    if (file) resources[ref] = file.bytes
    else missing.push(ref)
  }
  return { resources, missing }
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

function summary(model: ModelData, path: string | undefined): Omit<ModelInfo, 'version'> {
  return {
    name: model.name,
    path,
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
 */
export async function loadModelFile(name: string, bytes: Uint8Array, path?: string): Promise<void> {
  const engine = getEngine()
  const app = useApp.getState()
  if (!engine) return
  const job = ++loading
  app.setMessage({ kind: 'info', text: `Loading ${name}…` })
  try {
    const { resources, missing } = await readResources(name, bytes, path)
    const { model, bvh } = await loadModelAsync({ name, bytes, resources })
    if (job !== loading) return
    if (missing.length) model.warnings.push(`Missing files: ${missing.join(', ')}.`)
    engine.setModel(model, bvh)
    clearMaps({ onlyBaked: true })

    // The open texture may already be this model's; else open the first texture it has.
    const open = useApp.getState().image?.name
    let material = open ? materialOfTexture(model, open) : -1
    let opened: string | null = null
    let failed: string | null = null
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
    useApp.getState().setModel(summary(model, path), material)
    showPanel('view3d')

    const tris = `${(model.indices.length / 3).toLocaleString('en-US')} triangles`
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
