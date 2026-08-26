import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  ConfigStore,
  migrateLegacyConfig,
  type LegacyConfig,
  type LegacyConfigV2,
  type LegacyConfigV3
} from '../src/main/config-store'

describe('configuration migration', () => {
  it('migrates the single network service setting to a selected service list', () => {
    const legacy: LegacyConfig = {
      version: 1,
      networkService: 'Wi-Fi',
      pacPort: 47653,
      proxies: [{ id: 'proxy', name: 'Proxy', protocol: 'HTTP', host: '127.0.0.1', port: 8080 }],
      rules: []
    }

    expect(migrateLegacyConfig(legacy)).toEqual({
      version: 4,
      networkServices: ['Wi-Fi'],
      pacPort: 47653,
      relayPort: 47654,
      proxies: legacy.proxies,
      rules: [],
      applications: []
    })
  })

  it('preserves the old subdomain matching behavior when migrating v2 rules', () => {
    const legacy: LegacyConfigV2 = {
      version: 2,
      networkServices: ['Wi-Fi', 'USB LAN'],
      pacPort: 47653,
      proxies: [{ id: 'proxy', name: 'Proxy', protocol: 'HTTP', host: '127.0.0.1', port: 8080 }],
      rules: [{ id: 'rule', domain: 'docs.example.com', proxyId: 'proxy', enabled: true }]
    }

    expect(migrateLegacyConfig(legacy).rules[0]).toMatchObject({
      domain: 'docs.example.com',
      matchSubdomains: true
    })
  })

  it('adds the local traffic relay port while preserving v3 rule scopes', () => {
    const legacy: LegacyConfigV3 = {
      version: 3,
      networkServices: ['Wi-Fi'],
      pacPort: 47653,
      proxies: [{ id: 'proxy', name: 'Proxy', protocol: 'HTTP', host: '127.0.0.1', port: 8080 }],
      rules: [{
        id: 'rule',
        domain: 'api.example.com',
        proxyId: 'proxy',
        enabled: true,
        matchSubdomains: false
      }]
    }

    expect(migrateLegacyConfig(legacy)).toMatchObject({
      version: 4,
      relayPort: 47654,
      rules: [{ domain: 'api.example.com', matchSubdomains: false }]
    })
  })

  it('adds the application list when loading an existing v4 configuration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'domain-relay-config-v4-'))
    try {
      const filePath = join(directory, 'domain-relay.json')
      await writeFile(filePath, JSON.stringify({
        config: {
          version: 4,
          networkServices: ['Wi-Fi'],
          pacPort: 47653,
          relayPort: 47654,
          proxies: [{ id: 'proxy', name: 'Proxy', protocol: 'HTTP', host: '127.0.0.1', port: 8080 }],
          rules: []
        },
        activation: null
      }))
      const store = new ConfigStore(directory)
      await store.load()

      expect(store.getConfig().applications).toEqual([])
      const persisted = JSON.parse(await readFile(filePath, 'utf8')) as { config: { applications?: unknown[] } }
      expect(persisted.config.applications).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
