import { describe, expect, it } from 'vitest'
import { parseDefaultInterface, parseNetworkServiceOrder, planAutoProxyRestore } from '../src/main/network'

describe('macOS network service discovery', () => {
  it('maps network service names to their device identifiers', () => {
    const output = `An asterisk (*) denotes that a network service is disabled.
(1) Wi-Fi
(Hardware Port: Wi-Fi, Device: en0)

(2) AX88179B
(Hardware Port: AX88179B, Device: en11)`

    expect(parseNetworkServiceOrder(output)).toEqual([
      { name: 'Wi-Fi', device: 'en0' },
      { name: 'AX88179B', device: 'en11' }
    ])
  })

  it('reads the active default-route interface', () => {
    expect(parseDefaultInterface('   gateway: 172.16.0.1\n interface: en11\n')).toBe('en11')
    expect(parseDefaultInterface('route: writing to routing socket: not in table')).toBeNull()
  })

  it('does not request a privileged write when the original PAC state is already restored', () => {
    const original = [{
      service: 'Wi-Fi',
      enabled: false,
      url: null,
      capturedAt: '2026-08-26T00:00:00.000Z'
    }]

    expect(planAutoProxyRestore(original, original, 'http://127.0.0.1:47653/proxy.pac')).toEqual({
      targets: [],
      unchanged: ['Wi-Fi'],
      skipped: []
    })
  })

  it('restores only PAC settings still owned by Domain Relay', () => {
    const original = [
      { service: 'Wi-Fi', enabled: false, url: null, capturedAt: '2026-08-26T00:00:00.000Z' },
      { service: 'USB LAN', enabled: true, url: 'http://vpn.example/old.pac', capturedAt: '2026-08-26T00:00:00.000Z' }
    ]
    const current = [
      { service: 'Wi-Fi', enabled: true, url: 'http://127.0.0.1:47653/proxy.pac', capturedAt: '2026-08-26T01:00:00.000Z' },
      { service: 'USB LAN', enabled: true, url: 'http://other.example/new.pac', capturedAt: '2026-08-26T01:00:00.000Z' }
    ]

    expect(planAutoProxyRestore(original, current, 'http://127.0.0.1:47653/proxy.pac')).toEqual({
      targets: [{ service: 'Wi-Fi', enabled: false, url: null }],
      unchanged: [],
      skipped: ['USB LAN']
    })
  })

  it('restores either PAC revision while a hot update is in transition', () => {
    const original = [
      { service: 'Wi-Fi', enabled: false, url: null, capturedAt: '2026-08-26T00:00:00.000Z' },
      { service: 'USB LAN', enabled: false, url: null, capturedAt: '2026-08-26T00:00:00.000Z' }
    ]
    const current = [
      { service: 'Wi-Fi', enabled: true, url: 'http://127.0.0.1:47653/proxy.pac?revision=old', capturedAt: '2026-08-26T01:00:00.000Z' },
      { service: 'USB LAN', enabled: true, url: 'http://127.0.0.1:47653/proxy.pac?revision=new', capturedAt: '2026-08-26T01:00:00.000Z' }
    ]

    expect(planAutoProxyRestore(original, current, [
      'http://127.0.0.1:47653/proxy.pac?revision=old',
      'http://127.0.0.1:47653/proxy.pac?revision=new'
    ])).toEqual({
      targets: [
        { service: 'Wi-Fi', enabled: false, url: null },
        { service: 'USB LAN', enabled: false, url: null }
      ],
      unchanged: [],
      skipped: []
    })
  })
})
