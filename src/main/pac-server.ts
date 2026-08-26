import { createServer, type Server } from 'node:http'
import type { AppConfig } from '../shared/types'
import { generatePac } from './pac'

export class PacServer {
  private server: Server | null = null
  private activePort: number | null = null

  constructor(private readonly getConfig: () => AppConfig) {}

  isRunning(port?: number): boolean {
    return Boolean(this.server && (port === undefined || this.activePort === port))
  }

  async start(port: number): Promise<void> {
    if (this.isRunning(port)) return
    await this.stop()

    const server = createServer((request, response) => {
      const path = request.url?.split('?')[0]
      if (path === '/health') {
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
        response.end(JSON.stringify({ ok: true }))
        return
      }
      if (path !== '/proxy.pac') {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        response.end('Not found')
        return
      }

      try {
        const pac = generatePac(this.getConfig())
        response.writeHead(200, {
          'Content-Type': 'application/x-ns-proxy-autoconfig; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache'
        })
        response.end(pac)
      } catch (error) {
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        response.end(error instanceof Error ? error.message : 'PAC generation failed')
      }
    })

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error)
      server.once('error', onError)
      server.listen(port, '127.0.0.1', () => {
        server.off('error', onError)
        resolve()
      })
    })

    this.server = server
    this.activePort = port
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    this.activePort = null
    if (!server) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
