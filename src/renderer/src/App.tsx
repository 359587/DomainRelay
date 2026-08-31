import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppConfig,
  DomainDiagnosticResult,
  ProxyProfile,
  RuntimeState,
  TrafficSnapshot
} from '../../shared/types'
import {
  ApplicationIcon,
  DomainIcon,
  EyeIcon,
  FolderIcon,
  RefreshIcon,
  RouteIcon,
  ServerIcon,
  SystemIcon,
  TestIcon,
  TrafficIcon
} from './components/Icons'
import { ApplicationsPanel } from './components/ApplicationsPanel'
import { DiagnosticsPanel } from './components/DiagnosticsPanel'
import { NetworkServicePicker } from './components/NetworkServicePicker'
import { PacPreview } from './components/PacPreview'
import { ProxyEditor, type ProxyTestView } from './components/ProxyEditor'
import { RuleEditor } from './components/RuleEditor'
import { SidebarTraffic, TrafficPanel } from './components/TrafficPanel'

interface ToastState {
  tone: 'success' | 'error'
  message: string
}

type SettingsPage = 'system' | 'proxies' | 'rules' | 'applications' | 'diagnostics' | 'traffic'

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function App(): React.JSX.Element {
  const [state, setState] = useState<RuntimeState | null>(null)
  const [draft, setDraft] = useState<AppConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [pacPreview, setPacPreview] = useState<string | null>(null)
  const [proxyTests, setProxyTests] = useState<Record<string, ProxyTestView>>({})
  const [activePage, setActivePage] = useState<SettingsPage>('system')
  const [trafficSnapshot, setTrafficSnapshot] = useState<TrafficSnapshot | null>(null)
  const mainEditorRef = useRef<HTMLElement>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const next = await window.domainRelay.getState()
      setState(next)
      setDraft(next.config)
    } catch (error) {
      setToast({ tone: 'error', message: describeError(error) })
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const refreshTraffic = useCallback(async (): Promise<void> => {
    try {
      setTrafficSnapshot(await window.domainRelay.getTrafficSnapshot())
    } catch {
      // The configuration screen remains usable if the local metering service has not started yet.
    }
  }, [])

  useEffect(() => {
    void refreshTraffic()
    const timer = window.setInterval(() => void refreshTraffic(), 1_000)
    return () => window.clearInterval(timer)
  }, [refreshTraffic])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 4200)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    mainEditorRef.current?.scrollTo({ top: 0 })
  }, [activePage])

  const dirty = useMemo(() => {
    if (!state || !draft) return false
    return JSON.stringify(state.config) !== JSON.stringify(draft)
  }, [draft, state])

  useEffect(() => {
    if (activePage !== 'applications' || dirty) return
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2_000)
    return () => window.clearInterval(timer)
  }, [activePage, dirty, refresh])

  const run = async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await operation()
    } catch (error) {
      setToast({ tone: 'error', message: describeError(error) })
    } finally {
      setBusy(false)
    }
  }

  const save = async (): Promise<RuntimeState> => {
    if (!draft) throw new Error('配置尚未加载')
    const next = await window.domainRelay.saveConfig(draft)
    setState(next)
    setDraft(next.config)
    return next
  }

  const handleSave = (): void => {
    void run(async () => {
      const routingChanged = Boolean(
        state &&
        draft &&
        (JSON.stringify(state.config.rules) !== JSON.stringify(draft.rules) ||
          JSON.stringify(state.config.proxies) !== JSON.stringify(draft.proxies))
      )
      const next = await save()
      setToast({
        tone: 'success',
        message: state?.active && routingChanged
          ? '配置已保存；域名规则已热更新并立即生效'
          : next.active
            ? '配置已保存；当前系统代理保持生效'
            : '配置已保存；尚未改变系统网络设置'
      })
    })
  }

  const handleActivate = (): void => {
    void run(async () => {
      const saved = await save()
      let replaceExisting = false
      if (saved.conflicts.length > 0) {
        replaceExisting = window.confirm(
          `检测到现有代理设置：\n\n${saved.conflicts.join('\n')}\n\n继续会替换所选网络入口的自动 PAC，但不会关闭手动代理。是否继续？`
        )
        if (!replaceExisting) return
      }
      const result = await window.domainRelay.activate(replaceExisting)
      setState(result.state)
      setDraft(result.state.config)
      setToast({ tone: 'success', message: result.message })
    })
  }

  const handleRestore = (): void => {
    void run(async () => {
      const result = await window.domainRelay.restore()
      setState(result.state)
      setDraft(result.state.config)
      setToast({ tone: 'success', message: result.message })
    })
  }

  const handlePreview = (): void => {
    void run(async () => {
      if (dirty) await save()
      setPacPreview(await window.domainRelay.getPacPreview())
    })
  }

  const handleProxyChange = (proxies: ProxyProfile[]): void => {
    if (!draft) return
    const previousById = new Map(draft.proxies.map((proxy) => [proxy.id, proxy]))
    setProxyTests((current) => {
      const next: Record<string, ProxyTestView> = {}
      for (const proxy of proxies) {
        const previous = previousById.get(proxy.id)
        if (
          previous &&
          previous.protocol === proxy.protocol &&
          previous.host === proxy.host &&
          previous.port === proxy.port &&
          current[proxy.id]
        ) {
          next[proxy.id] = current[proxy.id]
        }
      }
      return next
    })
    const proxyIds = new Set(proxies.map((proxy) => proxy.id))
    const fallbackId = proxies[0]?.id ?? ''
    setDraft({
      ...draft,
      proxies,
      rules: draft.rules.map((rule) =>
        proxyIds.has(rule.proxyId) ? rule : { ...rule, proxyId: fallbackId }
      )
    })
  }

  const handleTestProxy = (proxy: ProxyProfile): void => {
    setProxyTests((current) => ({
      ...current,
      [proxy.id]: { status: 'testing', message: '正在建立代理隧道…' }
    }))
    void window.domainRelay
      .testProxy(proxy)
      .then((result) => {
        setProxyTests((current) => ({
          ...current,
          [proxy.id]: {
            status: result.status,
            latencyMs: result.latencyMs,
            message: result.message
          }
        }))
      })
      .catch((error) => {
        setProxyTests((current) => ({
          ...current,
          [proxy.id]: { status: 'failed', message: describeError(error) }
        }))
      })
  }

  const handleDiagnose = async (domain: string): Promise<DomainDiagnosticResult> => {
    if (dirty) await save()
    return window.domainRelay.diagnoseDomain(domain)
  }

  const handleAddApplication = (): void => {
    void run(async () => {
      const application = await window.domainRelay.selectApplication()
      if (!application || !draft) return
      if (draft.applications.some((item) => item.path === application.path)) {
        setToast({ tone: 'success', message: `“${application.name}”已经在应用列表中` })
        return
      }
      setDraft({ ...draft, applications: [...draft.applications, application] })
      setToast({ tone: 'success', message: `已添加“${application.name}”，保存后可通过代理启动` })
    })
  }

  const handleLaunchApplication = (applicationId: string): void => {
    void run(async () => {
      if (dirty) await save()
      const result = await window.domainRelay.launchApplication(applicationId)
      setState(result.state)
      setDraft(result.state.config)
      setToast({ tone: 'success', message: result.message })
    })
  }

  const handleRevealApplication = (applicationId: string): void => {
    void window.domainRelay.showApplication(applicationId).catch((error) =>
      setToast({ tone: 'error', message: describeError(error) })
    )
  }

  const handleRemoveApplication = (applicationId: string): void => {
    const application = draft?.applications.find((item) => item.id === applicationId)
    if (!draft || !application) return
    const runtime = state?.applicationStates.find((item) => item.id === applicationId)
    if (runtime?.status === 'proxied') {
      setToast({ tone: 'error', message: `请先完全退出“${application.name}”，再移除应用代理配置` })
      return
    }
    setDraft({ ...draft, applications: draft.applications.filter((item) => item.id !== applicationId) })
  }

  if (!state || !draft) {
    return (
      <main className="loading-screen">
        <RouteIcon width="34" height="34" />
        <p>正在读取 macOS 网络配置…</p>
      </main>
    )
  }

  const enabledRules = draft.rules.filter((rule) => rule.enabled).length
  const activeServices = state.networkProxyStates.filter(
    (item) => item.autoProxy.enabled && item.autoProxy.url === state.pacUrl
  ).length
  const proxiedApplications = state.applicationStates.filter((application) => application.status === 'proxied').length
  const applicationStateById = new Map(state.applicationStates.map((application) => [application.id, application]))
  const visibleApplications = draft.applications.map((application) => ({
    ...application,
    status: applicationStateById.get(application.id)?.status ?? ('stopped' as const)
  }))

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="brand-lockup">
          <span className="brand-mark"><RouteIcon /></span>
          <strong>Domain Relay</strong>
        </div>
        <div className="titlebar-status">
          <span className={`status-light ${state.trafficReady || proxiedApplications > 0 ? 'status-light-on' : state.active ? 'status-light-warning' : ''}`} />
          {state.trafficReady
            ? '当前系统流量已接管并计量'
            : proxiedApplications > 0
              ? `${proxiedApplications} 个应用通过代理运行`
              : state.active
                ? '当前网络入口未接管'
                : '系统代理未启用'}
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <nav className="sidebar-nav" aria-label="设置导航">
            <span className="nav-label">配置</span>
            <button
              className={activePage === 'system' ? 'nav-item-active' : ''}
              type="button"
              aria-current={activePage === 'system' ? 'page' : undefined}
              onClick={() => setActivePage('system')}
            >
              <SystemIcon /><span>系统设置</span>
            </button>
            <button
              className={activePage === 'proxies' ? 'nav-item-active' : ''}
              type="button"
              aria-current={activePage === 'proxies' ? 'page' : undefined}
              onClick={() => setActivePage('proxies')}
            >
              <ServerIcon /><span>代理服务器</span><small>{draft.proxies.length}</small>
            </button>
            <button
              className={activePage === 'rules' ? 'nav-item-active' : ''}
              type="button"
              aria-current={activePage === 'rules' ? 'page' : undefined}
              onClick={() => setActivePage('rules')}
            >
              <DomainIcon /><span>域名规则</span><small>{enabledRules}</small>
            </button>
            <button
              className={activePage === 'applications' ? 'nav-item-active' : ''}
              type="button"
              aria-current={activePage === 'applications' ? 'page' : undefined}
              onClick={() => setActivePage('applications')}
            >
              <ApplicationIcon /><span>应用代理</span><small>{draft.applications.length}</small>
            </button>
            <button
              className={activePage === 'diagnostics' ? 'nav-item-active' : ''}
              type="button"
              aria-current={activePage === 'diagnostics' ? 'page' : undefined}
              onClick={() => setActivePage('diagnostics')}
            >
              <TestIcon /><span>连接诊断</span>
            </button>
            <span className="nav-label nav-label-monitor">监控</span>
            <button
              className={activePage === 'traffic' ? 'nav-item-active' : ''}
              type="button"
              aria-current={activePage === 'traffic' ? 'page' : undefined}
              onClick={() => setActivePage('traffic')}
            >
              <TrafficIcon /><span>流量统计</span><small>{trafficSnapshot?.activeConnections ?? 0}</small>
            </button>
          </nav>

          <SidebarTraffic snapshot={trafficSnapshot} onOpen={() => setActivePage('traffic')} />
          <div className="sidebar-summary">
            <div className="summary-row"><span>网络入口</span><strong>{draft.networkServices.length}</strong></div>
            <div className="summary-row"><span>启用规则</span><strong>{enabledRules}</strong></div>
            <div className="direct-summary"><span>其他域名</span><strong>系统默认路径</strong></div>
          </div>
          <p className="sidebar-note">未配置的域名返回 DIRECT，继续使用系统路由或其他 VPN。</p>
        </aside>

        <main className="main-editor" ref={mainEditorRef}>
          <div className="editor-toolbar">
            {activePage === 'traffic' ? (
              <>
                <div className="save-state">
                  <span className={`status-light ${trafficSnapshot?.relayRunning ? 'status-light-on' : ''}`} />
                  {trafficSnapshot?.relayRunning ? '本地计量转发器运行中' : '本地计量转发器未启动'}
                </div>
                <div className="toolbar-actions">
                  <span className="traffic-updated-at">{trafficSnapshot ? `更新于 ${new Date(trafficSnapshot.updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}` : '等待实时数据'}</span>
                  <button className="button button-ghost" type="button" onClick={() => void refreshTraffic()}><RefreshIcon />刷新</button>
                </div>
              </>
            ) : (
              <>
                <div className="save-state">
                  <span className="change-dot" data-dirty={dirty} />
                  {dirty ? (state.active ? '有未保存的修改，保存后立即生效' : '有未保存的修改') : '所有修改已保存'}
                </div>
                <div className="toolbar-actions">
                  <button className="button button-ghost" type="button" onClick={() => void window.domainRelay.showConfigFile()}>
                    <FolderIcon /> 配置文件
                  </button>
                  <button className="button button-ghost" type="button" onClick={handlePreview}>
                    <EyeIcon /> PAC 预览
                  </button>
                  <button className="button button-save" type="button" onClick={handleSave} disabled={!dirty || busy}>
                    {state.active ? '保存并热更新' : '保存'}
                  </button>
                </div>
              </>
            )}
          </div>

          {activePage === 'system' ? (
          <section className="editor-section system-section" id="system-settings">
            <div className="section-heading">
              <div>
                <h1>系统设置</h1>
                <p className="section-copy">选择需要使用域名规则的 macOS 网络入口，可同时选择多项。</p>
              </div>
            </div>

            <div className={`activation-card ${state.active ? 'activation-card-on' : ''}`}>
              <div className="activation-state">
                <span className="activation-icon"><RouteIcon /></span>
                <div>
                  <strong>{state.trafficReady ? '域名代理与流量计量正在运行' : state.active ? '规则已应用，但当前入口未接管' : '域名代理尚未启用'}</strong>
                  <p>{state.active ? `已应用到 ${activeServices} 个网络入口；修改域名规则后保存即可立即刷新。` : '保存配置和应用代理无需授权；应用系统 PAC 时 macOS 会请求一次管理员授权。'}</p>
                </div>
              </div>
              {state.active ? (
                <button className="button button-restore" type="button" onClick={handleRestore} disabled={busy}>
                  {busy ? '正在恢复…' : '恢复系统设置'}
                </button>
              ) : (
                <button
                  className="button button-primary"
                  type="button"
                  onClick={handleActivate}
                  disabled={busy || enabledRules === 0 || draft.networkServices.length === 0}
                >
                  {busy ? '正在应用…' : '应用到 macOS'}
                </button>
              )}
            </div>

            <div className="authorization-strip" role="note">
              <div>
                <strong>{state.active ? '日常关闭不需要密码' : '需要完全免授权？'}</strong>
                <p>
                  {state.active
                    ? '点击窗口左上角关闭按钮即可收进菜单栏。热更新或恢复系统 PAC 时，macOS 可能请求管理员授权。'
                    : '使用“应用代理”启动 Codex 等应用，不修改 macOS 网络设置，启动和退出都不需要管理员密码。'}
                </p>
              </div>
              <button className="button button-quiet" type="button" onClick={() => setActivePage('applications')}>
                打开应用代理
              </button>
            </div>

            {state.defaultNetworkService && !draft.networkServices.includes(state.defaultNetworkService) ? (
              <div className="default-network-alert">
                <div>
                  <strong>当前流量正在通过“{state.defaultNetworkService}”</strong>
                  <p>这个入口尚未选中，现有域名规则不会进入当前网络路径。</p>
                </div>
                <button
                  className="button button-quiet"
                  type="button"
                  disabled={Boolean(state.activation)}
                  onClick={() => setDraft({
                    ...draft,
                    networkServices: [...draft.networkServices, state.defaultNetworkService!]
                  })}
                >
                  {state.activation ? '请先恢复系统设置' : '选中当前入口'}
                </button>
              </div>
            ) : null}

            <div className="system-grid">
              <div className="settings-group">
                <div className="group-heading">
                  <div><strong>系统网络入口</strong><p>可多选；启用期间不能修改。</p></div>
                  <span>{draft.networkServices.length} 项已选</span>
                </div>
                <NetworkServicePicker
                  services={state.networkServices}
                  selected={draft.networkServices}
                  disabled={Boolean(state.activation)}
                  onChange={(networkServices) => setDraft({ ...draft, networkServices })}
                />
              </div>
              <div className="settings-group pac-settings">
                <div className="group-heading"><div><strong>本地 PAC 服务</strong><p>仅监听当前电脑的回环地址。</p></div></div>
                <label className="field">
                  <span>PAC 服务端口</span>
                  <input
                    type="number"
                    min="1024"
                    max="65535"
                    value={draft.pacPort}
                    disabled={Boolean(state.activation)}
                    onChange={(event) => setDraft({ ...draft, pacPort: Number(event.target.value) })}
                  />
                </label>
                <label className="field relay-port-field">
                  <span>流量转发端口</span>
                  <input
                    type="number"
                    min="1024"
                    max="65535"
                    value={draft.relayPort}
                    disabled={Boolean(state.activation)}
                    onChange={(event) => setDraft({ ...draft, relayPort: Number(event.target.value) })}
                  />
                </label>
                <div className="pac-address"><span>PAC 地址</span><code>{state.pacUrl}</code></div>
                <div className="pac-address relay-address"><span>计量转发</span><code>127.0.0.1:{draft.relayPort}</code></div>
              </div>
            </div>

            {state.conflicts.length > 0 ? (
              <div className="conflict-card">
                <strong>检测到现有代理设置</strong>
                {state.conflicts.map((conflict) => <p key={conflict}>{conflict}</p>)}
              </div>
            ) : null}
          </section>
          ) : null}

          {activePage === 'proxies' ? (
            <ProxyEditor proxies={draft.proxies} tests={proxyTests} onChange={handleProxyChange} onTest={handleTestProxy} />
          ) : null}
          {activePage === 'rules' ? (
            <RuleEditor rules={draft.rules} proxies={draft.proxies} onChange={(rules) => setDraft({ ...draft, rules })} />
          ) : null}
          {activePage === 'diagnostics' ? (
            <DiagnosticsPanel
              state={state}
              initialDomain={draft.rules.find((rule) => rule.enabled)?.domain ?? ''}
              onDiagnose={handleDiagnose}
              onOpenSystem={() => setActivePage('system')}
            />
          ) : null}
          {activePage === 'applications' ? (
            <ApplicationsPanel
              applications={visibleApplications}
              relayPort={draft.relayPort}
              busy={busy}
              onAdd={handleAddApplication}
              onLaunch={handleLaunchApplication}
              onReveal={handleRevealApplication}
              onRemove={handleRemoveApplication}
            />
          ) : null}
          {activePage === 'traffic' ? (
            <TrafficPanel snapshot={trafficSnapshot} onSnapshotChange={setTrafficSnapshot} />
          ) : null}
        </main>
      </div>

      <footer className="app-footer">
        <span>配置版本 v{draft.version}</span>
        <span>本地 PAC + 计量转发 · 仅记录域名、时间与流量 · 不解析 HTTPS 内容</span>
      </footer>

      {pacPreview !== null ? <PacPreview pac={pacPreview} onClose={() => setPacPreview(null)} /> : null}
      {toast ? <div className={`toast toast-${toast.tone}`}>{toast.message}</div> : null}
    </div>
  )
}
