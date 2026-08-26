import { mkdtemp, rm } from 'node:fs/promises'
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import { connect as connectTcp, createServer as createTcpServer, type Server as TcpServer, type Socket } from 'node:net'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppConfig } from '../src/shared/types'
import { TrafficHistoryStore, TrafficMonitor } from '../src/main/traffic-monitor'
import { TrafficProxyServer } from '../src/main/traffic-proxy'

function listen(server: HttpServer | TcpServer): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      if (!address || typeof address === 'string') reject(new Error('测试服务器端口无效'))
      else resolve(address.port)
    })
  })
}

function close(server: HttpServer | TcpServer): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

function readUntil(socket: Socket, marker: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let value = ''
    const onData = (chunk: Buffer): void => {
      value += chunk.toString('utf8')
      if (value.includes(marker)) finish(null)
    }
    const onError = (error: Error): void => finish(error)
    const finish = (error: Error | null): void => {
      socket.off('data', onData)
      socket.off('error', onError)
      if (error) reject(error)
      else resolve(value)
    }
    socket.on('data', onData)
    socket.once('error', onError)
  })
}

describe('local metered traffic proxy', () => {
  const cleanups: Array<() => Promise<void>> = []

  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!()
  })

  it('forwards CONNECT through an HTTP upstream and records domain traffic', async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), 'domain-relay-traffic-'))
    cleanups.push(() => rm(tempDirectory, { recursive: true, force: true }))

    const target = createTcpServer((socket) => {
      socket.on('data', (chunk) =>
        socket.write(Buffer.concat([Buffer.from('echo:'), typeof chunk === 'string' ? Buffer.from(chunk) : chunk]))
      )
    })
    const targetPort = await listen(target)
    cleanups.push(() => close(target))

    const upstream = createHttpServer()
    upstream.on('connect', (request, client, head) => {
      const [host, portText] = (request.url ?? '').split(':')
      const targetSocket = connectTcp({ host, port: Number(portText) }, () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length > 0) targetSocket.write(head)
        client.pipe(targetSocket)
        targetSocket.pipe(client)
      })
      targetSocket.once('error', () => client.destroy())
    })
    const upstreamPort = await listen(upstream)
    cleanups.push(() => close(upstream))

    const config: AppConfig = {
      version: 4,
      networkServices: ['Wi-Fi'],
      pacPort: 47653,
      relayPort: 47654,
      proxies: [{ id: 'proxy', name: '测试上游', protocol: 'HTTP', host: '127.0.0.1', port: upstreamPort }],
      rules: [{ id: 'rule', domain: '127.0.0.1', proxyId: 'proxy', enabled: true, matchSubdomains: false }],
      applications: []
    }
    const historyStore = new TrafficHistoryStore(tempDirectory)
    await historyStore.load()
    const monitor = new TrafficMonitor(historyStore)
    const relay = new TrafficProxyServer(() => config, monitor)
    await relay.start(0)
    cleanups.push(async () => {
      await relay.stop()
      monitor.dispose()
      await historyStore.clear()
    })

    const client = connectTcp({ host: '127.0.0.1', port: relay.getPort()! })
    client.write(`CONNECT 127.0.0.1:${targetPort} HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\n\r\n`)
    expect(await readUntil(client, '\r\n\r\n')).toContain('200 Connection Established')
    client.write('hello')
    expect(await readUntil(client, 'echo:hello')).toContain('echo:hello')
    client.destroy()
    await new Promise((resolve) => setTimeout(resolve, 25))

    const history = monitor.getHistory('all')
    expect(history.connections).toBe(1)
    expect(history.domains[0]).toMatchObject({
      domain: '127.0.0.1',
      proxyName: '测试上游',
      connections: 1
    })
    expect(history.uploadBytes).toBeGreaterThanOrEqual(5)
    expect(history.downloadBytes).toBeGreaterThanOrEqual(10)
  })

  it('forwards CONNECT through a SOCKS5 upstream', async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), 'domain-relay-socks-'))
    cleanups.push(() => rm(tempDirectory, { recursive: true, force: true }))

    const target = createTcpServer((socket) => socket.on('data', (chunk) => socket.write(chunk)))
    const targetPort = await listen(target)
    cleanups.push(() => close(target))

    const socks = createTcpServer((client) => {
      let stage: 'greeting' | 'connect' | 'tunnel' = 'greeting'
      client.on('data', (chunk) => {
        const data = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
        if (stage === 'greeting') {
          stage = 'connect'
          client.write(Buffer.from([5, 0]))
          return
        }
        if (stage !== 'connect') return
        expect([...data.subarray(0, 4)]).toEqual([5, 1, 0, 1])
        const port = data.readUInt16BE(8)
        const targetSocket = connectTcp({ host: '127.0.0.1', port }, () => {
          stage = 'tunnel'
          client.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]))
          client.pipe(targetSocket)
          targetSocket.pipe(client)
        })
        targetSocket.once('error', () => client.destroy())
      })
    })
    const socksPort = await listen(socks)
    cleanups.push(() => close(socks))

    const config: AppConfig = {
      version: 4,
      networkServices: ['Wi-Fi'],
      pacPort: 47653,
      relayPort: 47654,
      proxies: [{ id: 'socks', name: 'SOCKS 出口', protocol: 'SOCKS5', host: '127.0.0.1', port: socksPort }],
      rules: [{ id: 'rule', domain: '127.0.0.1', proxyId: 'socks', enabled: true, matchSubdomains: false }],
      applications: []
    }
    const historyStore = new TrafficHistoryStore(tempDirectory)
    await historyStore.load()
    const monitor = new TrafficMonitor(historyStore)
    const relay = new TrafficProxyServer(() => config, monitor)
    await relay.start(0)
    cleanups.push(async () => {
      await relay.stop()
      monitor.dispose()
      await historyStore.clear()
    })

    const client = connectTcp({ host: '127.0.0.1', port: relay.getPort()! })
    client.write(`CONNECT 127.0.0.1:${targetPort} HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\n\r\n`)
    expect(await readUntil(client, '\r\n\r\n')).toContain('200 Connection Established')
    client.write('through-socks')
    expect(await readUntil(client, 'through-socks')).toContain('through-socks')
    client.destroy()
    await new Promise((resolve) => setTimeout(resolve, 25))

    expect(monitor.getHistory('all')).toMatchObject({ connections: 1 })
  })

  it('connects unmatched domains directly without recording them as proxy traffic', async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), 'domain-relay-direct-'))
    cleanups.push(() => rm(tempDirectory, { recursive: true, force: true }))

    const target = createTcpServer((socket) =>
      socket.on('data', (chunk) =>
        socket.write(Buffer.concat([Buffer.from('direct:'), typeof chunk === 'string' ? Buffer.from(chunk) : chunk]))
      )
    )
    const targetPort = await listen(target)
    cleanups.push(() => close(target))

    const config: AppConfig = {
      version: 4,
      networkServices: ['Wi-Fi'],
      pacPort: 47653,
      relayPort: 47654,
      proxies: [{ id: 'proxy', name: '未使用代理', protocol: 'HTTP', host: '127.0.0.1', port: 9 }],
      rules: [],
      applications: []
    }
    const historyStore = new TrafficHistoryStore(tempDirectory)
    await historyStore.load()
    const monitor = new TrafficMonitor(historyStore)
    const relay = new TrafficProxyServer(() => config, monitor)
    await relay.start(0)
    cleanups.push(async () => {
      await relay.stop()
      monitor.dispose()
      await historyStore.clear()
    })

    const client = connectTcp({ host: '127.0.0.1', port: relay.getPort()! })
    client.write(`CONNECT 127.0.0.1:${targetPort} HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\n\r\n`)
    expect(await readUntil(client, '\r\n\r\n')).toContain('200 Connection Established')
    client.write('hello')
    expect(await readUntil(client, 'direct:hello')).toContain('direct:hello')
    client.destroy()
    await new Promise((resolve) => setTimeout(resolve, 25))

    expect(monitor.getHistory('all')).toMatchObject({ connections: 0, uploadBytes: 0, downloadBytes: 0 })
  })

  it('preserves a delayed response after the client half-closes a CONNECT tunnel', async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), 'domain-relay-half-open-'))
    cleanups.push(() => rm(tempDirectory, { recursive: true, force: true }))

    const target = createTcpServer({ allowHalfOpen: true }, (socket) => {
      const chunks: Buffer[] = []
      socket.on('data', (chunk) => chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk))
      socket.on('end', () => setTimeout(() => socket.end(Buffer.concat([Buffer.from('after-fin:'), ...chunks])), 30))
    })
    const targetPort = await listen(target)
    cleanups.push(() => close(target))

    const upstream = createHttpServer()
    upstream.on('connection', (socket) => {
      socket.allowHalfOpen = true
    })
    upstream.on('connect', (request, client, head) => {
      client.allowHalfOpen = true
      const [host, portText] = (request.url ?? '').split(':')
      const targetSocket = connectTcp({ host, port: Number(portText), allowHalfOpen: true }, () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length > 0) targetSocket.write(head)
        client.pipe(targetSocket)
        targetSocket.pipe(client)
      })
      targetSocket.once('error', () => client.destroy())
    })
    const upstreamPort = await listen(upstream)
    cleanups.push(() => close(upstream))

    const config: AppConfig = {
      version: 4,
      networkServices: ['Wi-Fi'],
      pacPort: 47653,
      relayPort: 47654,
      proxies: [{ id: 'proxy', name: '半关闭测试代理', protocol: 'HTTP', host: '127.0.0.1', port: upstreamPort }],
      rules: [{ id: 'rule', domain: '127.0.0.1', proxyId: 'proxy', enabled: true, matchSubdomains: false }],
      applications: []
    }
    const historyStore = new TrafficHistoryStore(tempDirectory)
    await historyStore.load()
    const monitor = new TrafficMonitor(historyStore)
    const relay = new TrafficProxyServer(() => config, monitor)
    await relay.start(0)
    cleanups.push(async () => {
      await relay.stop()
      monitor.dispose()
      await historyStore.clear()
    })

    const client = connectTcp({ host: '127.0.0.1', port: relay.getPort()!, allowHalfOpen: true })
    client.write(`CONNECT 127.0.0.1:${targetPort} HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\n\r\n`)
    expect(await readUntil(client, '\r\n\r\n')).toContain('200 Connection Established')
    client.end('request-body')
    expect(await readUntil(client, 'after-fin:request-body')).toContain('after-fin:request-body')
    client.destroy()
    await new Promise((resolve) => setTimeout(resolve, 25))

    expect(monitor.getHistory('all').sessions[0]).toMatchObject({
      status: 'completed',
      outcome: 'responded'
    })
  })
})
