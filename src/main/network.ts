import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AutoProxySnapshot, ManualProxyState, NetworkService } from '../shared/types'

const execFileAsync = promisify(execFile)
const NETWORK_SETUP = '/usr/sbin/networksetup'
const OSASCRIPT = '/usr/bin/osascript'
const ROUTE = '/sbin/route'

async function runNetworkSetup(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(NETWORK_SETUP, args, { maxBuffer: 1024 * 1024 })
  return stdout.trim()
}

export async function listNetworkServices(): Promise<NetworkService[]> {
  const [output, orderOutput, defaultInterface] = await Promise.all([
    runNetworkSetup(['-listallnetworkservices']),
    runNetworkSetup(['-listnetworkserviceorder']),
    readDefaultInterface()
  ])
  const deviceByService = new Map(parseNetworkServiceOrder(orderOutput).map((item) => [item.name, item.device]))
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({
      name: line.replace(/^\*/, ''),
      disabled: line.startsWith('*'),
      device: deviceByService.get(line.replace(/^\*/, '')) ?? null,
      isDefault: deviceByService.get(line.replace(/^\*/, '')) === defaultInterface
    }))
}

export interface NetworkServiceDevice {
  name: string
  device: string
}

export function parseNetworkServiceOrder(output: string): NetworkServiceDevice[] {
  const lines = output.split(/\r?\n/)
  const result: NetworkServiceDevice[] = []
  for (let index = 0; index < lines.length - 1; index += 1) {
    const serviceMatch = lines[index]?.match(/^\(\d+\)\s+(.+)$/)
    const deviceMatch = lines[index + 1]?.match(/Device:\s*([^,)]+)/)
    if (serviceMatch?.[1] && deviceMatch?.[1]) {
      result.push({ name: serviceMatch[1].replace(/^\*/, '').trim(), device: deviceMatch[1].trim() })
    }
  }
  return result
}

export function parseDefaultInterface(output: string): string | null {
  return output.match(/^\s*interface:\s*(\S+)\s*$/m)?.[1] ?? null
}

async function readDefaultInterface(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(ROUTE, ['-n', 'get', 'default'], { maxBuffer: 1024 * 1024 })
    return parseDefaultInterface(stdout)
  } catch {
    return null
  }
}

export async function getAutoProxy(service: string): Promise<AutoProxySnapshot> {
  const output = await runNetworkSetup(['-getautoproxyurl', service])
  const urlMatch = output.match(/^URL:\s*(.*)$/m)
  const enabledMatch = output.match(/^Enabled:\s*(Yes|No)$/m)
  const rawUrl = urlMatch?.[1]?.trim() ?? ''
  return {
    service,
    enabled: enabledMatch?.[1] === 'Yes',
    url: !rawUrl || rawUrl === '(null)' ? null : rawUrl,
    capturedAt: new Date().toISOString()
  }
}

export async function getManualProxies(service: string): Promise<ManualProxyState[]> {
  const definitions = [
    { kind: 'HTTP' as const, flag: '-getwebproxy' },
    { kind: 'HTTPS' as const, flag: '-getsecurewebproxy' },
    { kind: 'SOCKS' as const, flag: '-getsocksfirewallproxy' }
  ]
  return Promise.all(
    definitions.map(async ({ kind, flag }) => {
      const output = await runNetworkSetup([flag, service])
      const enabled = output.match(/^Enabled:\s*(Yes|No)$/m)?.[1] === 'Yes'
      const rawServer = output.match(/^Server:\s*(.*)$/m)?.[1]?.trim() ?? ''
      const rawPort = output.match(/^Port:\s*(\d+)$/m)?.[1]
      return {
        kind,
        enabled,
        server: rawServer && rawServer !== '(null)' ? rawServer : null,
        port: rawPort ? Number(rawPort) : null
      }
    })
  )
}

export interface AutoProxyTarget {
  service: string
  url: string | null
  enabled: boolean
}

export interface AutoProxyRestorePlan {
  targets: AutoProxyTarget[]
  unchanged: string[]
  skipped: string[]
}

export function planAutoProxyRestore(
  previous: AutoProxySnapshot[],
  current: AutoProxySnapshot[],
  managedPacUrls: string | readonly string[]
): AutoProxyRestorePlan {
  const currentByService = new Map(current.map((snapshot) => [snapshot.service, snapshot]))
  const managedUrls = new Set(typeof managedPacUrls === 'string' ? [managedPacUrls] : managedPacUrls)
  const plan: AutoProxyRestorePlan = { targets: [], unchanged: [], skipped: [] }

  for (const snapshot of previous) {
    const live = currentByService.get(snapshot.service)
    if (!live) {
      plan.skipped.push(snapshot.service)
      continue
    }
    if (live.enabled === snapshot.enabled && live.url === snapshot.url) {
      plan.unchanged.push(snapshot.service)
      continue
    }
    if (!live.enabled || (live.url !== null && managedUrls.has(live.url))) {
      plan.targets.push({ service: snapshot.service, url: snapshot.url, enabled: snapshot.enabled })
      continue
    }
    plan.skipped.push(snapshot.service)
  }

  return plan
}

const SET_AUTO_PROXIES_SCRIPT = [
  'on run argv',
  'set commandText to ""',
  'repeat with itemIndex from 1 to (count argv) by 3',
  'set serviceName to item itemIndex of argv',
  'set pacUrl to item (itemIndex + 1) of argv',
  'set targetState to item (itemIndex + 2) of argv',
  'set serviceArg to quoted form of serviceName',
  'if commandText is not "" then',
  'set commandText to commandText & " && "',
  'end if',
  'if pacUrl is not "" then',
  'set commandText to commandText & "/usr/sbin/networksetup -setautoproxyurl " & serviceArg & " " & quoted form of pacUrl & " && "',
  'end if',
  'set commandText to commandText & "/usr/sbin/networksetup -setautoproxystate " & serviceArg & " " & targetState',
  'end repeat',
  'if commandText is not "" then',
  'do shell script commandText with administrator privileges',
  'end if',
  'end run'
]

export async function setAutoProxies(targets: AutoProxyTarget[]): Promise<void> {
  if (targets.length === 0) return
  const scriptArgs = SET_AUTO_PROXIES_SCRIPT.flatMap((line) => ['-e', line])
  const targetArgs = targets.flatMap((target) => [target.service, target.url ?? '', target.enabled ? 'on' : 'off'])
  await execFileAsync(OSASCRIPT, [...scriptArgs, '--', ...targetArgs], {
    maxBuffer: 1024 * 1024
  })
}

export async function setAutoProxy(service: string, url: string | null, enabled: boolean): Promise<void> {
  await setAutoProxies([{ service, url, enabled }])
}
