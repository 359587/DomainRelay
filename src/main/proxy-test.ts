import { isIP } from 'node:net'
import { connect as connectTcp, type Socket } from 'node:net'
import { connect as connectTls, type TLSSocket } from 'node:tls'
import type { ProxyProfile, ProxyTestResult } from '../shared/types'

export interface ProxyTestOptions {
  targetHost?: string
  targetPort?: number
  timeoutMs?: number
}

const DEFAULT_TARGET_HOST = 'www.apple.com'
const DEFAULT_TARGET_PORT = 443
const DEFAULT_TIMEOUT = 8_000

function cleanHost(host: string): string {
  const value = host.trim()
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value
}

function assertProxy(proxy: ProxyProfile): void {
  if (!proxy.id || !proxy.name.trim()) throw new Error('代理名称不能为空')
  if (!proxy.host.trim() || proxy.host.includes('://') || /\s/.test(proxy.host)) throw new Error('代理服务器地址无效')
  if (!Number.isInteger(proxy.port) || proxy.port < 1 || proxy.port > 65535) throw new Error('代理端口无效')
  if (!['HTTP', 'HTTPS', 'SOCKS5'].includes(proxy.protocol)) throw new Error('代理协议无效')
}

function openTcp(host: string, port: number, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connectTcp({ host, port })
    const fail = (error: Error): void => {
      socket.destroy()
      reject(error)
    }
    socket.setTimeout(timeoutMs, () => fail(new Error('连接超时')))
    socket.once('error', fail)
    socket.once('connect', () => {
      socket.off('error', fail)
      socket.setTimeout(0)
      resolve(socket)
    })
  })
}

function openTls(host: string, port: number, timeoutMs: number): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = connectTls({
      host,
      port,
      servername: isIP(host) ? undefined : host,
      rejectUnauthorized: true
    })
    const fail = (error: Error): void => {
      socket.destroy()
      reject(error)
    }
    socket.setTimeout(timeoutMs, () => fail(new Error('TLS 连接超时')))
    socket.once('error', fail)
    socket.once('secureConnect', () => {
      socket.off('error', fail)
      socket.setTimeout(0)
      resolve(socket)
    })
  })
}

function readHttpHeaders(socket: Socket | TLSSocket, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0)
    const timer = setTimeout(() => finish(new Error('代理响应超时')), timeoutMs)
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.length > 32 * 1024) finish(new Error('代理响应头过大'))
      else if (buffer.includes('\r\n\r\n')) finish(null, buffer.toString('latin1'))
    }
    const onError = (error: Error): void => finish(error)
    const onClose = (): void => finish(new Error('代理提前关闭连接'))
    const finish = (error: Error | null, value?: string): void => {
      clearTimeout(timer)
      socket.off('data', onData)
      socket.off('error', onError)
      socket.off('close', onClose)
      if (error) reject(error)
      else resolve(value!)
    }
    socket.on('data', onData)
    socket.once('error', onError)
    socket.once('close', onClose)
  })
}

async function testHttpProxy(
  proxy: ProxyProfile,
  targetHost: string,
  targetPort: number,
  timeoutMs: number
): Promise<'ok' | 'auth-required'> {
  const host = cleanHost(proxy.host)
  const socket = proxy.protocol === 'HTTPS' ? await openTls(host, proxy.port, timeoutMs) : await openTcp(host, proxy.port, timeoutMs)
  try {
    socket.write(
      `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\nProxy-Connection: close\r\nUser-Agent: Domain-Relay/0.2\r\n\r\n`
    )
    const headers = await readHttpHeaders(socket, timeoutMs)
    const status = Number(headers.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/i)?.[1])
    if (status >= 200 && status < 300) return 'ok'
    if (status === 407) return 'auth-required'
    throw new Error(Number.isFinite(status) ? `CONNECT 返回 HTTP ${status}` : '无法识别代理响应')
  } finally {
    socket.destroy()
  }
}

function testSocksProxy(
  proxy: ProxyProfile,
  targetHost: string,
  targetPort: number,
  timeoutMs: number
): Promise<'ok' | 'auth-required'> {
  return new Promise((resolve, reject) => {
    let socket: Socket | null = null
    let buffer = Buffer.alloc(0)
    let stage: 'greeting' | 'connect' = 'greeting'
    let settled = false
    const timer = setTimeout(() => finish(new Error('SOCKS5 响应超时')), timeoutMs)

    const finish = (error: Error | null, result?: 'ok' | 'auth-required'): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket?.destroy()
      if (error) reject(error)
      else resolve(result!)
    }

    void openTcp(cleanHost(proxy.host), proxy.port, timeoutMs)
      .then((connected) => {
        socket = connected
        connected.on('error', (error) => finish(error))
        connected.on('close', () => {
          if (stage !== 'connect' || buffer.length < 4) finish(new Error('SOCKS5 代理提前关闭连接'))
        })
        connected.on('data', (chunk) => {
          const data = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
          buffer = Buffer.concat([buffer, data])
          if (stage === 'greeting' && buffer.length >= 2) {
            const version = buffer[0]
            const method = buffer[1]
            buffer = buffer.subarray(2)
            if (version !== 5) return finish(new Error('SOCKS5 协议版本不正确'))
            if (method === 2) return finish(null, 'auth-required')
            if (method !== 0) return finish(new Error('SOCKS5 代理不支持免认证连接'))
            const domain = Buffer.from(targetHost)
            if (domain.length > 255) return finish(new Error('测试域名过长'))
            const port = Buffer.from([targetPort >> 8, targetPort & 0xff])
            connected.write(Buffer.concat([Buffer.from([5, 1, 0, 3, domain.length]), domain, port]))
            stage = 'connect'
          }
          if (stage === 'connect' && buffer.length >= 4) {
            if (buffer[0] !== 5) return finish(new Error('SOCKS5 CONNECT 响应无效'))
            if (buffer[1] !== 0) return finish(new Error(`SOCKS5 CONNECT 失败，代码 ${buffer[1]}`))
            finish(null, 'ok')
          }
        })
        connected.write(Buffer.from([5, 1, 0]))
      })
      .catch((error) => finish(error instanceof Error ? error : new Error(String(error))))
  })
}

export async function testProxyConnection(
  proxy: ProxyProfile,
  options: ProxyTestOptions = {}
): Promise<ProxyTestResult> {
  const startedAt = performance.now()
  try {
    assertProxy(proxy)
    const targetHost = options.targetHost ?? DEFAULT_TARGET_HOST
    const targetPort = options.targetPort ?? DEFAULT_TARGET_PORT
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT
    const status =
      proxy.protocol === 'SOCKS5'
        ? await testSocksProxy(proxy, targetHost, targetPort, timeoutMs)
        : await testHttpProxy(proxy, targetHost, targetPort, timeoutMs)
    const latencyMs = Math.max(1, Math.round(performance.now() - startedAt))
    return {
      proxyId: proxy.id,
      status,
      latencyMs,
      message: status === 'ok' ? `已建立到 ${targetHost}:${targetPort} 的代理隧道` : '代理可连接，但要求身份认证',
      testedAt: new Date().toISOString()
    }
  } catch (error) {
    return {
      proxyId: proxy.id,
      status: 'failed',
      latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
      message: error instanceof Error ? error.message : String(error),
      testedAt: new Date().toISOString()
    }
  }
}
