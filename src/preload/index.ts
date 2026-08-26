import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppConfig,
  ApplicationLaunchResult,
  DomainDiagnosticResult,
  DomainRelayApi,
  OperationResult,
  ManagedApplication,
  ProxyProfile,
  ProxyTestResult,
  RuntimeState,
  TrafficHistory,
  TrafficHistoryRange,
  TrafficSnapshot
} from '../shared/types'

const api: DomainRelayApi = {
  getState: () => ipcRenderer.invoke('domain-relay:get-state') as Promise<RuntimeState>,
  saveConfig: (config: AppConfig) =>
    ipcRenderer.invoke('domain-relay:save-config', config) as Promise<RuntimeState>,
  activate: (replaceExisting: boolean) =>
    ipcRenderer.invoke('domain-relay:activate', replaceExisting) as Promise<OperationResult>,
  restore: () => ipcRenderer.invoke('domain-relay:restore') as Promise<OperationResult>,
  testProxy: (proxy: ProxyProfile) =>
    ipcRenderer.invoke('domain-relay:test-proxy', proxy) as Promise<ProxyTestResult>,
  diagnoseDomain: (domain: string) =>
    ipcRenderer.invoke('domain-relay:diagnose-domain', domain) as Promise<DomainDiagnosticResult>,
  selectApplication: () =>
    ipcRenderer.invoke('domain-relay:select-application') as Promise<ManagedApplication | null>,
  launchApplication: (applicationId: string) =>
    ipcRenderer.invoke('domain-relay:launch-application', applicationId) as Promise<ApplicationLaunchResult>,
  showApplication: (applicationId: string) =>
    ipcRenderer.invoke('domain-relay:show-application', applicationId) as Promise<void>,
  getTrafficSnapshot: () =>
    ipcRenderer.invoke('domain-relay:traffic-snapshot') as Promise<TrafficSnapshot>,
  getTrafficHistory: (range: TrafficHistoryRange) =>
    ipcRenderer.invoke('domain-relay:traffic-history', range) as Promise<TrafficHistory>,
  clearTrafficHistory: () =>
    ipcRenderer.invoke('domain-relay:clear-traffic-history') as Promise<TrafficSnapshot>,
  getPacPreview: () => ipcRenderer.invoke('domain-relay:pac-preview') as Promise<string>,
  showConfigFile: () => ipcRenderer.invoke('domain-relay:show-config-file') as Promise<void>
}

contextBridge.exposeInMainWorld('domainRelay', api)
