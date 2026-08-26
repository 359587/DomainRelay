import { useEffect, useMemo, useState } from 'react'
import type {
  TrafficDomainStat,
  TrafficHistory,
  TrafficHistoryRange,
  TrafficRatePoint,
  TrafficSession,
  TrafficSnapshot
} from '../../../shared/types'
import { RefreshIcon, TrashIcon } from './Icons'

interface TrafficPanelProps {
  snapshot: TrafficSnapshot | null
  onSnapshotChange: (snapshot: TrafficSnapshot) => void
}

type TrafficView = 'realtime' | 'history'

const rangeLabels: Record<TrafficHistoryRange, string> = {
  today: '今天',
  '7d': '近 7 天',
  '30d': '近 30 天',
  all: '全部'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function formatSpeed(bytes: number): string {
  return `${formatBytes(bytes)}/s`
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date(value))
}

function formatDuration(session: TrafficSession): string {
  const end = session.endedAt ? Date.parse(session.endedAt) : Date.now()
  const seconds = Math.max(0, Math.round((end - Date.parse(session.startedAt)) / 1_000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  return `${minutes} 分 ${seconds % 60} 秒`
}

function chartPath(
  points: TrafficRatePoint[],
  key: 'uploadBytes' | 'downloadBytes',
  maximum: number,
  width = 640,
  height = 150,
  padding = 8
): string {
  if (points.length === 0) return ''
  return points
    .map((point, index) => {
      const x = points.length === 1 ? 0 : (index / (points.length - 1)) * width
      const y = height - padding - (point[key] / maximum) * (height - padding * 2)
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
}

function TrafficChart({ points }: { points: TrafficRatePoint[] }): React.JSX.Element {
  const normalized = points.length > 1 ? points : [
    { at: new Date(Date.now() - 1_000).toISOString(), uploadBytes: 0, downloadBytes: 0 },
    ...(points.length > 0 ? points : [{ at: new Date().toISOString(), uploadBytes: 0, downloadBytes: 0 }])
  ]
  const maximum = Math.max(1, ...normalized.flatMap((point) => [point.uploadBytes, point.downloadBytes]))
  return (
    <div className="traffic-chart" aria-label="最近 60 秒上下行速率">
      <svg viewBox="0 0 640 150" preserveAspectRatio="none" role="img">
        <path className="traffic-grid-line" d="M0 25H640M0 75H640M0 125H640" />
        <path className="traffic-line traffic-line-upload" d={chartPath(normalized, 'uploadBytes', maximum)} />
        <path className="traffic-line traffic-line-download" d={chartPath(normalized, 'downloadBytes', maximum)} />
      </svg>
      <span className="traffic-chart-max">峰值 {formatSpeed(maximum)}</span>
      <span className="traffic-chart-window">最近 60 秒</span>
    </div>
  )
}

function DomainRows({ domains, empty }: { domains: TrafficDomainStat[]; empty: string }): React.JSX.Element {
  if (domains.length === 0) return <div className="traffic-empty">{empty}</div>
  return (
    <div className="traffic-domain-rows">
      {domains.map((domain) => (
        <div className="traffic-domain-row" key={domain.domain}>
          <div className="traffic-domain-name">
            <span className={domain.activeConnections > 0 ? 'live-pulse' : 'recent-dot'} />
            <div><strong>{domain.domain}</strong><small>{domain.proxyName} · {domain.proxyProtocol}</small></div>
          </div>
          <span className={
            domain.activeConnections > 0
              ? 'traffic-status-live'
              : domain.failedConnections > 0
                ? 'traffic-status-failed'
                : domain.noResponseConnections > 0
                  ? 'traffic-status-no-response'
                  : 'traffic-status-recent'
          }>
            {domain.activeConnections > 0
              ? `${domain.activeConnections} 条传输中`
              : domain.failedConnections > 0
                ? `${domain.failedConnections} 条失败`
                : domain.noResponseConnections > 0
                  ? `${domain.noResponseConnections} 条无下行`
                  : '最近访问'}
          </span>
          <span className="traffic-number traffic-upload">↑ {formatBytes(domain.uploadBytes)}</span>
          <span className="traffic-number traffic-download">↓ {formatBytes(domain.downloadBytes)}</span>
          <span className="traffic-number">{domain.connections}</span>
          <time>{formatTime(domain.lastSeenAt)}</time>
        </div>
      ))}
    </div>
  )
}

function SessionRows({ sessions }: { sessions: TrafficSession[] }): React.JSX.Element {
  if (sessions.length === 0) return <div className="traffic-empty">这个时间范围内还没有代理连接。</div>
  return (
    <div className="traffic-session-rows">
      {sessions.slice(0, 120).map((session) => (
        <div className="traffic-session-row" key={session.id}>
          <div><strong>{session.domain}</strong><small>{session.proxyName} · {session.proxyProtocol}</small></div>
          <span
            className={`session-state session-state-${session.status === 'completed' && session.outcome === 'no-response' ? 'no-response' : session.status}`}
            title={session.error ?? undefined}
          >
            {session.status === 'failed'
              ? '失败'
              : session.status === 'active'
                ? '进行中'
                : session.outcome === 'no-response'
                  ? '无下行'
                  : '已响应'}
          </span>
          <span>↑ {formatBytes(session.uploadBytes)}</span>
          <span>↓ {formatBytes(session.downloadBytes)}</span>
          <span>{formatDuration(session)}</span>
          <time>{formatTime(session.startedAt)}</time>
        </div>
      ))}
    </div>
  )
}

export function TrafficPanel({ snapshot, onSnapshotChange }: TrafficPanelProps): React.JSX.Element {
  const [view, setView] = useState<TrafficView>('realtime')
  const [range, setRange] = useState<TrafficHistoryRange>('today')
  const [history, setHistory] = useState<TrafficHistory | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadHistory = async (nextRange = range): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      setHistory(await window.domainRelay.getTrafficHistory(nextRange))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (view === 'history') void loadHistory()
  }, [view, range])

  const visibleHistoryDomains = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!history) return []
    return history.domains.filter((domain) => !keyword || domain.domain.includes(keyword) || domain.proxyName.toLowerCase().includes(keyword))
  }, [history, search])

  const clearHistory = async (): Promise<void> => {
    if (!window.confirm('确定清空全部流量历史吗？正在传输的连接不会中断。')) return
    setLoading(true)
    setError(null)
    try {
      onSnapshotChange(await window.domainRelay.clearTrafficHistory())
      await loadHistory(range)
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : String(clearError))
    } finally {
      setLoading(false)
    }
  }

  const historyTotal = (history?.uploadBytes ?? 0) + (history?.downloadBytes ?? 0)
  return (
    <section className="editor-section traffic-section" id="traffic-statistics">
      <div className="section-heading traffic-heading">
        <div>
          <h1>流量统计</h1>
          <p className="section-copy">记录经过本地转发器的域名、连接时间和上下行字节；不解密 HTTPS，也不保存 URL 路径或内容。</p>
        </div>
        <div className="traffic-tabs" role="tablist" aria-label="流量统计视图">
          <button className={view === 'realtime' ? 'traffic-tab-active' : ''} type="button" onClick={() => setView('realtime')}>实时</button>
          <button className={view === 'history' ? 'traffic-tab-active' : ''} type="button" onClick={() => setView('history')}>历史</button>
        </div>
      </div>

      {view === 'realtime' ? (
        <>
          <div className="traffic-overview-grid">
            <article className="traffic-metric metric-download"><span>当前下行</span><strong>{formatSpeed(snapshot?.downloadBps ?? 0)}</strong><small>通过代理接收</small></article>
            <article className="traffic-metric metric-upload"><span>当前上行</span><strong>{formatSpeed(snapshot?.uploadBps ?? 0)}</strong><small>通过代理发送</small></article>
            <article className="traffic-metric"><span>活动连接</span><strong>{snapshot?.activeConnections ?? 0}</strong><small>{snapshot?.relayRunning ? '本地转发器运行中' : '本地转发器未启动'}</small></article>
            <article className="traffic-metric"><span>今日累计</span><strong>{formatBytes((snapshot?.todayUploadBytes ?? 0) + (snapshot?.todayDownloadBytes ?? 0))}</strong><small>↑ {formatBytes(snapshot?.todayUploadBytes ?? 0)} · ↓ {formatBytes(snapshot?.todayDownloadBytes ?? 0)}</small></article>
          </div>

          <div className="traffic-chart-card">
            <div className="traffic-card-heading"><div><strong>实时速率</strong><p>本地每秒采样，上下行分别计量。</p></div><div className="traffic-legend"><span className="legend-upload">上行</span><span className="legend-download">下行</span></div></div>
            <TrafficChart points={snapshot?.ratePoints ?? []} />
          </div>

          <div className="traffic-table-card">
            <div className="traffic-card-heading"><div><strong>实时域名</strong><p>显示正在传输和最近 5 分钟经过代理的域名。</p></div><span>{snapshot?.realtimeDomains.length ?? 0} 个域名</span></div>
            <div className="traffic-domain-head"><span>域名 / 代理</span><span>状态</span><span>上行</span><span>下行</span><span>连接</span><span>最近活动</span></div>
            <DomainRows domains={snapshot?.realtimeDomains ?? []} empty={snapshot?.relayRunning ? '等待代理流量。访问已配置域名后会实时显示在这里。' : '请先在系统设置中应用规则，启动本地流量转发器。'} />
          </div>
        </>
      ) : (
        <>
          <div className="history-toolbar">
            <div className="history-ranges">
              {(Object.keys(rangeLabels) as TrafficHistoryRange[]).map((item) => (
                <button className={range === item ? 'history-range-active' : ''} type="button" key={item} onClick={() => setRange(item)}>{rangeLabels[item]}</button>
              ))}
            </div>
            <div className="history-actions">
              <label><span className="sr-only">搜索域名或代理</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索域名或代理" /></label>
              <button className="button button-ghost" type="button" onClick={() => void loadHistory()} disabled={loading}><RefreshIcon />刷新</button>
              <button className="button button-danger-quiet" type="button" onClick={() => void clearHistory()} disabled={loading}><TrashIcon />清空历史</button>
            </div>
          </div>

          <div className="traffic-overview-grid history-overview-grid">
            <article className="traffic-metric"><span>{rangeLabels[range]}总流量</span><strong>{formatBytes(historyTotal)}</strong><small>代理上下行合计</small></article>
            <article className="traffic-metric metric-upload"><span>累计上行</span><strong>{formatBytes(history?.uploadBytes ?? 0)}</strong><small>发送到目标域名</small></article>
            <article className="traffic-metric metric-download"><span>累计下行</span><strong>{formatBytes(history?.downloadBytes ?? 0)}</strong><small>从目标域名接收</small></article>
            <article className="traffic-metric"><span>连接数量</span><strong>{history?.connections ?? 0}</strong><small>{history?.domains.length ?? 0} 个不同域名</small></article>
          </div>

          {error ? <div className="traffic-error">{error}</div> : null}
          <div className="traffic-table-card">
            <div className="traffic-card-heading"><div><strong>域名汇总</strong><p>按域名聚合当前范围内的全部代理连接。</p></div><span>{visibleHistoryDomains.length} 个域名</span></div>
            <div className="traffic-domain-head"><span>域名 / 代理</span><span>状态</span><span>上行</span><span>下行</span><span>连接</span><span>最近活动</span></div>
            <DomainRows domains={visibleHistoryDomains} empty={loading ? '正在读取流量历史…' : '这个时间范围内还没有代理流量。'} />
          </div>

          <div className="traffic-table-card traffic-sessions-card">
            <div className="traffic-card-heading"><div><strong>连接历史</strong><p>最多显示当前范围内最近 120 条连接。</p></div><span>历史保留 90 天</span></div>
            <div className="traffic-session-head"><span>域名 / 代理</span><span>结果</span><span>上行</span><span>下行</span><span>时长</span><span>开始时间</span></div>
            <SessionRows sessions={history?.sessions ?? []} />
          </div>
        </>
      )}
    </section>
  )
}

export function SidebarTraffic({ snapshot, onOpen }: { snapshot: TrafficSnapshot | null; onOpen: () => void }): React.JSX.Element {
  const points = snapshot?.ratePoints.slice(-18) ?? []
  const maximum = Math.max(1, ...points.flatMap((point) => [point.uploadBytes, point.downloadBytes]))
  return (
    <button className="sidebar-traffic" type="button" onClick={onOpen} aria-label="打开流量统计">
      <div className="sidebar-traffic-head"><span><i className={snapshot?.relayRunning ? 'relay-on' : ''} />当前代理流量</span><strong>{snapshot?.activeConnections ?? 0} 条</strong></div>
      <svg viewBox="0 0 180 38" preserveAspectRatio="none" aria-hidden="true">
        <path className="sidebar-line sidebar-line-upload" d={chartPath(points, 'uploadBytes', maximum, 180, 38, 2)} />
        <path className="sidebar-line sidebar-line-download" d={chartPath(points, 'downloadBytes', maximum, 180, 38, 2)} />
      </svg>
      <div className="sidebar-speed-row"><span className="traffic-upload">↑ {formatSpeed(snapshot?.uploadBps ?? 0)}</span><span className="traffic-download">↓ {formatSpeed(snapshot?.downloadBps ?? 0)}</span></div>
      <div className="sidebar-total-row"><span>今日累计</span><strong>{formatBytes((snapshot?.todayUploadBytes ?? 0) + (snapshot?.todayDownloadBytes ?? 0))}</strong></div>
    </button>
  )
}
