import { rgba16fRowsToRgba8 } from '@/image/half'
import type { RgbaImage } from '@/image/png'
import { WORK_FORMAT } from './pass'

/** Uploads a decoded image into a working-format texture, without premultiplying alpha. */
export function uploadBitmap(device: GPUDevice, bitmap: ImageBitmap, label = 'source'): GPUTexture {
  const max = device.limits.maxTextureDimension2D
  if (bitmap.width > max || bitmap.height > max) {
    throw new Error(`Image is ${bitmap.width}×${bitmap.height}; this GPU supports up to ${max}×${max}.`)
  }
  const texture = device.createTexture({
    label,
    size: [bitmap.width, bitmap.height],
    format: WORK_FORMAT,
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.RENDER_ATTACHMENT // required by copyExternalImageToTexture
  })
  device.queue.copyExternalImageToTexture(
    { source: bitmap },
    { texture, premultipliedAlpha: false },
    [bitmap.width, bitmap.height]
  )
  return texture
}

/** Reads a working-format texture back as straight 8-bit RGBA. */
export async function readTextureRgba8(device: GPUDevice, texture: GPUTexture): Promise<RgbaImage> {
  if (texture.format !== WORK_FORMAT) throw new Error(`readTextureRgba8: expected ${WORK_FORMAT}`)
  const { width, height } = texture
  const bytesPerRow = Math.ceil((width * 8) / 256) * 256
  const buffer = device.createBuffer({
    label: 'readback',
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
  })
  const encoder = device.createCommandEncoder({ label: 'readback' })
  encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [width, height])
  device.queue.submit([encoder.finish()])
  await buffer.mapAsync(GPUMapMode.READ)
  try {
    const halves = new Uint16Array(buffer.getMappedRange())
    return { width, height, data: rgba16fRowsToRgba8(halves, width, height, bytesPerRow) }
  } finally {
    buffer.unmap()
    buffer.destroy()
  }
}
