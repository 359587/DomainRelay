import { createHash } from 'node:crypto'
import type { AppConfig } from '../shared/types'
import { generatePac } from './pac'

const PAC_PATH = '/proxy.pac'

export function pacRevision(config: AppConfig): string {
  return createHash('sha256').update(generatePac(config)).digest('hex')
}

export function buildPacUrl(config: AppConfig): string {
  return `http://127.0.0.1:${config.pacPort}${PAC_PATH}?revision=${pacRevision(config)}`
}

export function isPacUrlForConfig(input: string, config: AppConfig): boolean {
  try {
    const url = new URL(input)
    if (
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      url.port !== String(config.pacPort) ||
      url.pathname !== PAC_PATH
    ) {
      return false
    }

    const revision = url.searchParams.get('revision')
    return revision === null || revision === pacRevision(config)
  } catch {
    return false
  }
}
