import { describe, expect, it } from 'vitest'
import { encodeLinkFrame, LinkFrameReader, LinkProtocolError, normalizeLinkSettings, parseLinkMessage, DEFAULT_LINK_PORT } from './blenderLink'

const texture = { type: 'texture', id: 'img:Base', name: 'Base', width: 2, height: 1 } as const
const pixels = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])

describe('link frames', () => {
  it('round-trips a frame', () => {
    const frames = new LinkFrameReader().push(encodeLinkFrame(texture, pixels))
    expect(frames).toHaveLength(1)
    expect(frames[0]!.message).toEqual(texture)
    expect([...frames[0]!.payload]).toEqual([...pixels])
  })

  it('reads frames split anywhere and several in one chunk', () => {
    const bytes = new Uint8Array([
      ...encodeLinkFrame({ type: 'hello', protocol: 1, app: 'Blender 5.2.1' }),
      ...encodeLinkFrame(texture, pixels),
      ...encodeLinkFrame({ type: 'unlink', id: 'img:Base' })
    ])
    for (const step of [1, 3, 7, 13, bytes.length]) {
      const reader = new LinkFrameReader()
      const types: string[] = []
      for (let i = 0; i < bytes.length; i += step) types.push(...reader.push(bytes.slice(i, i + step)).map((f) => f.message.type))
      expect(types).toEqual(['hello', 'texture', 'unlink'])
    }
  })

  it('rejects data that is not a link connection', () => {
    expect(() => new LinkFrameReader().push(new TextEncoder().encode('GET / HTTP/1.1\r\n'))).toThrow(LinkProtocolError)
  })

  it('rejects pixels that do not match the size', () => {
    expect(() => new LinkFrameReader().push(encodeLinkFrame(texture, pixels.subarray(4)))).toThrow(LinkProtocolError)
    expect(() => new LinkFrameReader().push(encodeLinkFrame({ type: 'unlink', id: 'x' }, pixels))).toThrow(LinkProtocolError)
  })
})

describe('parseLinkMessage', () => {
  it('drops unknown fields and checks the rest', () => {
    expect(parseLinkMessage('{"type":"hello","protocol":1,"app":"Blender","extra":1}', 0)).toEqual({ type: 'hello', protocol: 1, app: 'Blender' })
    expect(() => parseLinkMessage('{"type":"texture","id":"","name":"a","width":1,"height":1}', 4)).toThrow(LinkProtocolError)
    expect(() => parseLinkMessage('{"type":"texture","id":"a","name":"a","width":0,"height":1}', 0)).toThrow(LinkProtocolError)
    expect(() => parseLinkMessage('{"type":"output","id":"a","width":99999,"height":1}', 99999 * 4)).toThrow(LinkProtocolError)
    expect(() => parseLinkMessage('{"type":"nope"}', 0)).toThrow(LinkProtocolError)
    expect(() => parseLinkMessage('nope', 0)).toThrow(LinkProtocolError)
  })
})

describe('normalizeLinkSettings', () => {
  it('fills defaults and keeps the port in range', () => {
    expect(normalizeLinkSettings(undefined)).toEqual({ enabled: false, port: DEFAULT_LINK_PORT })
    expect(normalizeLinkSettings({ enabled: true, port: 50000 })).toEqual({ enabled: true, port: 50000 })
    expect(normalizeLinkSettings({ enabled: 'yes', port: 80 })).toEqual({ enabled: false, port: DEFAULT_LINK_PORT })
  })
})
