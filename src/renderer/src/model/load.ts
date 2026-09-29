// Parses glTF/GLB, FBX and OBJ files with the three.js loaders (runs in the model worker, so no
// DOM). Textures are never decoded here: the app decodes the one it opens itself, exactly, like any
// other image. The loaders only get a stand-in that remembers where each texture comes from.

import { Loader, LoadingManager, Texture, type Material, type Object3D } from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { modelFormat } from '@shared/model'
import { flattenScene } from './flatten'
import type { ModelData, TextureRef } from './model'
import { parseMtl, type MtlMaterial } from './mtl'

export interface ModelSource {
  name: string
  bytes: Uint8Array
  /** Files the model refers to (glTF buffers, OBJ material libraries), by the name it uses. */
  resources: Record<string, Uint8Array>
}

/** Stand-in texture loader: records the texture's URL instead of loading it. */
class TextureSourceLoader extends Loader<Texture> {
  override load(url: string, onLoad?: (texture: Texture) => void): Texture {
    const texture = new Texture()
    texture.userData.source = /^(blob|data):/.test(url) ? url : `${this.path ?? ''}${url}`
    onLoad?.(texture)
    return texture
  }
}

const stem = (name: string): string => (name.split(/[\\/]/).pop() ?? name).replace(/\.[^.]+$/, '')

const EXTENSION_OF_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/tga': 'tga',
  'image/x-tga': 'tga'
}

async function bytesOfUrl(url: string): Promise<{ bytes: Uint8Array; type: string }> {
  const response = await fetch(url)
  const blob = await response.blob()
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type }
}

/** A texture's stand-in source as a reference: embedded bytes (blob/data URLs) or a file name. */
async function refOfSource(source: string | undefined, fallbackName: string): Promise<TextureRef | null> {
  if (!source) return null
  if (/^(blob|data):/.test(source)) {
    try {
      const { bytes, type } = await bytesOfUrl(source)
      return { kind: 'embedded', name: `${fallbackName}.${EXTENSION_OF_MIME[type] ?? 'png'}`, bytes }
    } catch {
      return null
    }
  }
  return { kind: 'file', reference: source }
}

function manager(resources: Record<string, Uint8Array>): { manager: LoadingManager; release(): void } {
  const urls = new Map<string, string>()
  for (const [name, bytes] of Object.entries(resources)) urls.set(name, URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>])))
  const m = new LoadingManager()
  m.setURLModifier((url) => urls.get(url) ?? urls.get(decodeURIComponent(url)) ?? url)
  // Every texture, whatever its type, goes to the stand-in (the real loaders need a DOM).
  m.addHandler(/[\s\S]*/, new TextureSourceLoader(m))
  return { manager: m, release: () => urls.forEach((u) => URL.revokeObjectURL(u)) }
}

const arrayBufferOf = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer

async function loadGltf(source: ModelSource, m: LoadingManager): Promise<ModelData> {
  const gltf = await new Promise<GLTF>((resolve, reject) => new GLTFLoader(m).parse(arrayBufferOf(source.bytes), '', resolve, reject))
  const { parser } = gltf
  const json = parser.json as {
    textures?: { source?: number; extensions?: Record<string, { source?: number }> }[]
    images?: { uri?: string; bufferView?: number; mimeType?: string; name?: string }[]
  }
  // Resolve every material's base color texture up front (bufferView images need async reads).
  const refs = new Map<Material, TextureRef | null>()
  const materials = new Set<Material>()
  gltf.scene.traverse((o) => {
    const material = (o as Object3D & { material?: Material | Material[] }).material
    for (const mt of [material ?? []].flat()) materials.add(mt)
  })
  for (const material of materials) {
    const map = (material as Material & { map?: Texture | null }).map
    const index = map ? (parser.associations.get(map) as { textures?: number } | undefined)?.textures : undefined
    const texture = index !== undefined ? json.textures?.[index] : undefined
    const imageIndex = texture?.source ?? Object.values(texture?.extensions ?? {}).find((e) => e.source !== undefined)?.source
    const image = imageIndex !== undefined ? json.images?.[imageIndex] : undefined
    let ref: TextureRef | null = null
    const name = image?.name || `${stem(source.name)}_${material.name || 'texture'}`
    if (image?.bufferView !== undefined) {
      const buffer = (await parser.getDependency('bufferView', image.bufferView)) as ArrayBuffer
      ref = { kind: 'embedded', name: `${stem(name)}.${EXTENSION_OF_MIME[image.mimeType ?? ''] ?? 'png'}`, bytes: new Uint8Array(buffer.slice(0)) }
    } else if (image?.uri) {
      ref = image.uri.startsWith('data:') ? await refOfSource(image.uri, stem(name)) : { kind: 'file', reference: image.uri }
    }
    refs.set(material, ref)
  }
  return flattenScene(gltf.scene, { name: source.name, format: 'gltf', flipV: false, textureOf: (mt) => refs.get(mt) ?? null })
}

async function loadFbx(source: ModelSource, m: LoadingManager): Promise<ModelData> {
  const scene = new FBXLoader(m).parse(arrayBufferOf(source.bytes), '')
  const refs = new Map<Material, TextureRef | null>()
  scene.traverse((o) => {
    const material = (o as Object3D & { material?: Material | Material[] }).material
    for (const mt of [material ?? []].flat()) refs.set(mt, null)
  })
  for (const material of refs.keys()) {
    const map = (material as Material & { map?: Texture | null }).map
    refs.set(material, await refOfSource(map?.userData.source as string | undefined, `${stem(source.name)}_${material.name || 'texture'}`))
  }
  return flattenScene(scene, { name: source.name, format: 'fbx', flipV: true, textureOf: (mt) => refs.get(mt) ?? null })
}

function loadObj(source: ModelSource): ModelData {
  const text = new TextDecoder().decode(source.bytes)
  const scene = new OBJLoader().parse(text)
  const library = new Map<string, MtlMaterial>()
  for (const [name, bytes] of Object.entries(source.resources)) {
    if (/\.mtl$/i.test(name)) for (const [k, v] of parseMtl(new TextDecoder().decode(bytes))) library.set(k, v)
  }
  // OBJLoader makes plain materials named after `usemtl`; take color and texture from the library.
  scene.traverse((o) => {
    const material = (o as Object3D & { material?: Material | Material[] }).material
    for (const mt of [material ?? []].flat()) {
      const color = library.get(mt.name)?.color
      const c = (mt as Material & { color?: { setRGB(r: number, g: number, b: number, space: string): void } }).color
      if (color && c) c.setRGB(color[0], color[1], color[2], 'srgb')
    }
  })
  return flattenScene(scene, {
    name: source.name,
    format: 'obj',
    flipV: true,
    textureOf: (mt) => {
      const map = library.get(mt.name)?.map
      return map ? { kind: 'file', reference: map } : null
    }
  })
}

export async function parseModel(source: ModelSource): Promise<ModelData> {
  const format = modelFormat(source.name)
  if (!format) throw new Error(`${source.name} isn’t a model file this app can open (glTF, GLB, FBX or OBJ).`)
  const { manager: m, release } = manager(source.resources)
  try {
    if (format === 'gltf') return await loadGltf(source, m)
    if (format === 'fbx') return await loadFbx(source, m)
    return loadObj(source)
  } finally {
    release()
  }
}
