import { describe, expect, it } from 'vitest'
import { runInNewContext } from 'node:vm'
import { generatePac, normalizeDomain, validateConfig } from '../src/main/pac'
import { parseDomainRuleInput } from '../src/shared/domain-rules'
import type { AppConfig } from '../src/shared/types'

const config: AppConfig = {
  version: 4,
  networkServices: ['Wi-Fi', 'USB LAN'],
  pacPort: 47653,
  relayPort: 47654,
  proxies: [
    { id: 'proxy-a', name: '办公代理', protocol: 'HTTP', host: '127.0.0.1', port: 8080 },
    { id: 'proxy-b', name: '海外代理', protocol: 'SOCKS5', host: 'proxy.example.com', port: 1080 }
  ],
  rules: [
    { id: 'rule-a', domain: 'internal.example.com', proxyId: 'proxy-a', enabled: true, matchSubdomains: false },
    { id: 'rule-b', domain: 'example.org', proxyId: 'proxy-b', enabled: true, matchSubdomains: true },
    { id: 'rule-c', domain: 'disabled.example.net', proxyId: 'proxy-a', enabled: false, matchSubdomains: false }
  ],
  applications: []
}

describe('normalizeDomain', () => {
  it('accepts URLs and wildcard domain input', () => {
    expect(normalizeDomain('https://Docs.Example.com/a')).toBe('docs.example.com')
    expect(normalizeDomain('*.Example.org')).toBe('example.org')
  })

  it('rejects malformed domain input', () => {
    expect(normalizeDomain('not a domain')).toBe('')
  })
})

describe('parseDomainRuleInput', () => {
  it('uses wildcards for registrable domains and exact matching for concrete subdomains', () => {
    expect(parseDomainRuleInput('google.com')).toMatchObject({ domain: 'google.com', matchSubdomains: true })
    expect(parseDomainRuleInput('api.google.com')).toMatchObject({ domain: 'api.google.com', matchSubdomains: false })
    expect(parseDomainRuleInput('example.co.uk')).toMatchObject({ domain: 'example.co.uk', matchSubdomains: true })
  })

  it('honors an explicit wildcard on a concrete subdomain', () => {
    expect(parseDomainRuleInput('*.api.google.com')).toMatchObject({
      domain: 'api.google.com',
      matchSubdomains: true,
      explicitWildcard: true
    })
  })
})

describe('generatePac', () => {
  it('routes configured domains and leaves all other traffic direct', () => {
    const pac = generatePac(config)
    expect(pac).toContain('internal.example.com')
    expect(pac).toContain('PROXY 127.0.0.1:47654')
    expect(pac).not.toContain('proxy.example.com:1080')
    expect(pac).not.toContain('disabled.example.net')
    expect(pac).toContain('return "DIRECT"')
  })

  it('evaluates exact domains, subdomains, and unmatched domains correctly', () => {
    const pac = generatePac(config)
    const evaluate = (host: string): string =>
      runInNewContext(`${pac}\nFindProxyForURL("https://${host}/", "${host}");`, {
        dnsDomainIs: (candidate: string, suffix: string) => candidate.endsWith(suffix)
      }) as string

    expect(evaluate('internal.example.com')).toBe('PROXY 127.0.0.1:47654')
    expect(evaluate('api.internal.example.com')).toBe('DIRECT')
    expect(evaluate('example.org')).toBe('PROXY 127.0.0.1:47654')
    expect(evaluate('api.example.org')).toBe('PROXY 127.0.0.1:47654')
    expect(evaluate('unlisted.example.net')).toBe('DIRECT')
  })

  it('rejects duplicate domains', () => {
    expect(() =>
      validateConfig({
        ...config,
        rules: [...config.rules, { id: 'rule-d', domain: 'example.org', proxyId: 'proxy-a', enabled: true, matchSubdomains: false }]
      })
    ).toThrow('域名重复')
  })

  it('rejects a local proxy loop on the relay port', () => {
    expect(() =>
      validateConfig({
        ...config,
        proxies: [{ id: 'proxy-a', name: '循环代理', protocol: 'HTTP', host: '127.0.0.1', port: 47654 }],
        rules: [{ ...config.rules[0], proxyId: 'proxy-a' }]
      })
    ).toThrow('循环连接')
  })
})
