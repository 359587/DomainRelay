import { useState } from 'react'
import type { DomainRule, ProxyProfile } from '../../../shared/types'
import { parseDomainRuleInput, splitDomainRuleInputs } from '../../../shared/domain-rules'
import { BatchImportModal } from './BatchImportModal'
import { ImportIcon, PlusIcon, TrashIcon } from './Icons'

interface RuleEditorProps {
  rules: DomainRule[]
  proxies: ProxyProfile[]
  onChange: (rules: DomainRule[]) => void
}

export function RuleEditor({ rules, proxies, onChange }: RuleEditorProps): React.JSX.Element {
  const [input, setInput] = useState('')
  const [proxyId, setProxyId] = useState(proxies[0]?.id ?? '')
  const [showBatchImport, setShowBatchImport] = useState(false)

  const update = (id: string, patch: Partial<DomainRule>): void => {
    onChange(rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)))
  }

  const addRules = (): void => {
    const currentDomains = new Set(rules.map((rule) => rule.domain))
    const nextRules: DomainRule[] = []
    for (const value of splitDomainRuleInputs(input)) {
      const parsed = parseDomainRuleInput(value)
      if (!parsed || currentDomains.has(parsed.domain)) continue
      currentDomains.add(parsed.domain)
      nextRules.push({
        id: crypto.randomUUID(),
        domain: parsed.domain,
        matchSubdomains: parsed.matchSubdomains,
        proxyId: proxyId || proxies[0]!.id,
        enabled: true
      })
    }
    if (nextRules.length === 0) return
    onChange([...rules, ...nextRules])
    setInput('')
  }

  return (
    <section className="editor-section rules-section" id="rule-settings">
      <div className="section-heading rules-heading">
        <div>
          <h2>域名规则</h2>
          <p className="section-copy">主域名自动匹配全部子域名；具体的二级、三级地址默认只精确匹配。</p>
        </div>
        <div className="section-actions">
          <div className="rule-count"><strong>{rules.filter((rule) => rule.enabled).length}</strong><span>启用</span></div>
          <button className="button button-quiet" type="button" onClick={() => setShowBatchImport(true)}>
            <ImportIcon /> 批量导入
          </button>
        </div>
      </div>

      <div className="rule-composer">
        <label className="composer-domain">
          <span className="sr-only">添加域名</span>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addRules()
            }}
            placeholder="example.com 或 api.example.com"
            spellCheck={false}
          />
        </label>
        <label>
          <span className="sr-only">选择代理</span>
          <select value={proxyId || proxies[0]?.id} onChange={(event) => setProxyId(event.target.value)}>
            {proxies.map((proxy) => (
              <option key={proxy.id} value={proxy.id}>{proxy.name || '未命名代理'}</option>
            ))}
          </select>
        </label>
        <button className="button button-accent" type="button" onClick={addRules} disabled={!input.trim()}>
          <PlusIcon /> 添加规则
        </button>
      </div>

      <div className="rule-table" role="table" aria-label="域名代理规则">
        <div className="rule-row rule-table-head" role="row">
          <span>状态</span>
          <span>域名</span>
          <span>匹配范围</span>
          <span>代理出口</span>
          <span aria-hidden="true" />
        </div>
        {rules.length === 0 ? (
          <div className="empty-rules">
            <div className="empty-pulse" />
            <p>还没有域名规则</p>
            <span>可以逐条添加，或使用批量导入。</span>
          </div>
        ) : (
          rules.map((rule) => (
            <div className={`rule-row ${rule.enabled ? '' : 'rule-disabled'}`} role="row" key={rule.id}>
              <label className="switch" title={rule.enabled ? '停用规则' : '启用规则'}>
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(event) => update(rule.id, { enabled: event.target.checked })}
                  aria-label={`${rule.enabled ? '停用' : '启用'} ${rule.domain}`}
                />
                <span />
              </label>
              <div className="domain-cell">
                <span className="domain-dot" />
                <input
                  value={rule.matchSubdomains ? `*.${rule.domain}` : rule.domain}
                  onChange={(event) => {
                    const value = event.target.value
                    const matchSubdomains = value.trimStart().startsWith('*.')
                    update(rule.id, { domain: value.replace(/^\s*\*\./, ''), matchSubdomains })
                  }}
                  spellCheck={false}
                  aria-label="域名"
                />
                <small>{rule.matchSubdomains ? '同时包含主域名本身' : '不包含更深层子域名'}</small>
              </div>
              <select
                value={rule.matchSubdomains ? 'wildcard' : 'exact'}
                onChange={(event) => update(rule.id, { matchSubdomains: event.target.value === 'wildcard' })}
                aria-label={`${rule.domain} 匹配范围`}
              >
                <option value="wildcard">主域名 + 子域名</option>
                <option value="exact">仅此域名</option>
              </select>
              <select
                value={rule.proxyId}
                onChange={(event) => update(rule.id, { proxyId: event.target.value })}
                aria-label={`${rule.domain} 使用的代理`}
              >
                {proxies.map((proxy) => (
                  <option key={proxy.id} value={proxy.id}>{proxy.name || '未命名代理'}</option>
                ))}
              </select>
              <button
                className="icon-button danger"
                type="button"
                onClick={() => onChange(rules.filter((item) => item.id !== rule.id))}
                aria-label={`删除 ${rule.domain}`}
              >
                <TrashIcon />
              </button>
            </div>
          ))
        )}
      </div>

      {showBatchImport ? (
        <BatchImportModal
          rules={rules}
          proxies={proxies}
          initialProxyId={proxyId}
          onImport={(imported) => onChange([...rules, ...imported])}
          onClose={() => setShowBatchImport(false)}
        />
      ) : null}
    </section>
  )
}
