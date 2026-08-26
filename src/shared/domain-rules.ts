import { parse } from 'tldts'

export interface ParsedDomainRuleInput {
  domain: string
  matchSubdomains: boolean
  explicitWildcard: boolean
}

export function normalizeDomain(input: string): string {
  let value = input.trim().toLowerCase()
  if (!value) return ''

  if (value.includes('://')) {
    try {
      value = new URL(value).hostname
    } catch {
      return ''
    }
  }

  value = value.replace(/^\*\./, '').replace(/^\.+|\.+$/g, '')
  if (value.includes('/') || value.includes(' ') || value.length > 253) return ''
  return value
}

export function parseDomainRuleInput(input: string): ParsedDomainRuleInput | null {
  const trimmed = input.trim().toLowerCase()
  const explicitWildcard = trimmed.startsWith('*.')
  const domain = normalizeDomain(trimmed)
  if (!domain) return null
  const parsed = parse(domain)
  const isMainDomain = Boolean(parsed.domain && parsed.domain === domain && !parsed.isIp)
  return {
    domain,
    matchSubdomains: explicitWildcard || isMainDomain,
    explicitWildcard
  }
}

export function splitDomainRuleInputs(input: string): string[] {
  return input.split(/[\s,;，；]+/).map((item) => item.trim()).filter(Boolean)
}
