// Blender link server: listens on 127.0.0.1 only (Settings › Blender link), greets each Blender
// add-on that connects and passes its messages to the renderer, which answers with processed
// textures. The frame format is in @shared/blenderLink.

import { createServer, type Server, type Socket } from 'node:net'
import { encodeLinkFrame, LinkFrameReader, LINK_PROTOCOL, type LinkClient, type LinkMessage, type LinkSettings, type LinkState } from '@shared/blenderLink'

/** Output frames waiting for a slow Blender beyond this are dropped (a newer one follows). */
const MAX_QUEUED_BYTES = 256 * 1024 * 1024

interface Connection {
  socket: Socket
  reader: LinkFrameReader
  /** Set by its hello; nothing else is accepted before. */
  client: LinkClient | null
}

export class LinkServer {
  private server: Server | null = null
  private settings: LinkSettings | null = null
  private status: LinkState['status'] = 'off'
  private error: string | undefined
  private readonly connections = new Map<string, Connection>()
  private nextId = 1

  constructor(
    private readonly version: string,
    private readonly onState: (state: LinkState) => void,
    private readonly onMessage: (client: string, message: LinkMessage, payload: Uint8Array) => void
  ) {}

  state(): LinkState {
    const clients = [...this.connections.values()].flatMap((c) => (c.client ? [c.client] : []))
    return { status: this.status, port: this.settings?.port ?? 0, ...(this.error ? { error: this.error } : {}), clients }
  }

  /** Starts, stops or moves the server to follow the settings. */
  configure(settings: LinkSettings): void {
    const same = this.settings && this.settings.enabled === settings.enabled && this.settings.port === settings.port
    this.settings = settings
    if (same && this.status !== 'error') return
    this.stop()
    if (settings.enabled) this.start(settings.port)
    else this.setStatus('off')
  }

  send(clientId: string, message: LinkMessage, payload?: Uint8Array): void {
    const socket = this.connections.get(clientId)?.socket
    if (!socket || socket.destroyed || socket.writableLength > MAX_QUEUED_BYTES) return
    socket.write(encodeLinkFrame(message, payload))
  }

  dispose(): void {
    this.stop()
  }

  private start(port: number): void {
    const server = createServer((socket) => this.accept(socket))
    this.server = server
    server.on('error', (e: NodeJS.ErrnoException) => {
      if (this.server !== server) return
      this.stop()
      this.setStatus('error', e.code === 'EADDRINUSE' ? `Port ${port} is already in use. Pick another one.` : e.message)
    })
    server.listen(port, '127.0.0.1', () => {
      if (this.server === server) this.setStatus('listening')
    })
  }

  private stop(): void {
    for (const c of this.connections.values()) c.socket.destroy()
    this.connections.clear()
    this.server?.close()
    this.server = null
  }

  private setStatus(status: LinkState['status'], error?: string): void {
    this.status = status
    this.error = error
    this.onState(this.state())
  }

  private accept(socket: Socket): void {
    const id = `blender-${this.nextId++}`
    const connection: Connection = { socket, reader: new LinkFrameReader(), client: null }
    this.connections.set(id, connection)
    socket.setNoDelay(true)
    socket.on('data', (chunk: Buffer) => {
      try {
        for (const { message, payload } of connection.reader.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.length))) {
          this.receive(id, connection, message, payload)
        }
      } catch (e) {
        console.warn('Blender link: dropped a connection:', e instanceof Error ? e.message : e)
        socket.destroy()
      }
    })
    socket.on('error', () => socket.destroy())
    socket.on('close', () => {
      // Gone after stop() already: nothing to report.
      if (this.connections.get(id) !== connection) return
      this.connections.delete(id)
      if (connection.client) this.onState(this.state())
    })
  }

  private receive(id: string, connection: Connection, message: LinkMessage, payload: Uint8Array): void {
    if (message.type === 'hello') {
      connection.client = { id, app: message.app, ...(message.file ? { file: message.file } : {}) }
      this.send(id, { type: 'hello', protocol: LINK_PROTOCOL, app: '4FXELIZER', version: this.version })
      this.onState(this.state())
      return
    }
    if (!connection.client) throw new Error('Expected a hello first.')
    // The renderer gets its own copy: the chunk's buffer belongs to the socket.
    this.onMessage(id, message, payload.slice())
  }
}
