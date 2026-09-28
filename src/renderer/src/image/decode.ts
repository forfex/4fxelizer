import { decodeTga } from './tga'

// Keep stored pixel values exactly: no ICC/gamma conversion, no premultiplication.
const BITMAP_OPTIONS: ImageBitmapOptions = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }

export async function decodeImage(name: string, bytes: Uint8Array): Promise<ImageBitmap> {
  if (/\.tga$/i.test(name)) {
    const { width, height, data } = decodeTga(bytes)
    return createImageBitmap(new ImageData(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width, height), BITMAP_OPTIONS)
  }
  try {
    return await createImageBitmap(new Blob([bytes as BlobPart]), BITMAP_OPTIONS)
  } catch {
    throw new Error(`Couldn't read "${name}". Supported: PNG, JPG, WebP, BMP, GIF, TGA.`)
  }
}
