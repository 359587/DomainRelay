import { useState } from 'react'
import type { DomainDiagnosticResult, RuntimeState } from '../../../shared/types'
import { TestIcon } from './Icons'

interface DiagnosticsPanelProps {
  state: RuntimeState
  initialDomain: string
  onDiagnose: (domain: string) => Promise<DomainDiagnosticResult>
  onOpenSystem: () => void
}

export function DiagnosticsPanel({
  state,
  initialDomain,
  onDiagnose,
  onOpenSystem
}: DiagnosticsPanelProps): React.JSX.Element {
  const [domain, setDomain] = useState(initialDomain)
  const [result, setResult] = useState<DomainDiagnosticResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = (): void => {
    setBusy(true)
    setError(null)
    void onDiagnose(domain)
      .then(setResult)
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false))
  }

  const currentSelected = Boolean(
    state.defaultNetworkService && state.config.networkServices.includes(state.defaultNetworkService)
  )

  return (
    <section className="editor-section diagnostics-section">
      <div className="section-heading">
        <div>
          <h1>连接诊断</h1>
          <p className="section-copy">依次检查当前网络入口、PAC 状态、域名规则和目标代理隧道。</p>
        </div>
      </div>

      <div className="diagnostic-overview">
        <div>
          <span>当前网络入口</span>
          <strong>{state.defaultNetworkService ?? '无法识别'}</strong>
          <small>{currentSelected ? '已包含在配置中' : '未包含在配置中'}</small>
        </div>
        <div>
          <span>PAC 状态</span>
          <strong>{state.trafficReady ? '当前流量已接管' : state.active ? '当前入口未接管' : '尚未应用'}</strong>
          <small>{state.pacUrl}</small>
        </div>
      </div>

      {!currentSelected && state.defaultNetworkService ? (
        <div className="diagnostic-warning">
          <div><strong>当前使用的网络入口没有被选择</strong><p>先添加“{state.defaultNetworkService}”，再重新应用规则。</p></div>
          <button className="button button-quiet" type="button" onClick={onOpenSystem}>前往系统设置</button>
        </div>
      ) : null}

      <div className="diagnostic-composer">
        <label>
          <span>测试域名</span>
          <input
            value={domain}
            placeholder="google.com"
            spellCheck={false}
            onChange={(event) => {
              setDomain(event.target.value)
              setResult(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && domain.trim() && !busy) run()
            }}
          />
        </label>
        <button className="button button-primary" type="button" onClick={run} disabled={!domain.trim() || busy}>
          <TestIcon /> {busy ? '正在诊断…' : '开始诊断'}
        </button>
      </div>

      {error ? <div className="diagnostic-error">{error}</div> : null}
      {result ? (
        <div className={`diagnostic-result result-${result.status}`}>
          <div className="diagnostic-result-head">
            <div><strong>{result.domain}</strong><span>{result.status === 'ok' ? '链路正常' : result.status === 'warning' ? '需要处理' : '发现问题'}</span></div>
            <time>{new Date(result.checkedAt).toLocaleTimeString()}</time>
          </div>
          <div className="diagnostic-checks">
            {result.checks.map((check) => (
              <div className={`diagnostic-check check-${check.status}`} key={check.id}>
                <i aria-hidden="true" />
                <div><strong>{check.title}</strong><p>{check.detail}</p></div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}
