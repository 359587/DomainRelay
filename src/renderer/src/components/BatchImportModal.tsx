import { useMemo, useRef, useState } from 'react'
import type { DomainRule, ProxyProfile } from '../../../shared/types'
import { parseDomainRuleInput, splitDomainRuleInputs } from '../../../shared/domain-rules'
import { CloseIcon, FolderIcon, ImportIcon } from './Icons'

interface BatchImportModalProps {
  rules: DomainRule[]
  proxies: ProxyProfile[]
  initialProxyId: string
  onImport: (rules: DomainRule[]) => void
  onClose: () => void
}

export function BatchImportModal({
  rules,
  proxies,
  initialProxyId,
  onImport,
  onClose
}: BatchImportModalProps): React.JSX.Element {
  const [input, setInput] = useState('')
  const [proxyId, setProxyId] = useState(initialProxyId || proxies[0]?.id || '')
  const [fileName, setFileName] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const preview = useMemo(() => {
    const existing = new Set(rules.map((rule) => rule.domain))
    const seen = new Set<string>()
    let invalid = 0
    let duplicate = 0
    const entries = []
    for (const value of splitDomainRuleInputs(input)) {
      const parsed = parseDomainRuleInput(value)
      if (!parsed) {
        invalid += 1
        continue
      }
      if (existing.has(parsed.domain) || seen.has(parsed.domain)) {
        duplicate += 1
        continue
      }
      seen.add(parsed.domain)
      entries.push(parsed)
    }
    return { entries, invalid, duplicate }
  }, [input, rules])

  const importRules = (): void => {
    if (!proxyId || preview.entries.length === 0) return
    onImport(
      preview.entries.map((entry) => ({
        id: crypto.randomUUID(),
        domain: entry.domain,
        matchSubdomains: entry.matchSubdomains,
        proxyId,
        enabled: true
      }))
    )
    onClose()
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="batch-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="batch-import-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="batch-modal-head">
          <div><h2 id="batch-import-title">批量导入域名</h2><p>主域名自动使用通配符，具体子域名保持精确匹配。</p></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭批量导入"><CloseIcon /></button>
        </div>

        <div className="batch-import-layout">
          <div className="batch-input-panel">
            <div className="batch-input-actions">
              <span>{fileName ? `已读取：${fileName}` : '每行一个，也支持空格或逗号分隔'}</span>
              <button className="button button-ghost" type="button" onClick={() => fileInputRef.current?.click()}>
                <FolderIcon /> 选择 TXT 文件
              </button>
              <input
                ref={fileInputRef}
                className="sr-only"
                type="file"
                accept=".txt,text/plain"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (!file) return
                  setFileName(file.name)
                  void file.text().then(setInput)
                  event.target.value = ''
                }}
              />
            </div>
            <textarea
              value={input}
              onChange={(event) => {
                setInput(event.target.value)
                setFileName(null)
              }}
              placeholder={'google.com\napi.github.com\n*.docs.example.com'}
              spellCheck={false}
              aria-label="批量导入域名内容"
            />
            <label className="batch-proxy-field">
              <span>统一使用代理</span>
              <select value={proxyId} onChange={(event) => setProxyId(event.target.value)}>
                {proxies.map((proxy) => <option key={proxy.id} value={proxy.id}>{proxy.name || '未命名代理'}</option>)}
              </select>
            </label>
          </div>

          <div className="batch-preview-panel">
            <div className="batch-preview-head"><strong>导入预览</strong><span>{preview.entries.length} 条有效</span></div>
            <div className="batch-preview-list">
              {preview.entries.length === 0 ? (
                <div className="batch-preview-empty">输入域名后将在这里显示匹配范围。</div>
              ) : preview.entries.slice(0, 100).map((entry) => (
                <div className="batch-preview-row" key={entry.domain}>
                  <code>{entry.matchSubdomains ? `*.${entry.domain}` : entry.domain}</code>
                  <span className={entry.matchSubdomains ? 'scope-wildcard' : 'scope-exact'}>
                    {entry.matchSubdomains ? '通配符' : '精确'}
                  </span>
                </div>
              ))}
            </div>
            <div className="batch-preview-summary">
              <span>重复跳过 {preview.duplicate}</span><span>无效跳过 {preview.invalid}</span>
            </div>
          </div>
        </div>

        <div className="batch-modal-footer">
          <button className="button button-ghost" type="button" onClick={onClose}>取消</button>
          <button className="button button-primary" type="button" onClick={importRules} disabled={!proxyId || preview.entries.length === 0}>
            <ImportIcon /> 导入 {preview.entries.length} 条
          </button>
        </div>
      </section>
    </div>
  )
}
