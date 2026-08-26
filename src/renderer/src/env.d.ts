/// <reference types="vite/client" />

import type { DomainRelayApi } from '../../shared/types'

declare global {
  interface Window {
    domainRelay: DomainRelayApi
  }
}

export {}
