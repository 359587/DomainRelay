import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  DomainRule,
  ProxyProfile,
  TrafficDomainStat,
  TrafficHistory,
  TrafficHistoryRange,
  TrafficRatePoint,
  TrafficSession,
  TrafficSnapshot
} from '../shared/types'

const MAX_HISTORY_SESSIONS = 20_000
const HISTORY_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000
const REALTIME_WINDOW_MS = 5 * 60 * 1_000
const MAX_RATE_POINTS = 60

function isStoredSession(value: unknown): value is TrafficSession {
  if (!value || typeof value !== 'object') return false
  const session = value as Partial<TrafficSession>
  return Boolean(
    session.id &&
      session.domain &&
      session.proxyId &&
      session.proxyName &&
      session.startedAt &&
      session.endedAt &&
      (session.status === 'completed' || session.status === 'failed') &&
      Number.isFinite(session.uploadBytes) &&
      Number.isFinite(session.downloadBytes)
  )
}

function normalizeStoredSession(session: TrafficSession): TrafficSession {
  const outcome =
    session.outcome === 'responded' || session.outcome === 'no-response' || session.outcome === 'failed'
      ? session.outcome
      : session.status === 'failed'
        ? 'failed'
        : session.downloadBytes > 0
          ? 'responded'
          : 'no-response'
  return { ...session, outcome }
}

function cloneSession(session: TrafficSession): TrafficSession {
  return { ...session }
}

function rangeStart(range: TrafficHistoryRange, now: Date): number | null {
  if (range === 'all') return null
  if (range === 'today') {
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    return start.getTime()
  }
  const days = range === '7d' ? 7 : 30
  return now.getTime() - days * 24 * 60 * 60 * 1_000
}

function aggregateDomains(sessions: TrafficSession[]): TrafficDomainStat[] {
  const byDomain = new Map<string, TrafficDomainStat>()
  for (const session of sessions) {
    const current = byDomain.get(session.domain)
    if (current) {
      current.uploadBytes += session.uploadBytes
      current.downloadBytes += session.downloadBytes
      current.connections += 1
      current.activeConnections += session.status === 'active' ? 1 : 0
      current.noResponseConnections += session.status !== 'active' && session.outcome === 'no-response' ? 1 : 0
      current.failedConnections += session.status === 'failed' ? 1 : 0
      if (session.startedAt > current.lastSeenAt) {
        current.lastSeenAt = session.startedAt
        current.proxyName = session.proxyName
        current.proxyProtocol = session.proxyProtocol
      }
    } else {
      byDomain.set(session.domain, {
        domain: session.domain,
        proxyName: session.proxyName,
        proxyProtocol: session.proxyProtocol,
        uploadBytes: session.uploadBytes,
        downloadBytes: session.downloadBytes,
        connections: 1,
        activeConnections: session.status === 'active' ? 1 : 0,
        noResponseConnections: session.status !== 'active' && session.outcome === 'no-response' ? 1 : 0,
        failedConnections: session.status === 'failed' ? 1 : 0,
        lastSeenAt: session.startedAt
      })
    }
  }
  return [...byDomain.values()].sort((left, right) => {
    if (right.activeConnections !== left.activeConnections) return right.activeConnections - left.activeConnections
    const bytes = right.uploadBytes + right.downloadBytes - left.uploadBytes - left.downloadBytes
    return bytes || right.lastSeenAt.localeCompare(left.lastSeenAt)
  })
}

export class TrafficHistoryStore {
  readonly filePath: string
  private sessions: TrafficSession[] = []
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(userDataPath: string) {
    this.filePath = join(userDataPath, 'traffic-history.jsonl')
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const cutoff = Date.now() - HISTORY_RETENTION_MS
      this.sessions = raw
        .split('\n')
        .filter(Boolean)
        .flatMap((line) => {
          try {
            const value: unknown = JSON.parse(line)
            return isStoredSession(value) && Date.parse(value.startedAt) >= cutoff
              ? [normalizeStoredSession(value)]
              : []
          } catch {
            return []
          }
        })
        .slice(-MAX_HISTORY_SESSIONS)
      await this.rewrite()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`读取流量历史失败：${error instanceof Error ? error.message : String(error)}`)
      }
      await this.rewrite()
    }
  }

  getSessions(): TrafficSession[] {
    return this.sessions.map(cloneSession)
  }

  append(session: TrafficSession): void {
    const stored = cloneSession(session)
    this.sessions.push(stored)
    if (this.sessions.length > MAX_HISTORY_SESSIONS) this.sessions = this.sessions.slice(-MAX_HISTORY_SESSIONS)
    this.writeQueue = this.writeQueue
      .then(async () => {
        await fs.mkdir(dirname(this.filePath), { recursive: true })
        await fs.appendFile(this.filePath, `${JSON.stringify(stored)}\n`, { mode: 0o600 })
        await fs.chmod(this.filePath, 0o600)
        const stats = await fs.stat(this.filePath)
        if (stats.size > 12 * 1024 * 1024) await this.rewriteNow()
      })
      .catch(() => undefined)
  }

  async clear(): Promise<void> {
    this.sessions = []
    this.writeQueue = this.writeQueue.then(() => this.rewriteNow())
    await this.writeQueue
  }

  private async rewrite(): Promise<void> {
    this.writeQueue = this.writeQueue.then(() => this.rewriteNow())
    await this.writeQueue
  }

  private async rewriteNow(): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.tmp`
    const body = this.sessions.length > 0 ? `${this.sessions.map((session) => JSON.stringify(session)).join('\n')}\n` : ''
    await fs.writeFile(temporaryPath, body, { mode: 0o600 })
    await fs.rename(temporaryPath, this.filePath)
    await fs.chmod(this.filePath, 0o600)
  }
}

export interface TrafficTracker {
  readonly session: TrafficSession
  addUpload: (bytes: number) => void
  addDownload: (bytes: number) => void
  finish: (error?: Error | string | null) => void
}

export class TrafficMonitor {
  private readonly active = new Map<string, TrafficSession>()
  private readonly ratePoints: TrafficRatePoint[] = []
  private sampledUploadBytes = 0
  private sampledDownloadBytes = 0
  private previousSampleUploadBytes = 0
  private previousSampleDownloadBytes = 0
  private readonly sampleTimer: NodeJS.Timeout

  constructor(private readonly historyStore: TrafficHistoryStore) {
    this.sampleTimer = setInterval(() => this.sampleRates(), 1_000)
    this.sampleTimer.unref()
  }

  startSession(domain: string, rule: DomainRule, proxy: ProxyProfile): TrafficTracker {
    const session: TrafficSession = {
      id: randomUUID(),
      domain: domain.toLowerCase(),
      ruleDomain: rule.domain,
      proxyId: proxy.id,
      proxyName: proxy.name,
      proxyProtocol: proxy.protocol,
      startedAt: new Date().toISOString(),
      endedAt: null,
      uploadBytes: 0,
      downloadBytes: 0,
      status: 'active',
      outcome: 'no-response',
      error: null
    }
    this.active.set(session.id, session)
    let finished = false

    return {
      session,
      addUpload: (bytes) => {
        if (finished || bytes <= 0) return
        session.uploadBytes += bytes
        this.sampledUploadBytes += bytes
      },
      addDownload: (bytes) => {
        if (finished || bytes <= 0) return
        session.downloadBytes += bytes
        session.outcome = 'responded'
        this.sampledDownloadBytes += bytes
      },
      finish: (error = null) => {
        if (finished) return
        finished = true
        this.active.delete(session.id)
        session.endedAt = new Date().toISOString()
        session.status = error ? 'failed' : 'completed'
        session.outcome = error ? 'failed' : session.downloadBytes > 0 ? 'responded' : 'no-response'
        session.error = error ? (error instanceof Error ? error.message : String(error)) : null
        this.historyStore.append(session)
      }
    }
  }

  getSnapshot(relayRunning: boolean): TrafficSnapshot {
    const now = new Date()
    const allHistory = this.historyStore.getSessions()
    const todayStart = rangeStart('today', now)!
    const todaySessions = allHistory.filter((session) => Date.parse(session.startedAt) >= todayStart)
    const activeSessions = [...this.active.values()].map(cloneSession)
    const activeToday = activeSessions.filter((session) => Date.parse(session.startedAt) >= todayStart)
    const recentCutoff = now.getTime() - REALTIME_WINDOW_MS
    const recentSessions = allHistory
      .filter((session) => Date.parse(session.startedAt) >= recentCutoff)
      .slice(-40)
      .reverse()
    const realtimeSessions = [...activeSessions, ...recentSessions]
    const latestPoint = this.ratePoints.at(-1)
    const sum = (sessions: TrafficSession[], key: 'uploadBytes' | 'downloadBytes'): number =>
      sessions.reduce((total, session) => total + session[key], 0)

    return {
      relayRunning,
      activeConnections: activeSessions.length,
      uploadBps: latestPoint?.uploadBytes ?? 0,
      downloadBps: latestPoint?.downloadBytes ?? 0,
      todayUploadBytes: sum(todaySessions, 'uploadBytes') + sum(activeToday, 'uploadBytes'),
      todayDownloadBytes: sum(todaySessions, 'downloadBytes') + sum(activeToday, 'downloadBytes'),
      ratePoints: this.ratePoints.map((point) => ({ ...point })),
      activeSessions,
      recentSessions,
      realtimeDomains: aggregateDomains(realtimeSessions).slice(0, 100),
      updatedAt: now.toISOString()
    }
  }

  getHistory(range: TrafficHistoryRange): TrafficHistory {
    const now = new Date()
    const from = rangeStart(range, now)
    const sessions = this.historyStore
      .getSessions()
      .filter((session) => from === null || Date.parse(session.startedAt) >= from)
    return {
      range,
      from: from === null ? null : new Date(from).toISOString(),
      sessions: sessions.slice(-1_000).reverse(),
      domains: aggregateDomains(sessions),
      uploadBytes: sessions.reduce((total, session) => total + session.uploadBytes, 0),
      downloadBytes: sessions.reduce((total, session) => total + session.downloadBytes, 0),
      connections: sessions.length
    }
  }

  async clearHistory(relayRunning: boolean): Promise<TrafficSnapshot> {
    await this.historyStore.clear()
    return this.getSnapshot(relayRunning)
  }

  dispose(): void {
    clearInterval(this.sampleTimer)
  }

  private sampleRates(): void {
    this.ratePoints.push({
      at: new Date().toISOString(),
      uploadBytes: Math.max(0, this.sampledUploadBytes - this.previousSampleUploadBytes),
      downloadBytes: Math.max(0, this.sampledDownloadBytes - this.previousSampleDownloadBytes)
    })
    this.previousSampleUploadBytes = this.sampledUploadBytes
    this.previousSampleDownloadBytes = this.sampledDownloadBytes
    if (this.ratePoints.length > MAX_RATE_POINTS) this.ratePoints.splice(0, this.ratePoints.length - MAX_RATE_POINTS)
  }
}
