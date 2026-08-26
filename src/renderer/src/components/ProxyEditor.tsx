import type { ProxyProfile, ProxyProtocol, ProxyTestStatus } from '../../../shared/types'
import { PlusIcon, TestIcon, TrashIcon } from './Icons'

export interface ProxyTestView {
  status: 'idle' | 'testing' | ProxyTestStatus
  latencyMs?: number
  message?: string
}

interface ProxyEditorProps {
  proxies: ProxyProfile[]
  tests: Record<string, ProxyTestView>
  onChange: (proxies: ProxyProfile[]) => void
  onTest: (proxy: ProxyProfile) => void
}

const protocols: ProxyProtocol[] = ['HTTP', 'HTTPS', 'SOCKS5']

function testLabel(test: ProxyTestView): string {
  if (test.status === 'testing') return '测试中…'
  if (test.status === 'ok') return `可用 · ${test.latencyMs ?? 0} ms`
  if (test.status === 'auth-required') return '需要认证'
  if (test.status === 'failed') return '连接失败'
  return '未测试'
}

export function ProxyEditor({ proxies, tests, onChange, onTest }: ProxyEditorProps): React.JSX.Element {
  const update = (id: string, patch: Partial<ProxyProfile>): void => {
    onChange(proxies.map((proxy) => (proxy.id === id ? { ...proxy, ...patch } : proxy)))
  }

  const add = (): void => {
    onChange([
      ...proxies,
      {
        id: crypto.randomUUID(),
        name: `代理 ${proxies.length + 1}`,
        protocol: 'HTTP',
        host: '127.0.0.1',
        port: 8080
      }
    ])
  }

  return (
    <section className="editor-section proxy-section" id="proxy-settings">
      <div className="section-heading">
        <div>
          <h2>代理服务器</h2>
          <p className="section-copy">配置域名规则使用的代理出口；测试会验证代理能否建立真实网络隧道。</p>
        </div>
        <button className="button button-quiet" type="button" onClick={add}>
          <PlusIcon /> 添加代理
        </button>
      </div>

      <div className="proxy-table" role="table" aria-label="代理服务器">
        <div className="proxy-row proxy-table-head" role="row">
          <span>名称</span>
          <span>协议</span>
          <span>服务器</span>
          <span>端口</span>
          <span>连通性</span>
          <span aria-hidden="true" />
        </div>
        {proxies.map((proxy, index) => {
          const test = tests[proxy.id] ?? { status: 'idle' }
          return (
          <div className="proxy-row" role="row" key={proxy.id}>
            <label>
              <span className="sr-only">名称</span>
              <input
                value={proxy.name}
                onChange={(event) => update(proxy.id, { name: event.target.value })}
                aria-label={`代理 ${index + 1} 名称`}
              />
            </label>
            <label>
              <span className="sr-only">协议</span>
              <select
                value={proxy.protocol}
                onChange={(event) => update(proxy.id, { protocol: event.target.value as ProxyProtocol })}
                aria-label={`代理 ${index + 1} 协议`}
              >
                {protocols.map((protocol) => (
                  <option key={protocol}>{protocol}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">服务器</span>
              <input
                value={proxy.host}
                onChange={(event) => update(proxy.id, { host: event.target.value })}
                placeholder="proxy.example.com"
                spellCheck={false}
                aria-label={`代理 ${index + 1} 服务器`}
              />
            </label>
            <label>
              <span className="sr-only">端口</span>
              <input
                value={proxy.port}
                onChange={(event) => update(proxy.id, { port: Number(event.target.value) })}
                type="number"
                min="1"
                max="65535"
                aria-label={`代理 ${index + 1} 端口`}
              />
            </label>
            <div className="proxy-test-cell" title={test.message}>
              <span className={`test-status test-${test.status}`}>
                <i />
                {testLabel(test)}
              </span>
              <button
                className="test-button"
                type="button"
                onClick={() => onTest(proxy)}
                disabled={test.status === 'testing' || !proxy.host.trim() || proxy.port < 1 || proxy.port > 65535}
                aria-label={`测试代理 ${proxy.name}`}
              >
                <TestIcon />
                测试
              </button>
            </div>
            <button
              className="icon-button danger"
              type="button"
              onClick={() => onChange(proxies.filter((item) => item.id !== proxy.id))}
              disabled={proxies.length === 1}
              aria-label={`删除代理 ${proxy.name}`}
              title={proxies.length === 1 ? '至少保留一个代理' : '删除代理'}
            >
              <TrashIcon />
            </button>
          </div>
        )})}
      </div>
    </section>
  )
}
