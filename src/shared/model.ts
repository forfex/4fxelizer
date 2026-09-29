// 3D model files: which extensions open as models, and where to look for the files a model refers
// to (glTF buffers, OBJ material libraries, textures). Shared by main (reading those files) and the
// renderer (routing opened or dropped files).

export const MODEL_EXTENSIONS = ['glb', 'gltf', 'fbx', 'obj'] as const
export type ModelFormat = 'gltf' | 'fbx' | 'obj'

/** Files a model may pull in next to it: glTF buffers, OBJ material libraries, textures. */
export const MODEL_RESOURCE_EXTENSIONS = ['bin', 'mtl', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tga']

const extensionOf = (name: string): string => /\.([^./\\]+)$/.exec(name)?.[1]?.toLowerCase() ?? ''

export function isModelFile(fileName: string): boolean {
  return (MODEL_EXTENSIONS as readonly string[]).includes(extensionOf(fileName))
}

export function modelFormat(fileName: string): ModelFormat | null {
  const ext = extensionOf(fileName)
  if (ext === 'glb' || ext === 'gltf') return 'gltf'
  if (ext === 'fbx' || ext === 'obj') return ext
  return null
}

export function isModelResource(fileName: string): boolean {
  return MODEL_RESOURCE_EXTENSIONS.includes(extensionOf(fileName))
}

/** Folders next to a model where exporters commonly put textures. */
const TEXTURE_DIRS = ['textures', 'Textures', 'texture', 'tex', 'images', 'maps', '../textures', '../Textures']

/**
 * Paths to try, in order, for a file a model refers to: as written (relative to the model's folder,
 * or absolute), then by file name in the model's folder and common texture folders. Models often
 * keep the absolute path of the machine they were made on, so the name alone is the usual fallback.
 * Returns '/'-separated paths; relative ones are relative to the model's folder.
 */
export function referenceCandidates(reference: string): string[] {
  let ref = reference.trim().replace(/^file:\/\/\/?/i, '')
  try {
    ref = decodeURIComponent(ref)
  } catch {
    // Not URI-encoded: use it as written.
  }
  ref = ref.replace(/\\/g, '/')
  if (!ref || /^(data|blob|https?):/i.test(ref)) return []
  // "file:///C:/x" leaves "C:/x"; "file:///home/x" leaves "home/x", which is absolute again below.
  if (/^file:/i.test(reference.trim()) && !/^[a-z]:\//i.test(ref)) ref = `/${ref}`
  const name = ref.split('/').pop()!
  const out = [ref, name, ...TEXTURE_DIRS.map((d) => `${d}/${name}`)]
  return [...new Set(out)]
}
