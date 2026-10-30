// Blender link: textures painted in Blender arrive through main's link server (the add-on sends a
// layer image, or the material channel it baked), open as texture tabs bound to their link id,
// and their processed output goes back after every run of their stack, so Blender's viewport
// shows the 4FXELIZER result while painting. Settings › Blender link turns the server on.

import { useSyncExternalStore } from 'react'
import type { LinkMessage, LinkState } from '@shared/blenderLink'
import { thumbnail } from './actions'
import { getEngine, type Engine } from './engine'
import { rgbaBitmap } from './image/decode'
import { savedSettings, saveSettings } from './settings'
import { docFor } from './stack/textures'
import { newId, useApp } from './store'

let state: LinkState = { status: 'off', port: 0, clients: [] }
const listeners = new Set<() => void>()

function setState(next: LinkState): void {
  state = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useLinkState(): LinkState {
  return useSyncExternalStore(subscribe, () => state)
}

/** Turns the link server on or off. */
export function toggleBlenderLink(): void {
  const link = savedSettings().blenderLink
  saveSettings({ blenderLink: { ...link, enabled: !link.enabled } })
}

export async function saveBlenderAddon(): Promise<void> {
  const path = await window.fx.saveBlenderAddon()
  if (path) useApp.getState().setMessage({ kind: 'info', text: `Saved the Blender add-on to ${path}. In Blender: Edit › Preferences › Add-ons › Install from Disk.` })
}

/** A linked texture: the connection it came from and what was last sent back. */
interface Link {
  client: string
  /** Output key last sent (see ChainPlan.outputKey). */
  sent: string | null
  sending: boolean
  /** The output changed while sending: send again after. */
  again: boolean
}

const links = new Map<string, Link>()

const THUMBNAIL = 96

const textureOfLink = (linkId: string): string | null => useApp.getState().textures.find((t) => t.link === linkId)?.id ?? null

/** Pixels from Blender: updates the texture bound to the link (the stack, maps and view stay), or opens it. */
async function receiveTexture(client: string, message: Extract<LinkMessage, { type: 'texture' }>, payload: Uint8Array<ArrayBuffer>): Promise<void> {
  const engine = getEngine()
  if (!engine) return
  const bitmap = await rgbaBitmap(message.width, message.height, payload)
  const app = useApp.getState()
  const image = { name: message.name, width: message.width, height: message.height }
  let id = textureOfLink(message.id)
  if (id) {
    engine.loadBitmap(bitmap, id)
    app.setImage(image, { keepView: true, textureId: id })
    app.updateTexture(id, { thumbnail: thumbnail(bitmap, THUMBNAIL) })
  } else {
    id = newId('tex')
    engine.loadBitmap(bitmap, id)
    app.addTexture({ id, image, thumbnail: thumbnail(bitmap, THUMBNAIL), link: message.id })
    app.setMessage({ kind: 'info', text: `Linked ${message.name} from Blender` })
  }
  bitmap.close()
  const link = links.get(message.id)
  if (link) link.client = client
  else links.set(message.id, { client, sent: null, sending: false, again: false })
  processNow(id)
}

/**
 * Runs a linked texture's stack right away. The viewer's frame loop does this too, but it stops
 * while the window is hidden (behind Blender), and the result must reach Blender then as well.
 */
function processNow(textureId: string): void {
  const engine = getEngine()
  const s = useApp.getState()
  const t = s.textures.find((x) => x.id === textureId)
  if (!engine || !t) return
  const mapChannels = Object.fromEntries(Object.entries(t.maps).map(([slot, map]) => [slot, map.channel]))
  try {
    if (textureId === s.activeTextureId) {
      // What the viewer would run, so a previewed stage or mask stays on screen.
      engine.process({ stages: s.stages, palettes: s.palettes, outputLock: s.outputLock, previewUid: s.previewUid, maskUid: s.maskUid, mapChannels })
    } else engine.processTexture(textureId, { ...docFor(s.docs, textureId), previewUid: null, mapChannels })
  } catch (e) {
    s.setMessage({ kind: 'error', text: `Processing ${t.image.name} failed: ${(e as Error).message}` })
  }
}

/** Sends a linked texture's output to Blender when it differs from what was sent last. */
async function sendOutput(textureId: string): Promise<void> {
  const engine = getEngine()
  const linkId = useApp.getState().textures.find((t) => t.id === textureId)?.link
  const link = linkId ? links.get(linkId) : undefined
  if (!engine || !linkId || !link) return
  const key = engine.planOf(textureId).plan?.outputKey ?? null
  if (!key || key === link.sent) return
  if (link.sending) {
    link.again = true
    return
  }
  link.sending = true
  try {
    const rgba = await engine.readOutput(textureId)
    window.fx.sendLinkMessage(link.client, { type: 'output', id: linkId, width: rgba.width, height: rgba.height }, rgba.data)
    link.sent = key
  } catch (e) {
    console.warn('Blender link: could not send the output:', e)
  } finally {
    link.sending = false
    if (link.again) {
      link.again = false
      void sendOutput(textureId)
    }
  }
}

function unlink(linkId: string): void {
  links.delete(linkId)
  const id = textureOfLink(linkId)
  if (!id) return
  useApp.getState().updateTexture(id, { link: undefined })
  const name = useApp.getState().textures.find((t) => t.id === id)?.image.name
  useApp.getState().setMessage({ kind: 'info', text: `Blender unlinked ${name}` })
}

/** Follows the link server, opens what Blender sends and sends results back. */
export function startBlenderLink(engine: Engine): () => void {
  // One texture message at a time, in order.
  let queue = Promise.resolve()
  const offMessage = window.fx.onLinkMessage((client, message, payload) => {
    if (message.type === 'texture') queue = queue.then(() => receiveTexture(client, message, payload)).catch((e) => console.warn('Blender link:', e))
    else if (message.type === 'unlink') queue = queue.then(() => unlink(message.id))
  })
  const offState = window.fx.onLinkState((next) => {
    // Links of connections that closed wait for Blender to connect again (it sends them anew).
    const connected = new Set(next.clients.map((c) => c.id))
    for (const [id, link] of links) if (!connected.has(link.client)) links.delete(id)
    const before = state.clients.length
    setState(next)
    if (next.clients.length > before) useApp.getState().setMessage({ kind: 'info', text: `${next.clients.at(-1)!.app} connected` })
  })
  void window.fx.getLinkState().then(setState)
  const offPlan = engine.onPlan((_plan, _sourceKey, textureId) => void sendOutput(textureId))
  // Stack edits run in the viewer's frame loop, which is paused while the window is hidden.
  const offStore = useApp.subscribe((s, prev) => {
    if (!document.hidden || !links.size || (s.docs === prev.docs && s.textures === prev.textures)) return
    for (const t of s.textures) if (t.link && links.has(t.link)) processNow(t.id)
  })
  return () => {
    offMessage()
    offState()
    offPlan()
    offStore()
  }
}
