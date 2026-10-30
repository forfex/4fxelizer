// Blender link: Blender (through the add-on in blender/4fxelizer_link.py) sends the textures being
// painted there to 4FXELIZER over a local TCP connection, and gets the processed result back for
// its viewport. Main runs the server (src/main/blenderLink.ts); the renderer opens, updates and
// processes the textures (renderer/src/blenderLink.ts). Keep the add-on in sync with this file.
//
// A frame is the magic "FXL1", the header length and the payload length (u32, little endian), the
// header (UTF-8 JSON, one LinkMessage) and the payload (raw RGBA8 pixels, rows top to bottom,
// straight alpha; empty for messages without pixels).

export const LINK_PROTOCOL = 1
export const DEFAULT_LINK_PORT = 47811
const MAGIC = [0x46, 0x58, 0x4c, 0x31] // "FXL1"
const PREFIX = 12
/** Largest header accepted (a header is a few hundred bytes). */
export const MAX_LINK_HEADER = 64 * 1024
/** Largest texture side accepted (8192² RGBA8 = 256 MB). */
export const MAX_LINK_SIDE = 8192

export type LinkMessage =
  /** First message both ways: who is on the other end. */
  | { type: 'hello'; protocol: number; app: string; version?: string; file?: string }
  /** Blender → app: a texture's pixels (payload) under a link id that stays the same while it's linked. */
  | { type: 'texture'; id: string; name: string; width: number; height: number }
  /** App → Blender: the processed texture (payload) for a link id. */
  | { type: 'output'; id: string; width: number; height: number }
  /** Blender → app: the link was removed there. */
  | { type: 'unlink'; id: string }

export interface LinkFrame {
  message: LinkMessage
  payload: Uint8Array
}

export class LinkProtocolError extends Error {}

/** Link ids and names: short, printable. */
const isText = (v: unknown, max = 256): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f]/.test(v)
const isSide = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= MAX_LINK_SIDE

/** The message in a frame header, checked; throws when it isn't one or its payload doesn't fit it. */
export function parseLinkMessage(json: string, payloadLength: number): LinkMessage {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new LinkProtocolError('The header is not JSON.')
  }
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const pixels = (): { width: number; height: number } => {
    if (!isSide(r.width) || !isSide(r.height)) throw new LinkProtocolError('Invalid texture size.')
    if (payloadLength !== r.width * r.height * 4) throw new LinkProtocolError('The pixels don\'t match the texture size.')
    return { width: r.width, height: r.height }
  }
  const noPixels = (): void => {
    if (payloadLength !== 0) throw new LinkProtocolError(`A ${String(r.type)} message has no pixels.`)
  }
  switch (r.type) {
    case 'hello': {
      noPixels()
      if (typeof r.protocol !== 'number' || !isText(r.app, 64)) throw new LinkProtocolError('Invalid hello.')
      return {
        type: 'hello',
        protocol: r.protocol,
        app: r.app,
        ...(isText(r.version, 64) ? { version: r.version } : {}),
        ...(isText(r.file, 512) ? { file: r.file } : {})
      }
    }
    case 'texture':
      if (!isText(r.id) || !isText(r.name)) throw new LinkProtocolError('Invalid texture.')
      return { type: 'texture', id: r.id, name: r.name, ...pixels() }
    case 'output':
      if (!isText(r.id)) throw new LinkProtocolError('Invalid output.')
      return { type: 'output', id: r.id, ...pixels() }
    case 'unlink':
      noPixels()
      if (!isText(r.id)) throw new LinkProtocolError('Invalid unlink.')
      return { type: 'unlink', id: r.id }
    default:
      throw new LinkProtocolError(`Unknown message "${String(r.type)}".`)
  }
}

/** One frame, ready to write to the socket. */
export function encodeLinkFrame(message: LinkMessage, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  const header = new TextEncoder().encode(JSON.stringify(message))
  const out = new Uint8Array(PREFIX + header.length + payload.length)
  out.set(MAGIC, 0)
  const view = new DataView(out.buffer)
  view.setUint32(4, header.length, true)
  view.setUint32(8, payload.length, true)
  out.set(header, PREFIX)
  out.set(payload, PREFIX + header.length)
  return out
}

/** Collects socket data and returns the frames it completes. Throws LinkProtocolError on bad data (drop the connection then). */
export class LinkFrameReader {
  private chunks: Uint8Array[] = []
  private size = 0

  push(chunk: Uint8Array): LinkFrame[] {
    this.chunks.push(chunk)
    this.size += chunk.length
    const frames: LinkFrame[] = []
    for (;;) {
      if (this.size < PREFIX) break
      const prefix = this.peek(PREFIX)
      if (MAGIC.some((b, i) => prefix[i] !== b)) throw new LinkProtocolError('Not a 4FXELIZER link connection.')
      const view = new DataView(prefix.buffer, prefix.byteOffset, PREFIX)
      const headerLength = view.getUint32(4, true)
      const payloadLength = view.getUint32(8, true)
      if (headerLength === 0 || headerLength > MAX_LINK_HEADER) throw new LinkProtocolError('Invalid header length.')
      if (payloadLength > MAX_LINK_SIDE * MAX_LINK_SIDE * 4) throw new LinkProtocolError('The texture is too large.')
      if (this.size < PREFIX + headerLength + payloadLength) break
      const frame = this.take(PREFIX + headerLength + payloadLength)
      const json = new TextDecoder().decode(frame.subarray(PREFIX, PREFIX + headerLength))
      frames.push({ message: parseLinkMessage(json, payloadLength), payload: frame.subarray(PREFIX + headerLength) })
    }
    return frames
  }

  /** The first `n` bytes, joining chunks only as far as needed. */
  private peek(n: number): Uint8Array {
    return this.chunks[0]!.length >= n ? this.chunks[0]! : this.join()
  }

  private join(): Uint8Array {
    if (this.chunks.length === 1) return this.chunks[0]!
    const all = new Uint8Array(this.size)
    let at = 0
    for (const c of this.chunks) {
      all.set(c, at)
      at += c.length
    }
    this.chunks = [all]
    return all
  }

  private take(n: number): Uint8Array {
    const all = this.join()
    const frame = all.subarray(0, n)
    const rest = all.subarray(n)
    this.chunks = rest.length ? [rest] : []
    this.size = rest.length
    return frame
  }
}

/** Main → renderer: the server's state and who is connected. */
export interface LinkState {
  status: 'off' | 'listening' | 'error'
  port: number
  /** Why the server couldn't start (port taken, …). */
  error?: string
  clients: LinkClient[]
}

export interface LinkClient {
  /** Connection id (new for every connection). */
  id: string
  /** "Blender 5.2.1", from its hello. */
  app: string
  /** The .blend file open there, when saved. */
  file?: string
}

/** Link settings (UserSettings.blenderLink). */
export interface LinkSettings {
  enabled: boolean
  port: number
}

export const DEFAULT_LINK_SETTINGS: LinkSettings = { enabled: false, port: DEFAULT_LINK_PORT }

export function normalizeLinkSettings(raw: unknown): LinkSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const port = typeof r.port === 'number' && Number.isInteger(r.port) && r.port >= 1024 && r.port <= 65535 ? r.port : DEFAULT_LINK_PORT
  return { enabled: r.enabled === true, port }
}
