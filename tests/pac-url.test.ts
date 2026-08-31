import { describe, expect, it } from 'vitest'
import type { AppConfig } from '../src/shared/types'
import { buildPacUrl, isPacUrlForConfig, pacRevision } from '../src/main/pac-url'

const config: AppConfig = {
  version: 4,
  networkServices: ['Wi-Fi'],
  pacPort: 47653,
  relayPort: 47654,
  proxies: [{ id: 'proxy', name: 'Proxy', protocol: 'HTTP', host: '127.0.0.1', port: 8080 }],
  rules: [{ id: 'rule', domain: 'example.com', proxyId: 'proxy', enabled: true, matchSubdomains: true }],
  applications: []
}

describe('PAC revision URLs', () => {
  it('changes the PAC URL when an enabled domain is added', () => {
    const next = {
      ...config,
      rules: [
        ...config.rules,
        { id: 'rule-2', domain: 'openai.com', proxyId: 'proxy', enabled: true, matchSubdomains: true }
      ]
    } satisfies AppConfig

    expect(pacRevision(next)).not.toBe(pacRevision(config))
    expect(buildPacUrl(next)).not.toBe(buildPacUrl(config))
    expect(isPacUrlForConfig(buildPacUrl(next), next)).toBe(true)
    expect(isPacUrlForConfig(buildPacUrl(config), next)).toBe(false)
  })

  it('keeps legacy non-revision PAC URLs valid for active installations', () => {
    expect(isPacUrlForConfig('http://127.0.0.1:47653/proxy.pac', config)).toBe(true)
  })

  it('does not change the PAC URL for upstream proxy details handled by the live relay', () => {
    const next = {
      ...config,
      proxies: [{ ...config.proxies[0]!, host: 'proxy.example.com', port: 3128 }]
    } satisfies AppConfig

    expect(buildPacUrl(next)).toBe(buildPacUrl(config))
  })
})
