import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, shell, Tray, type OpenDialogOptions } from 'electron'
import { is } from '@electron-toolkit/utils'
import type {
  ActivationState,
  AppConfig,
  DiagnosticStatus,
  DomainDiagnosticCheck,
  DomainDiagnosticResult,
  NetworkProxyState,
  OperationResult,
  ManagedApplication,
  ProxyProfile,
  RuntimeState,
  TrafficHistoryRange
} from '../shared/types'
import { ConfigStore } from './config-store'
import { getAutoProxy, getManualProxies, listNetworkServices, planAutoProxyRestore, setAutoProxies } from './network'
import { generatePac, normalizeDomain, validateConfig } from './pac'
import { PacServer } from './pac-server'
import { buildPacUrl, isPacUrlForConfig } from './pac-url'
import { testProxyConnection } from './proxy-test'
import { createTrayIcon } from './tray-icon'
import { TrafficHistoryStore, TrafficMonitor } from './traffic-monitor'
import { TrafficProxyServer } from './traffic-proxy'
import {
  applicationStates as readApplicationStates,
  launchManagedApplication,
  resolveApplicationBundle
} from './application-launcher'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let store: ConfigStore
let pacServer: PacServer
let trafficHistoryStore: TrafficHistoryStore
let trafficMonitor: TrafficMonitor
let trafficProxyServer: TrafficProxyServer
const launchedApplicationIds = new Set<string>()

function managedPacUrls(activation: ActivationState): string[] {
  return [...new Set([activation.pacUrl, ...(activation.managedPacUrls ?? [])])]
}

function sameStringSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value))
}

async function ensureUsableNetworkServices(): Promise<void> {
  const services = await listNetworkServices()
  const config = store.getConfig()
  const available = new Set(services.filter((service) => !service.disabled).map((service) => service.name))
  const selected = config.networkServices.filter((service) => available.has(service))
  if (selected.length > 0 && selected.length === config.networkServices.length) return
  const fallback = services.find((service) => !service.disabled)?.name
  await store.saveConfig({ ...config, networkServices: selected.length > 0 ? selected : fallback ? [fallback] : [] })
}

async function readNetworkProxyStates(services: string[]): Promise<NetworkProxyState[]> {
  return Promise.all(
    services.map(async (service) => {
      const [autoProxy, manualProxies] = await Promise.all([getAutoProxy(service), getManualProxies(service)])
      return { service, autoProxy, manualProxies }
    })
  )
}

async function runtimeState(): Promise<RuntimeState> {
  const config = store.getConfig()
  const services = await listNetworkServices()
  const defaultNetworkService = services.find((service) => service.isDefault)?.name ?? null
  const available = new Set(services.map((service) => service.name))
  const selectedServices = config.networkServices.filter((service) => available.has(service))
  const networkProxyStates = await readNetworkProxyStates(selectedServices)
  const activation = store.getActivation()
  const applicationStates = await readApplicationStates(config.applications, launchedApplicationIds)
  const url = activation?.pacUrl ?? buildPacUrl(config)
  const activatedServices = activation?.previous.map((snapshot) => snapshot.service) ?? []
  const active = Boolean(
    activation &&
      isPacUrlForConfig(activation.pacUrl, config) &&
      sameStringSet(activatedServices, config.networkServices) &&
      networkProxyStates.length === config.networkServices.length &&
      networkProxyStates.every((state) => state.autoProxy.enabled && state.autoProxy.url === url) &&
      pacServer.isRunning(config.pacPort) &&
      trafficProxyServer.isRunning(config.relayPort)
  )
  const trafficReady = active && (!defaultNetworkService || config.networkServices.includes(defaultNetworkService))
  const conflicts: string[] = []
  for (const state of networkProxyStates) {
    if (state.autoProxy.enabled && state.autoProxy.url !== url) {
      conflicts.push(`“${state.service}”已启用其他自动代理：${state.autoProxy.url ?? '(无 URL)'}`)
    }
    const enabledManual = state.manualProxies.filter((proxy) => proxy.enabled)
    if (enabledManual.length > 0) {
      conflicts.push(`“${state.service}”还启用了${enabledManual.map((proxy) => proxy.kind).join('、')}手动代理；DIRECT 不保证继续使用它们`)
    }
  }
  return {
    config,
    networkServices: services,
    defaultNetworkService,
    activation,
    networkProxyStates,
    pacUrl: url,
    active,
    trafficReady,
    trafficRelayRunning: trafficProxyServer.isRunning(config.relayPort),
    applicationStates,
    conflicts
  }
}

async function saveConfig(nextConfig: AppConfig): Promise<RuntimeState> {
  const config = validateConfig(nextConfig)
  const activation = store.getActivation()
  const current = store.getConfig()
  if (
    activation &&
    (!sameStringSet(config.networkServices, current.networkServices) ||
      config.pacPort !== current.pacPort ||
      config.relayPort !== current.relayPort)
  ) {
    throw new Error('启用期间不能修改系统网络入口、PAC 端口或流量转发端口，请先恢复系统设置')
  }
  if (!activation && config.relayPort !== current.relayPort) {
    const launched = await readApplicationStates(current.applications, launchedApplicationIds)
    if (launched.some((application) => application.status === 'proxied')) {
      throw new Error('有应用正在通过当前流量转发端口运行，请先完全退出这些应用后再修改端口')
    }
  }
  const available = new Set((await listNetworkServices()).filter((service) => !service.disabled).map((service) => service.name))
  const unavailable = config.networkServices.filter((service) => !available.has(service))
  if (unavailable.length > 0) throw new Error(`以下网络服务不可用：${unavailable.join('、')}`)

  const nextPacUrl = buildPacUrl(config)
  const requiresPacRefresh = Boolean(activation && buildPacUrl(current) !== nextPacUrl)
  if (activation && requiresPacRefresh) {
    if (!pacServer.isRunning(config.pacPort) || !trafficProxyServer.isRunning(config.relayPort)) {
      throw new Error('本地 PAC 或流量转发服务未运行，无法热更新；请先恢复系统设置后重新应用')
    }

    const before = await Promise.all(config.networkServices.map((service) => getAutoProxy(service)))
    const ownedUrls = new Set(managedPacUrls(activation))
    const noLongerManaged = before.filter(
      (snapshot) => !snapshot.enabled || snapshot.url === null || !ownedUrls.has(snapshot.url)
    )
    if (noLongerManaged.length > 0) {
      throw new Error(`以下网络服务的 PAC 已被外部修改，未执行热更新：${noLongerManaged.map((item) => item.service).join('、')}`)
    }

    const transitionActivation = {
      ...activation,
      pacUrl: nextPacUrl,
      managedPacUrls: [...new Set([...managedPacUrls(activation), nextPacUrl])]
    }
    const rollbackFailures: string[] = []
    try {
      await store.saveConfig(config)
      await store.saveActivation(transitionActivation)
      await setAutoProxies(config.networkServices.map((service) => ({ service, url: nextPacUrl, enabled: true })))
      const verified = await Promise.all(config.networkServices.map((service) => getAutoProxy(service)))
      if (verified.some((snapshot) => !snapshot.enabled || snapshot.url !== nextPacUrl)) {
        throw new Error('macOS 未在全部网络服务上刷新 PAC 地址')
      }
      await store.saveActivation({ ...transitionActivation, managedPacUrls: [nextPacUrl] })
      return runtimeState()
    } catch (error) {
      try {
        await store.saveConfig(current)
      } catch (rollbackError) {
        rollbackFailures.push(`配置回滚失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`)
      }

      let networkRollbackFailed = false
      try {
        const live = await Promise.all(config.networkServices.map((service) => getAutoProxy(service)))
        const beforeByService = new Map(before.map((snapshot) => [snapshot.service, snapshot]))
        const rollbackTargets = live
          .filter((snapshot) => snapshot.enabled && snapshot.url === nextPacUrl)
          .map((snapshot) => {
            const previous = beforeByService.get(snapshot.service)!
            return { service: snapshot.service, url: previous.url, enabled: previous.enabled }
          })
        await setAutoProxies(rollbackTargets)
        const rolledBack = await Promise.all(rollbackTargets.map((target) => getAutoProxy(target.service)))
        if (rolledBack.some((snapshot, index) => {
          const target = rollbackTargets[index]!
          return snapshot.enabled !== target.enabled || snapshot.url !== target.url
        })) {
          throw new Error('macOS 未在全部网络服务上恢复原 PAC 地址')
        }
      } catch (rollbackError) {
        networkRollbackFailed = true
        rollbackFailures.push(`系统 PAC 回滚失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`)
      }

      try {
        await store.saveActivation(networkRollbackFailed ? transitionActivation : activation)
      } catch (rollbackError) {
        rollbackFailures.push(`恢复状态保存失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`)
      }

      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(rollbackFailures.length > 0 ? `${reason}；${rollbackFailures.join('；')}` : reason)
    }
  }

  await store.saveConfig(config)
  if (!activation && config.relayPort !== current.relayPort) await trafficProxyServer.start(config.relayPort)
  return runtimeState()
}

async function activate(replaceExisting: boolean): Promise<OperationResult> {
  const config = validateConfig(store.getConfig())
  if (config.rules.filter((rule) => rule.enabled).length === 0) throw new Error('至少启用一条域名规则后才能应用')
  const before = await runtimeState()
  if (before.active) return { state: before, message: '规则已经生效' }
  if (before.defaultNetworkService && !config.networkServices.includes(before.defaultNetworkService)) {
    throw new Error(
      `当前系统流量通过“${before.defaultNetworkService}”，但它没有被选中。请勾选该网络入口后再应用。`
    )
  }
  if (before.conflicts.length > 0 && !replaceExisting) {
    throw new Error(`检测到现有代理设置：\n${before.conflicts.join('\n')}`)
  }

  const previous = await Promise.all(config.networkServices.map((service) => getAutoProxy(service)))
  const activation = {
    pacUrl: buildPacUrl(config),
    managedPacUrls: [buildPacUrl(config)],
    previous,
    activatedAt: new Date().toISOString()
  }

  try {
    await trafficProxyServer.start(config.relayPort)
    await pacServer.start(config.pacPort)
    await store.saveActivation(activation)
    await setAutoProxies(config.networkServices.map((service) => ({ service, url: activation.pacUrl, enabled: true })))
    const verified = await Promise.all(config.networkServices.map((service) => getAutoProxy(service)))
    if (verified.some((snapshot) => !snapshot.enabled || snapshot.url !== activation.pacUrl)) {
      throw new Error('macOS 未在全部网络服务上保存预期的自动代理设置')
    }
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true })
    rebuildTrayMenu()
    return { state: await runtimeState(), message: `域名代理规则已应用到 ${config.networkServices.length} 个网络服务` }
  } catch (error) {
    let restoreFailure: unknown = null
    try {
      const current = await Promise.all(config.networkServices.map((service) => getAutoProxy(service)))
      const previousByService = new Map(previous.map((snapshot) => [snapshot.service, snapshot]))
      const rollbackTargets = current
        .filter((snapshot) => snapshot.url === activation.pacUrl)
        .map((snapshot) => previousByService.get(snapshot.service)!)
        .map((snapshot) => ({ service: snapshot.service, url: snapshot.url, enabled: snapshot.enabled }))
      await setAutoProxies(rollbackTargets)
    } catch (restoreError) {
      restoreFailure = restoreError
    }
    await store.saveActivation(null)
    await pacServer.stop()
    if (restoreFailure) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}；自动回滚也失败：${
          restoreFailure instanceof Error ? restoreFailure.message : String(restoreFailure)
        }`
      )
    }
    throw error
  }
}

function aggregateDiagnosticStatus(checks: DomainDiagnosticCheck[]): DiagnosticStatus {
  if (checks.some((check) => check.status === 'failed')) return 'failed'
  if (checks.some((check) => check.status === 'warning')) return 'warning'
  return 'ok'
}

async function diagnoseDomain(input: string): Promise<DomainDiagnosticResult> {
  const domain = normalizeDomain(input)
  if (!domain) throw new Error('请输入有效域名，例如 google.com')
  const state = await runtimeState()
  const checks: DomainDiagnosticCheck[] = []

  if (!state.defaultNetworkService) {
    checks.push({
      id: 'network',
      status: 'warning',
      title: '当前网络入口无法识别',
      detail: 'macOS 没有返回可映射的默认网络服务，请确认至少选择了当前使用的网卡或 Wi-Fi。'
    })
  } else if (!state.config.networkServices.includes(state.defaultNetworkService)) {
    checks.push({
      id: 'network',
      status: 'failed',
      title: '当前网络入口未选择',
      detail: `系统流量正在通过“${state.defaultNetworkService}”，请先在系统设置中勾选它。`
    })
  } else {
    checks.push({
      id: 'network',
      status: 'ok',
      title: '当前网络入口已选择',
      detail: `系统默认流量通过“${state.defaultNetworkService}”。`
    })
  }

  const currentProxyState = state.networkProxyStates.find((item) => item.service === state.defaultNetworkService)
  if (
    !state.activation ||
    !pacServer.isRunning(state.config.pacPort) ||
    !trafficProxyServer.isRunning(state.config.relayPort)
  ) {
    checks.push({
      id: 'pac',
      status: 'failed',
      title: '本地 PAC 或流量转发服务尚未运行',
      detail: '请保存配置并点击“应用到 macOS”，应用会同时启动 PAC 与本地计量转发。'
    })
  } else if (
    state.defaultNetworkService &&
    (!currentProxyState?.autoProxy.enabled || currentProxyState.autoProxy.url !== state.pacUrl)
  ) {
    checks.push({
      id: 'pac',
      status: 'failed',
      title: 'PAC 未应用到当前入口',
      detail: `“${state.defaultNetworkService}”没有启用本应用的 PAC。`
    })
  } else {
    checks.push({
      id: 'pac',
      status: 'ok',
      title: 'PAC 服务与系统设置正常',
      detail: state.pacUrl
    })
  }

  const rule = state.config.rules.find(
    (item) =>
      item.enabled &&
      (domain === item.domain || (item.matchSubdomains && domain.endsWith(`.${item.domain}`)))
  )
  if (!rule) {
    checks.push({
      id: 'rule',
      status: 'failed',
      title: '域名没有命中规则',
      detail: `${domain} 将继续使用系统默认路径。`
    })
    checks.push({
      id: 'proxy',
      status: 'failed',
      title: '未执行代理测试',
      detail: '请先为该域名添加并启用规则。'
    })
  } else {
    const proxy = state.config.proxies.find((item) => item.id === rule.proxyId)
    checks.push({
      id: 'rule',
      status: proxy ? 'ok' : 'failed',
      title: proxy ? '域名规则已命中' : '规则引用的代理不存在',
      detail: proxy ? `${domain} → ${proxy.name}（${proxy.protocol}）` : rule.domain
    })
    if (proxy) {
      const result = await testProxyConnection(proxy, { targetHost: domain, targetPort: 443 })
      checks.push({
        id: 'proxy',
        status: result.status === 'ok' ? 'ok' : result.status === 'auth-required' ? 'warning' : 'failed',
        title:
          result.status === 'ok'
            ? '目标域名代理隧道可用'
            : result.status === 'auth-required'
              ? '代理要求身份认证'
              : '目标域名代理连接失败',
        detail: `${result.message} · ${result.latencyMs} ms`
      })
    }
  }

  return {
    domain,
    status: aggregateDiagnosticStatus(checks),
    checks,
    checkedAt: new Date().toISOString()
  }
}

async function restore(): Promise<OperationResult> {
  const activation = store.getActivation()
  if (!activation) {
    await pacServer.stop()
    return { state: await runtimeState(), message: '没有需要恢复的系统设置' }
  }

  const available = new Set((await listNetworkServices()).map((service) => service.name))
  const existingSnapshots = activation.previous.filter((snapshot) => available.has(snapshot.service))
  const current = await Promise.all(existingSnapshots.map((snapshot) => getAutoProxy(snapshot.service)))
  const restorePlan = planAutoProxyRestore(activation.previous, current, managedPacUrls(activation))
  await setAutoProxies(restorePlan.targets)
  const messageParts = [
    restorePlan.targets.length > 0 ? `已恢复 ${restorePlan.targets.length} 个网络服务` : null,
    restorePlan.unchanged.length > 0 ? `${restorePlan.unchanged.length} 个网络服务已是原设置，无需授权` : null,
    restorePlan.skipped.length > 0 ? `${restorePlan.skipped.join('、')} 已不可用或被其他软件修改，未覆盖` : null
  ].filter((part): part is string => Boolean(part))
  const message = messageParts.join('；') || '系统网络设置无需恢复'
  await store.saveActivation(null)
  await pacServer.stop()
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: false })
  rebuildTrayMenu()
  return { state: await runtimeState(), message }
}

async function selectApplication(): Promise<ManagedApplication | null> {
  const options: OpenDialogOptions = {
    title: '选择需要通过 Domain Relay 启动的应用',
    buttonLabel: '选择应用',
    properties: ['openFile'],
    filters: [{ name: 'macOS 应用', extensions: ['app'] }]
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  const selectedPath = result.filePaths[0]
  if (result.canceled || !selectedPath) return null
  const selected = await resolveApplicationBundle(selectedPath)
  if (selected.bundleId === 'local.domain-relay.app') throw new Error('Domain Relay 不能代理自己')
  const existing = store.getConfig().applications.find((application) => application.path === selected.path)
  return existing ?? selected
}

async function launchApplication(applicationId: string): Promise<OperationResult> {
  const config = store.getConfig()
  const application = config.applications.find((item) => item.id === applicationId)
  if (!application) throw new Error('应用配置不存在，请重新添加')
  await trafficProxyServer.start(config.relayPort)
  await launchManagedApplication(application, config.relayPort, launchedApplicationIds)
  rebuildTrayMenu()
  return {
    state: await runtimeState(),
    message: `已通过域名规则启动“${application.name}”`
  }
}

function showApplication(applicationId: string): void {
  const application = store.getConfig().applications.find((item) => item.id === applicationId)
  if (!application) throw new Error('应用配置不存在')
  shell.showItemInFolder(application.path)
}

function showMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 780,
    minWidth: 900,
    minHeight: 660,
    show: false,
    backgroundColor: '#f4f6f5',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 20 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function rebuildTrayMenu(): void {
  if (!tray) return
  const active = Boolean(store?.getActivation())
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开 Domain Relay', click: showMainWindow },
      { label: '隐藏主窗口（留在菜单栏）', click: () => mainWindow?.hide() },
      { type: 'separator' },
      {
        label: active ? '恢复系统代理设置' : '应用当前规则',
        click: () => {
          const operation = active ? restore() : activate(false)
          void operation.catch((error) => dialog.showErrorBox('Domain Relay', error instanceof Error ? error.message : String(error)))
        }
      },
      { type: 'separator' },
      { label: active ? '完全退出…' : '退出 Domain Relay', click: () => void requestQuit() }
    ])
  )
  tray.setToolTip(active ? 'Domain Relay · 已接管 PAC' : 'Domain Relay · 未启用')
}

async function requestQuit(): Promise<void> {
  if (quitting) return
  const requiresRestore = Boolean(store.getActivation())
  if (requiresRestore) {
    const choice = await dialog.showMessageBox({
      type: 'info',
      message: '要留在菜单栏，还是完全退出？',
      detail: '留在菜单栏无需授权，系统 PAC 和域名代理会继续可用。完全退出前必须恢复系统设置，macOS 会请求管理员授权。',
      buttons: ['留在菜单栏（无需授权）', '恢复并完全退出', '取消'],
      defaultId: 0,
      cancelId: 2
    })
    if (choice.response === 0) {
      mainWindow?.hide()
      return
    }
    if (choice.response !== 1) return
  }
  const applicationStates = await readApplicationStates(store.getConfig().applications, launchedApplicationIds)
  const proxiedApplications = applicationStates.filter((application) => application.status === 'proxied')
  if (proxiedApplications.length > 0) {
    const choice = await dialog.showMessageBox({
      type: 'warning',
      message: '仍有应用通过 Domain Relay 运行',
      detail: `退出后，${proxiedApplications.map((application) => application.name).join('、')} 的代理连接会中断。`,
      buttons: ['仍然退出', '取消'],
      defaultId: 1,
      cancelId: 1
    })
    if (choice.response !== 0) return
  }
  if (requiresRestore && store.getActivation()) {
    try {
      await restore()
    } catch (error) {
      dialog.showErrorBox('无法恢复系统设置', error instanceof Error ? error.message : String(error))
      return
    }
  }
  quitting = true
  app.quit()
}

function registerIpc(): void {
  ipcMain.handle('domain-relay:get-state', () => runtimeState())
  ipcMain.handle('domain-relay:save-config', (_event, config: AppConfig) => saveConfig(config))
  ipcMain.handle('domain-relay:activate', (_event, replaceExisting: boolean) => activate(Boolean(replaceExisting)))
  ipcMain.handle('domain-relay:restore', () => restore())
  ipcMain.handle('domain-relay:test-proxy', (_event, proxy: ProxyProfile) => testProxyConnection(proxy))
  ipcMain.handle('domain-relay:diagnose-domain', (_event, domain: string) => diagnoseDomain(domain))
  ipcMain.handle('domain-relay:select-application', () => selectApplication())
  ipcMain.handle('domain-relay:launch-application', (_event, applicationId: string) =>
    launchApplication(applicationId)
  )
  ipcMain.handle('domain-relay:show-application', (_event, applicationId: string) => showApplication(applicationId))
  ipcMain.handle('domain-relay:traffic-snapshot', () =>
    trafficMonitor.getSnapshot(trafficProxyServer.isRunning(store.getConfig().relayPort))
  )
  ipcMain.handle('domain-relay:traffic-history', (_event, range: TrafficHistoryRange) => {
    if (!['today', '7d', '30d', 'all'].includes(range)) throw new Error('不支持的流量历史范围')
    return trafficMonitor.getHistory(range)
  })
  ipcMain.handle('domain-relay:clear-traffic-history', () =>
    trafficMonitor.clearHistory(trafficProxyServer.isRunning(store.getConfig().relayPort))
  )
  ipcMain.handle('domain-relay:pac-preview', () => generatePac(store.getConfig()))
  ipcMain.handle('domain-relay:show-config-file', () => shell.showItemInFolder(store.filePath))
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  quitting = true
  app.quit()
} else {
  app.on('second-instance', showMainWindow)

  app.whenReady().then(async () => {
    app.setName('Domain Relay')
    store = new ConfigStore(app.getPath('userData'))
    await store.load()
    await ensureUsableNetworkServices()
    pacServer = new PacServer(() => store.getConfig())
    trafficHistoryStore = new TrafficHistoryStore(app.getPath('userData'))
    await trafficHistoryStore.load()
    trafficMonitor = new TrafficMonitor(trafficHistoryStore)
    trafficProxyServer = new TrafficProxyServer(() => store.getConfig(), trafficMonitor)
    try {
      await trafficProxyServer.start(store.getConfig().relayPort)
      if (store.getActivation()) {
        await pacServer.start(store.getConfig().pacPort)
      }
    } catch (error) {
      await pacServer.stop()
      await trafficProxyServer.stop()
      dialog.showErrorBox('本地代理服务启动失败', error instanceof Error ? error.message : String(error))
    }
    registerIpc()
    createMainWindow()
    tray = new Tray(createTrayIcon())
    tray.on('click', showMainWindow)
    rebuildTrayMenu()

    app.on('activate', showMainWindow)
  })

  app.on('before-quit', (event) => {
    if (!quitting) {
      event.preventDefault()
      void requestQuit()
    }
  })

  app.on('window-all-closed', () => {
    // The PAC server must stay alive. Closing the window keeps the menu bar app running.
  })

  app.on('will-quit', () => trafficMonitor?.dispose())
}
