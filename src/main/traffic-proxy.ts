import {
  createServer,
  request as requestHttp,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from 'node:http'
import { request as requestHttps } from 'node:https'
import { connect as connectTcp, isIP, type Socket } from 'node:net'
import { connect as connectTls, type TLSSocket } from 'node:tls'
import type { AppConfig, DomainRule, ProxyProfile } from '../shared/types'
import type { TrafficMonitor, TrafficTracker } from './traffic-monitor'

const CONNECT_TIMEOUT_MS = 12_000
const MAX_PROXY_RESPONSE_HEADERS = 64 * 1024

type RelaySocket = Socket | TLSSocket
type ByteBuffer = Buffer<ArrayBufferLike>

interface ProxyRoute {
  rule: DomainRule
  proxy: ProxyProfile
}

interface Authority {
  host: string
  port: number
}

function cleanHost(host: string): string {
  const value = host.trim().toLowerCase().replace(/\.$/, '')
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value
}

function authorityText(host: string, port: number): string {
  return `${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}`
}

function parseAuthority(value: string, defaultPort: number): Authority | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('[')) {
    const closing = trimmed.indexOf(']')
    if (closing < 0) return null
    const host = cleanHost(trimmed.slice(0, closing + 1))
    const suffix = trimmed.slice(closing + 1)
    const port = suffix.startsWith(':') ? Number(suffix.slice(1)) : defaultPort
    return host && Number.isInteger(port) && port > 0 && port <= 65535 ? { host, port } : null
  }
  const separator = trimmed.lastIndexOf(':')
  const hasSingleColon = separator > 0 && trimmed.indexOf(':') === separator
  const host = cleanHost(hasSingleColon ? trimmed.slice(0, separator) : trimmed)
  const port = hasSingleColon ? Number(trimmed.slice(separator + 1)) : defaultPort
  return host && Number.isInteger(port) && port > 0 && port <= 65535 ? { host, port } : null
}

function findRoute(config: AppConfig, domain: string): ProxyRoute | null {
  const normalized = cleanHost(domain)
  const rule = config.rules.find(
    (item) =>
      item.enabled &&
      (normalized === item.domain || (item.matchSubdomains && normalized.endsWith(`.${item.domain}`)))
  )
  if (!rule) return null
  const proxy = config.proxies.find((item) => item.id === rule.proxyId)
  return proxy ? { rule, proxy } : null
}

function openTcp(host: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connectTcp({ host, port, allowHalfOpen: true })
    const fail = (error: Error): void => {
      socket.destroy()
      reject(error)
    }
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => fail(new Error('连接上游代理超时')))
    socket.once('error', fail)
    socket.once('connect', () => {
      socket.off('error', fail)
      socket.setTimeout(0)
      socket.setKeepAlive(true, 30_000)
      socket.setNoDelay(true)
      resolve(socket)
    })
  })
}

async function openTls(host: string, port: number): Promise<TLSSocket> {
  const transport = await openTcp(host, port)
  return new Promise((resolve, reject) => {
    const socket = connectTls({
      socket: transport,
      servername: isIP(host) ? undefined : host,
      rejectUnauthorized: true
    })
    const fail = (error: Error): void => {
      socket.destroy()
      reject(error)
    }
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => fail(new Error('连接 HTTPS 上游代理超时')))
    socket.once('error', fail)
    socket.once('secureConnect', () => {
      socket.off('error', fail)
      socket.setTimeout(0)
      socket.setKeepAlive(true, 30_000)
      socket.setNoDelay(true)
      resolve(socket)
    })
  })
}

async function readAtLeast(
  socket: RelaySocket,
  size: number,
  initial: ByteBuffer = Buffer.alloc(0)
): Promise<ByteBuffer> {
  if (initial.length >= size) return initial
  return new Promise((resolve, reject) => {
    let buffer: ByteBuffer = initial
    const timer = setTimeout(() => finish(new Error('上游代理响应超时')), CONNECT_TIMEOUT_MS)
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.length > MAX_PROXY_RESPONSE_HEADERS) finish(new Error('上游代理响应过大'))
      else if (buffer.length >= size) finish(null)
    }
    const onError = (error: Error): void => finish(error)
    const onClose = (): void => finish(new Error('上游代理提前关闭连接'))
    const finish = (error: Error | null): void => {
      clearTimeout(timer)
      socket.off('data', onData)
      socket.off('error', onError)
      socket.off('close', onClose)
      if (error) reject(error)
      else resolve(buffer)
    }
    socket.on('data', onData)
    socket.once('error', onError)
    socket.once('close', onClose)
  })
}

async function readHeaders(socket: RelaySocket): Promise<{ headers: string; remainder: ByteBuffer }> {
  let buffer: ByteBuffer = Buffer.alloc(0)
  while (true) {
    buffer = await readAtLeast(socket, buffer.length + 1, buffer)
    const boundary = buffer.indexOf('\r\n\r\n')
    if (boundary >= 0) {
      return {
        headers: buffer.subarray(0, boundary + 4).toString('latin1'),
        remainder: buffer.subarray(boundary + 4)
      }
    }
  }
}

async function openHttpProxyTunnel(proxy: ProxyProfile, target: Authority): Promise<{ socket: RelaySocket; head: ByteBuffer }> {
  const proxyHost = cleanHost(proxy.host)
  const socket = proxy.protocol === 'HTTPS' ? await openTls(proxyHost, proxy.port) : await openTcp(proxyHost, proxy.port)
  try {
    const authority = authorityText(target.host, target.port)
    socket.write(
      `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\nProxy-Connection: Keep-Alive\r\nUser-Agent: Domain-Relay/0.5.2\r\n\r\n`
    )
    const { headers, remainder } = await readHeaders(socket)
    const status = Number(headers.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/i)?.[1])
    if (status >= 200 && status < 300) return { socket, head: remainder }
    if (status === 407) throw new Error('上游代理要求身份认证')
    throw new Error(Number.isFinite(status) ? `上游 CONNECT 返回 HTTP ${status}` : '无法识别上游代理响应')
  } catch (error) {
    socket.destroy()
    throw error
  }
}

function socksAddress(target: Authority): ByteBuffer {
  if (isIP(target.host) === 4) {
    return Buffer.from([1, ...target.host.split('.').map(Number)])
  }
  const domain = Buffer.from(target.host)
  if (domain.length > 255) throw new Error('目标域名过长')
  return Buffer.concat([Buffer.from([3, domain.length]), domain])
}

async function openSocksProxyTunnel(proxy: ProxyProfile, target: Authority): Promise<{ socket: Socket; head: ByteBuffer }> {
  const socket = await openTcp(cleanHost(proxy.host), proxy.port)
  try {
    socket.write(Buffer.from([5, 1, 0]))
    let buffer = await readAtLeast(socket, 2)
    if (buffer[0] !== 5) throw new Error('SOCKS5 协议版本无效')
    if (buffer[1] === 2) throw new Error('SOCKS5 上游代理要求身份认证')
    if (buffer[1] !== 0) throw new Error('SOCKS5 上游代理不支持免认证连接')
    buffer = buffer.subarray(2)

    const port = Buffer.from([target.port >> 8, target.port & 0xff])
    socket.write(Buffer.concat([Buffer.from([5, 1, 0]), socksAddress(target), port]))
    buffer = await readAtLeast(socket, 4, buffer)
    if (buffer[0] !== 5) throw new Error('SOCKS5 CONNECT 响应无效')
    if (buffer[1] !== 0) throw new Error(`SOCKS5 CONNECT 失败，代码 ${buffer[1]}`)
    const addressType = buffer[3]
    let responseLength = 0
    if (addressType === 1) responseLength = 4 + 4 + 2
    else if (addressType === 4) responseLength = 4 + 16 + 2
    else if (addressType === 3) {
      buffer = await readAtLeast(socket, 5, buffer)
      responseLength = 4 + 1 + buffer[4] + 2
    } else throw new Error('SOCKS5 CONNECT 地址类型无效')
    buffer = await readAtLeast(socket, responseLength, buffer)
    return { socket, head: buffer.subarray(responseLength) }
  } catch (error) {
    socket.destroy()
    throw error
  }
}

async function openProxyTunnel(proxy: ProxyProfile, target: Authority): Promise<{ socket: RelaySocket; head: ByteBuffer }> {
  return proxy.protocol === 'SOCKS5'
    ? openSocksProxyTunnel(proxy, target)
    : openHttpProxyTunnel(proxy, target)
}

async function openDirectTunnel(target: Authority): Promise<{ socket: Socket; head: ByteBuffer }> {
  return { socket: await openTcp(target.host, target.port), head: Buffer.alloc(0) }
}

function requestTarget(request: IncomingMessage): { target: Authority; absoluteUrl: string; originPath: string } | null {
  try {
    if (request.url?.startsWith('http://')) {
      const url = new URL(request.url)
      return {
        target: { host: cleanHost(url.hostname), port: Number(url.port) || 80 },
        absoluteUrl: url.toString(),
        originPath: `${url.pathname}${url.search}` || '/'
      }
    }
    const authority = parseAuthority(request.headers.host ?? '', 80)
    if (!authority) return null
    const path = request.url?.startsWith('/') ? request.url : `/${request.url ?? ''}`
    return {
      target: authority,
      absoluteUrl: `http://${authorityText(authority.host, authority.port)}${path}`,
      originPath: path
    }
  } catch {
    return null
  }
}

function writeProxyError(response: ServerResponse, message: string): void {
  if (response.headersSent) {
    response.destroy()
    return
  }
  response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' })
  response.end(`Domain Relay：${message}`)
}

export class TrafficProxyServer {
  private server: Server | null = null
  private activePort: number | null = null
  private readonly sockets = new Set<Socket>()

  constructor(
    private readonly getConfig: () => AppConfig,
    private readonly monitor: TrafficMonitor
  ) {}

  isRunning(port?: number): boolean {
    return Boolean(this.server && (port === undefined || this.activePort === port))
  }

  getPort(): number | null {
    return this.activePort
  }

  async start(port: number): Promise<void> {
    if (this.isRunning(port)) return
    await this.stop()
    const server = createServer((request, response) => void this.handleHttpRequest(request, response))
    server.requestTimeout = 0
    server.timeout = 0
    server.on('connect', (request, clientSocket, head) => {
      void this.handleConnect(request, clientSocket as Socket, head)
    })
    server.on('connection', (socket) => {
      socket.allowHalfOpen = true
      this.sockets.add(socket)
      socket.once('close', () => this.sockets.delete(socket))
    })

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error)
      server.once('error', onError)
      server.listen(port, '127.0.0.1', () => {
        server.off('error', onError)
        resolve()
      })
    })
    const address = server.address()
    this.server = server
    this.activePort = typeof address === 'object' && address ? address.port : port
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    this.activePort = null
    if (!server) return
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private async handleConnect(request: IncomingMessage, clientSocket: Socket, clientHead: ByteBuffer): Promise<void> {
    const target = parseAuthority(request.url ?? '', 443)
    if (!target) {
      clientSocket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
      return
    }
    clientSocket.setKeepAlive(true, 30_000)
    clientSocket.setNoDelay(true)
    const route = findRoute(this.getConfig(), target.host)
    const tracker = route ? this.monitor.startSession(target.host, route.rule, route.proxy) : null
    let established = false
    try {
      const upstream = route ? await openProxyTunnel(route.proxy, target) : await openDirectTunnel(target)
      if (clientSocket.destroyed) {
        upstream.socket.destroy()
        tracker?.finish('客户端已关闭连接')
        return
      }
      established = true
      clientSocket.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: Domain Relay\r\n\r\n')
      if (clientHead.length > 0) {
        tracker?.addUpload(clientHead.length)
        upstream.socket.write(clientHead)
      }
      if (upstream.head.length > 0) {
        tracker?.addDownload(upstream.head.length)
        clientSocket.write(upstream.head)
      }
      clientSocket.on('data', (chunk: Buffer) => tracker?.addUpload(chunk.length))
      upstream.socket.on('data', (chunk: Buffer) => tracker?.addDownload(chunk.length))
      clientSocket.once('close', () => tracker?.finish())
      upstream.socket.once('close', () => tracker?.finish())
      clientSocket.once('error', (error) => {
        tracker?.finish(`客户端连接错误：${error.message}`)
        upstream.socket.destroy()
      })
      upstream.socket.once('error', (error) => {
        tracker?.finish(error)
        clientSocket.destroy()
      })
      clientSocket.pipe(upstream.socket)
      upstream.socket.pipe(clientSocket)
    } catch (error) {
      tracker?.finish(error instanceof Error ? error : String(error))
      if (!established && !clientSocket.destroyed) {
        clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
      }
    }
  }

  private async handleHttpRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const parsed = requestTarget(request)
    if (!parsed) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Domain Relay：无法识别目标地址')
      return
    }
    const route = findRoute(this.getConfig(), parsed.target.host)
    if (!route) {
      this.forwardHttpDirect(request, response, parsed.target, parsed.originPath)
      return
    }
    const tracker = this.monitor.startSession(parsed.target.host, route.rule, route.proxy)
    if (route.proxy.protocol === 'SOCKS5') {
      await this.forwardHttpThroughSocks(request, response, parsed.target, parsed.originPath, route.proxy, tracker)
    } else {
      this.forwardHttpThroughHttpProxy(request, response, parsed.absoluteUrl, route.proxy, tracker)
    }
  }

  private forwardHttpDirect(
    request: IncomingMessage,
    response: ServerResponse,
    target: Authority,
    originPath: string
  ): void {
    const headers: IncomingHttpHeaders = { ...request.headers, connection: 'close' }
    delete headers['proxy-connection']
    const upstreamRequest = requestHttp({
      host: target.host,
      port: target.port,
      method: request.method,
      path: originPath,
      headers,
      agent: false
    })
    upstreamRequest.on('response', (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.statusMessage, upstreamResponse.headers)
      upstreamResponse.pipe(response)
    })
    upstreamRequest.once('error', (error) => writeProxyError(response, `DIRECT 连接失败：${error.message}`))
    request.once('aborted', () => upstreamRequest.destroy())
    request.pipe(upstreamRequest)
  }

  private forwardHttpThroughHttpProxy(
    request: IncomingMessage,
    response: ServerResponse,
    absoluteUrl: string,
    proxy: ProxyProfile,
    tracker: TrafficTracker
  ): void {
    const headers: IncomingHttpHeaders = { ...request.headers, connection: 'close' }
    delete headers['proxy-connection']
    const options = {
      host: cleanHost(proxy.host),
      port: proxy.port,
      method: request.method,
      path: absoluteUrl,
      headers,
      agent: false
    }
    const upstreamRequest = proxy.protocol === 'HTTPS'
      ? requestHttps({ ...options, rejectUnauthorized: true })
      : requestHttp(options)
    upstreamRequest.on('response', (upstreamResponse) => {
      let ended = false
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.statusMessage, upstreamResponse.headers)
      upstreamResponse.on('data', (chunk: Buffer) => tracker.addDownload(chunk.length))
      upstreamResponse.once('end', () => {
        ended = true
        tracker.finish()
      })
      upstreamResponse.once('error', (error) => tracker.finish(error))
      upstreamResponse.once('aborted', () => tracker.finish('上游响应提前中断'))
      upstreamResponse.once('close', () => tracker.finish(ended ? null : '上游响应提前关闭'))
      upstreamResponse.pipe(response)
    })
    upstreamRequest.once('error', (error) => {
      tracker.finish(error)
      writeProxyError(response, error.message)
    })
    request.on('data', (chunk: Buffer) => tracker.addUpload(chunk.length))
    request.once('aborted', () => {
      tracker.finish('客户端请求提前中断')
      upstreamRequest.destroy()
    })
    request.pipe(upstreamRequest)
  }

  private async forwardHttpThroughSocks(
    request: IncomingMessage,
    response: ServerResponse,
    target: Authority,
    originPath: string,
    proxy: ProxyProfile,
    tracker: TrafficTracker
  ): Promise<void> {
    try {
      const { socket, head } = await openSocksProxyTunnel(proxy, target)
      if (head.length > 0) socket.unshift(head)
      const headers: IncomingHttpHeaders = { ...request.headers, connection: 'close' }
      delete headers['proxy-connection']
      const upstreamRequest = requestHttp({
        host: target.host,
        port: target.port,
        method: request.method,
        path: originPath,
        headers,
        agent: false,
        createConnection: () => socket
      })
      upstreamRequest.on('response', (upstreamResponse) => {
        let ended = false
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.statusMessage, upstreamResponse.headers)
        upstreamResponse.on('data', (chunk: Buffer) => tracker.addDownload(chunk.length))
        upstreamResponse.once('end', () => {
          ended = true
          tracker.finish()
        })
        upstreamResponse.once('error', (error) => tracker.finish(error))
        upstreamResponse.once('aborted', () => tracker.finish('上游响应提前中断'))
        upstreamResponse.once('close', () => tracker.finish(ended ? null : '上游响应提前关闭'))
        upstreamResponse.pipe(response)
      })
      upstreamRequest.once('error', (error) => {
        tracker.finish(error)
        writeProxyError(response, error.message)
      })
      request.on('data', (chunk: Buffer) => tracker.addUpload(chunk.length))
      request.once('aborted', () => {
        tracker.finish('客户端请求提前中断')
        upstreamRequest.destroy()
      })
      request.pipe(upstreamRequest)
    } catch (error) {
      tracker.finish(error instanceof Error ? error : String(error))
      writeProxyError(response, error instanceof Error ? error.message : String(error))
    }
  }
}
