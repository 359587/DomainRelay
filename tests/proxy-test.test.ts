import { createServer, type Server } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { testProxyConnection } from '../src/main/proxy-test'
import type { ProxyProfile } from '../src/shared/types'

const servers: Server[] = []

async function listen(server: Server): Promise<number> {
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port')
  return address.port
}

function proxy(port: number, protocol: ProxyProfile['protocol']): ProxyProfile {
  return { id: `${protocol}-${port}`, name: `${protocol} test`, protocol, host: '127.0.0.1', port }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

describe('proxy connection test', () => {
  it('verifies an HTTP CONNECT tunnel', async () => {
    const port = await listen(
      createServer((socket) => {
        socket.once('data', (data) => {
          expect(data.toString()).toContain('CONNECT test.example:443 HTTP/1.1')
          socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        })
      })
    )

    const result = await testProxyConnection(proxy(port, 'HTTP'), {
      targetHost: 'test.example',
      timeoutMs: 1_000
    })
    expect(result.status).toBe('ok')
  })

  it('reports proxy authentication requirements', async () => {
    const port = await listen(
      createServer((socket) => {
        socket.once('data', () => socket.write('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'))
      })
    )

    const result = await testProxyConnection(proxy(port, 'HTTP'), { timeoutMs: 1_000 })
    expect(result.status).toBe('auth-required')
  })

  it('performs the SOCKS5 greeting and CONNECT request', async () => {
    const port = await listen(
      createServer((socket) => {
        let stage = 0
        socket.on('data', (data) => {
          if (stage === 0) {
            expect([...data]).toEqual([5, 1, 0])
            stage = 1
            socket.write(Buffer.from([5, 0]))
          } else {
            expect(data[0]).toBe(5)
            expect(data[1]).toBe(1)
            socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 80]))
          }
        })
      })
    )

    const result = await testProxyConnection(proxy(port, 'SOCKS5'), {
      targetHost: 'test.example',
      timeoutMs: 1_000
    })
    expect(result.status).toBe('ok')
  })
})
