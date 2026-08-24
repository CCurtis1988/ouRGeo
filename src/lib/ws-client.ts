type MessageHandler = (type: string, text: string, data?: unknown) => void
type StatusHandler = (connected: boolean) => void

class WSClient {
  private ws: WebSocket | null = null
  private _port: number | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private messageHandlers: Set<MessageHandler> = new Set()
  private statusHandlers: Set<StatusHandler> = new Set()
  private shouldReconnect = true

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  connect(port: number): void {
    // Close any existing connection first
    if (this.ws) {
      this.ws.onclose = null // prevent reconnect from old close handler
      this.ws.close()
      this.ws = null
    }
    if (this.pingTimer) clearInterval(this.pingTimer)
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this._port = port
    this.shouldReconnect = true
    this._connect()
  }

  private _connect(): void {
    if (!this._port) return

    const url = `ws://127.0.0.1:${this._port}/console`

    try {
      this.ws = new WebSocket(url)

      this.ws.onopen = () => {
        console.log('[WSClient] Connected to R console')
        this.notifyStatus(true)
        // Clear reconnect timer
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer)
          this.reconnectTimer = null
        }
        // Send ping to keep alive
        this.startPing()
      }

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type: string
            text: string
            data?: unknown
          }
          this.messageHandlers.forEach((h) => h(msg.type, msg.text ?? '', msg.data))
        } catch {
          // Raw text fallback
          this.messageHandlers.forEach((h) => h('stdout', event.data as string))
        }
      }

      this.ws.onerror = (err) => {
        console.error('[WSClient] WebSocket error:', err)
      }

      this.ws.onclose = () => {
        console.log('[WSClient] Disconnected')
        this.notifyStatus(false)
        this.scheduleReconnect()
      }
    } catch (err) {
      console.error('[WSClient] Failed to create WebSocket:', err)
      this.scheduleReconnect()
    }
  }

  private pingTimer: ReturnType<typeof setInterval> | null = null

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send('ping')
      }
    }, 30_000)
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return
    if (this.reconnectTimer) return

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this._connect()
    }, 2000)
  }

  disconnect(): void {
    this.shouldReconnect = false
    if (this.pingTimer) clearInterval(this.pingTimer)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
    this.ws = null
    this.messageHandlers.clear()
    this.statusHandlers.clear()
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler)
    return () => this.messageHandlers.delete(handler)
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler)
    return () => this.statusHandlers.delete(handler)
  }

  private notifyStatus(connected: boolean): void {
    this.statusHandlers.forEach((h) => h(connected))
  }
}

export const wsClient = new WSClient()
