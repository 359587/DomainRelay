import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ActivationState, AppConfig } from '../shared/types'

export interface PersistedState {
  config: AppConfig
  activation: ActivationState | null
}

export interface LegacyConfig {
  version: 1
  networkService: string
  pacPort: number
  proxies: AppConfig['proxies']
  rules: LegacyDomainRule[]
}

export interface LegacyConfigV2 {
  version: 2
  networkServices: string[]
  pacPort: number
  proxies: AppConfig['proxies']
  rules: LegacyDomainRule[]
}

export interface LegacyConfigV3 {
  version: 3
  networkServices: string[]
  pacPort: number
  proxies: AppConfig['proxies']
  rules: AppConfig['rules']
}

export type LegacyDomainRule = Omit<AppConfig['rules'][number], 'matchSubdomains'>

interface LegacyActivation {
  service: string
  pacUrl: string
  previous: ActivationState['previous'][number]
  activatedAt: string
}

const DEFAULT_CONFIG: AppConfig = {
  version: 4,
  networkServices: ['Wi-Fi'],
  pacPort: 47653,
  relayPort: 47654,
  proxies: [
    {
      id: 'default-proxy',
      name: '默认代理',
      protocol: 'HTTP',
      host: '127.0.0.1',
      port: 8080
    }
  ],
  rules: [],
  applications: []
}

export class ConfigStore {
  readonly filePath: string
  private state: PersistedState = {
    config: structuredClone(DEFAULT_CONFIG),
    activation: null
  }

  constructor(userDataPath: string) {
    this.filePath = join(userDataPath, 'domain-relay.json')
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as {
        config?: AppConfig | LegacyConfig | LegacyConfigV2 | LegacyConfigV3
        activation?: ActivationState | LegacyActivation | null
      }
      let migrated = false
      if (parsed.config?.version === 4) {
        this.state.config = {
          ...parsed.config,
          applications: Array.isArray(parsed.config.applications) ? parsed.config.applications : []
        }
        migrated = !Array.isArray(parsed.config.applications)
      } else if (parsed.config?.version === 1 || parsed.config?.version === 2 || parsed.config?.version === 3) {
        this.state.config = migrateLegacyConfig(parsed.config)
        migrated = true
      }
      if (parsed.activation && 'service' in parsed.activation) {
        this.state.activation = {
          pacUrl: parsed.activation.pacUrl,
          previous: [parsed.activation.previous],
          activatedAt: parsed.activation.activatedAt
        }
        migrated = true
      } else {
        this.state.activation = parsed.activation ?? null
      }
      if (migrated) await this.persist()
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw new Error(`读取配置失败：${error instanceof Error ? error.message : String(error)}`)
      await this.persist()
    }
  }

  getConfig(): AppConfig {
    return structuredClone(this.state.config)
  }

  getActivation(): ActivationState | null {
    return this.state.activation ? structuredClone(this.state.activation) : null
  }

  async saveConfig(config: AppConfig): Promise<void> {
    this.state.config = structuredClone(config)
    await this.persist()
  }

  async saveActivation(activation: ActivationState | null): Promise<void> {
    this.state.activation = activation ? structuredClone(activation) : null
    await this.persist()
  }

  private async persist(): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.tmp`
    await fs.writeFile(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 })
    await fs.rename(temporaryPath, this.filePath)
    await fs.chmod(this.filePath, 0o600)
  }
}

export function migrateLegacyConfig(config: LegacyConfig | LegacyConfigV2 | LegacyConfigV3): AppConfig {
  return {
    version: 4,
    networkServices: config.version === 1 ? (config.networkService ? [config.networkService] : []) : config.networkServices,
    pacPort: config.pacPort,
    relayPort: config.pacPort === 65535 ? 65534 : config.pacPort + 1,
    proxies: config.proxies,
    rules:
      config.version === 3
        ? config.rules
        : config.rules.map((rule) => ({ ...rule, matchSubdomains: true })),
    applications: []
  }
}
