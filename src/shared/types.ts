export type ProxyProtocol = 'HTTP' | 'HTTPS' | 'SOCKS5'

export interface ProxyProfile {
  id: string
  name: string
  protocol: ProxyProtocol
  host: string
  port: number
}

export interface DomainRule {
  id: string
  domain: string
  proxyId: string
  enabled: boolean
  matchSubdomains: boolean
}

export interface ManagedApplication {
  id: string
  name: string
  path: string
  bundleId: string | null
  executablePath: string
  addedAt: string
}

export type ManagedApplicationStatus = 'stopped' | 'running' | 'proxied'

export interface ManagedApplicationState extends ManagedApplication {
  status: ManagedApplicationStatus
}

export interface ApplicationLaunchResult {
  state: RuntimeState
  message: string
}

export interface AppConfig {
  version: 4
  networkServices: string[]
  pacPort: number
  relayPort: number
  proxies: ProxyProfile[]
  rules: DomainRule[]
  applications: ManagedApplication[]
}

export interface AutoProxySnapshot {
  service: string
  enabled: boolean
  url: string | null
  capturedAt: string
}

export interface ActivationState {
  pacUrl: string
  previous: AutoProxySnapshot[]
  activatedAt: string
}

export interface NetworkService {
  name: string
  disabled: boolean
  device: string | null
  isDefault: boolean
}

export interface ManualProxyState {
  kind: 'HTTP' | 'HTTPS' | 'SOCKS'
  enabled: boolean
  server: string | null
  port: number | null
}

export interface NetworkProxyState {
  service: string
  autoProxy: AutoProxySnapshot
  manualProxies: ManualProxyState[]
}

export type ProxyTestStatus = 'ok' | 'auth-required' | 'failed'

export interface ProxyTestResult {
  proxyId: string
  status: ProxyTestStatus
  latencyMs: number
  message: string
  testedAt: string
}

export interface RuntimeState {
  config: AppConfig
  networkServices: NetworkService[]
  defaultNetworkService: string | null
  activation: ActivationState | null
  networkProxyStates: NetworkProxyState[]
  pacUrl: string
  active: boolean
  trafficReady: boolean
  trafficRelayRunning: boolean
  applicationStates: ManagedApplicationState[]
  conflicts: string[]
}

export type TrafficSessionStatus = 'active' | 'completed' | 'failed'
export type TrafficSessionOutcome = 'responded' | 'no-response' | 'failed'

export interface TrafficSession {
  id: string
  domain: string
  ruleDomain: string
  proxyId: string
  proxyName: string
  proxyProtocol: ProxyProtocol
  startedAt: string
  endedAt: string | null
  uploadBytes: number
  downloadBytes: number
  status: TrafficSessionStatus
  outcome: TrafficSessionOutcome
  error: string | null
}

export interface TrafficRatePoint {
  at: string
  uploadBytes: number
  downloadBytes: number
}

export interface TrafficDomainStat {
  domain: string
  proxyName: string
  proxyProtocol: ProxyProtocol
  uploadBytes: number
  downloadBytes: number
  connections: number
  activeConnections: number
  noResponseConnections: number
  failedConnections: number
  lastSeenAt: string
}

export interface TrafficSnapshot {
  relayRunning: boolean
  activeConnections: number
  uploadBps: number
  downloadBps: number
  todayUploadBytes: number
  todayDownloadBytes: number
  ratePoints: TrafficRatePoint[]
  activeSessions: TrafficSession[]
  recentSessions: TrafficSession[]
  realtimeDomains: TrafficDomainStat[]
  updatedAt: string
}

export type TrafficHistoryRange = 'today' | '7d' | '30d' | 'all'

export interface TrafficHistory {
  range: TrafficHistoryRange
  from: string | null
  sessions: TrafficSession[]
  domains: TrafficDomainStat[]
  uploadBytes: number
  downloadBytes: number
  connections: number
}

export type DiagnosticStatus = 'ok' | 'warning' | 'failed'

export interface DomainDiagnosticCheck {
  id: 'network' | 'pac' | 'rule' | 'proxy'
  status: DiagnosticStatus
  title: string
  detail: string
}

export interface DomainDiagnosticResult {
  domain: string
  status: DiagnosticStatus
  checks: DomainDiagnosticCheck[]
  checkedAt: string
}

export interface OperationResult {
  state: RuntimeState
  message: string
}

export interface DomainRelayApi {
  getState: () => Promise<RuntimeState>
  saveConfig: (config: AppConfig) => Promise<RuntimeState>
  activate: (replaceExisting: boolean) => Promise<OperationResult>
  restore: () => Promise<OperationResult>
  testProxy: (proxy: ProxyProfile) => Promise<ProxyTestResult>
  diagnoseDomain: (domain: string) => Promise<DomainDiagnosticResult>
  selectApplication: () => Promise<ManagedApplication | null>
  launchApplication: (applicationId: string) => Promise<ApplicationLaunchResult>
  showApplication: (applicationId: string) => Promise<void>
  getTrafficSnapshot: () => Promise<TrafficSnapshot>
  getTrafficHistory: (range: TrafficHistoryRange) => Promise<TrafficHistory>
  clearTrafficHistory: () => Promise<TrafficSnapshot>
  getPacPreview: () => Promise<string>
  showConfigFile: () => Promise<void>
}
