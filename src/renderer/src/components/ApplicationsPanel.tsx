import type { ManagedApplicationState } from '../../../shared/types'
import { ApplicationIcon, FolderIcon, MoreIcon, PlayIcon, PlusIcon, TrashIcon } from './Icons'

interface ApplicationsPanelProps {
  applications: ManagedApplicationState[]
  relayPort: number
  busy: boolean
  onAdd: () => void
  onLaunch: (applicationId: string) => void
  onReveal: (applicationId: string) => void
  onRemove: (applicationId: string) => void
}

const statusCopy: Record<ManagedApplicationState['status'], string> = {
  stopped: '未运行',
  running: '需退出后重启',
  proxied: '已从代理启动'
}

export function ApplicationsPanel({
  applications,
  relayPort,
  busy,
  onAdd,
  onLaunch,
  onReveal,
  onRemove
}: ApplicationsPanelProps): React.JSX.Element {
  return (
    <section className="editor-section applications-section" id="application-proxy">
      <div className="section-heading application-heading">
        <div>
          <h1>应用代理</h1>
          <p className="section-copy">用于 Codex、Git 和其他不读取 macOS PAC 的应用及其后台进程。</p>
        </div>
        <button className="button button-accent" type="button" onClick={onAdd} disabled={busy}>
          <PlusIcon />添加应用
        </button>
      </div>

      <div className="application-explainer">
        <div className="application-explainer-copy">
          <ApplicationIcon />
          <div>
            <strong>免管理员授权，不修改 macOS 系统代理</strong>
            <p>从这里启动应用及其子进程：命中规则的域名走指定代理，其他域名由本机直接连接。</p>
          </div>
        </div>
        <code>127.0.0.1:{relayPort}</code>
      </div>

      <div className="application-path-flow" aria-label="应用代理链路">
        <span><ApplicationIcon /><b>应用及子进程</b></span>
        <i aria-hidden="true">→</i>
        <span><b>本地域名分流</b><small>仅判断主机名</small></span>
        <i aria-hidden="true">→</i>
        <span><b>代理或 DIRECT</b><small>沿用系统 / VPN 路由</small></span>
      </div>

      <div className="application-list-heading">
        <div><strong>已管理应用</strong><p>应用已在运行时，必须先完全退出，再点击“通过代理启动”。</p></div>
        <span>{applications.length} 个应用</span>
      </div>

      {applications.length === 0 ? (
        <div className="application-empty">
          <span><ApplicationIcon /></span>
          <strong>还没有应用启动配置</strong>
          <p>添加 Codex 或其他 macOS 应用，不会立即启动，也不会修改应用本身。</p>
          <button className="button button-ghost" type="button" onClick={onAdd}><PlusIcon />选择 .app</button>
        </div>
      ) : (
        <div className="application-rows">
          {applications.map((application) => (
            <article className="application-row" key={application.id}>
              <span className="application-row-icon"><ApplicationIcon /></span>
              <div className="application-row-copy">
                <strong>{application.name}</strong>
                <small title={application.path}>{application.path}</small>
              </div>
              <span className={`application-status application-status-${application.status}`}>
                <i />{statusCopy[application.status]}
              </span>
              <button
                className="button application-launch-button"
                type="button"
                disabled={busy || application.status !== 'stopped'}
                onClick={() => onLaunch(application.id)}
              >
                <PlayIcon />{application.status === 'proxied' ? '正在使用' : application.status === 'running' ? '请先退出' : '通过代理启动'}
              </button>
              <details className="row-menu application-row-menu">
                <summary aria-label={`${application.name} 菜单`}><MoreIcon /></summary>
                <div className="row-menu-popover">
                  <button type="button" onClick={() => onReveal(application.id)}><FolderIcon />在 Finder 中显示</button>
                  <button className="row-menu-danger" type="button" onClick={() => onRemove(application.id)}><TrashIcon />移除配置</button>
                </div>
              </details>
            </article>
          ))}
        </div>
      )}

      <div className="application-caution">
        <strong>边界说明</strong>
        <p>此模式只影响从 Domain Relay 启动的进程树。已运行的旧进程不会自动切换；退出 Domain Relay 会中断这些应用的代理连接。</p>
      </div>
    </section>
  )
}
