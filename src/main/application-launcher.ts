import { randomUUID } from 'node:crypto'
import { constants, promises as fs } from 'node:fs'
import { basename, extname, join, normalize, resolve } from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import type { ManagedApplication, ManagedApplicationState } from '../shared/types'

const execFileAsync = promisify(execFile)
const LOCAL_BYPASS = 'localhost,127.0.0.1,::1'

async function readPlistValue(plistPath: string, key: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('/usr/bin/plutil', ['-extract', key, 'raw', plistPath])
    return stdout.trim() || null
  } catch {
    return null
  }
}

export async function resolveApplicationBundle(applicationPath: string): Promise<ManagedApplication> {
  const path = normalize(resolve(applicationPath))
  if (extname(path).toLowerCase() !== '.app') throw new Error('请选择一个 macOS .app 应用')
  const plistPath = join(path, 'Contents', 'Info.plist')
  await fs.access(plistPath)

  const [displayName, bundleName, bundleId, executableName] = await Promise.all([
    readPlistValue(plistPath, 'CFBundleDisplayName'),
    readPlistValue(plistPath, 'CFBundleName'),
    readPlistValue(plistPath, 'CFBundleIdentifier'),
    readPlistValue(plistPath, 'CFBundleExecutable')
  ])
  if (!executableName) throw new Error('所选应用缺少 CFBundleExecutable，无法启动')
  const executablePath = join(path, 'Contents', 'MacOS', basename(executableName))
  await fs.access(executablePath, constants.X_OK)

  const resolvedName = bundleId === 'com.openai.codex'
    ? 'Codex'
    : displayName ?? bundleName ?? basename(path, '.app')
  return {
    id: randomUUID(),
    name: resolvedName,
    path,
    bundleId,
    executablePath,
    addedAt: new Date().toISOString()
  }
}

export function buildProxyEnvironment(
  relayPort: number,
  baseEnvironment: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const proxyUrl = `http://127.0.0.1:${relayPort}`
  return {
    ...baseEnvironment,
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    ALL_PROXY: proxyUrl,
    http_proxy: proxyUrl,
    https_proxy: proxyUrl,
    all_proxy: proxyUrl,
    NO_PROXY: LOCAL_BYPASS,
    no_proxy: LOCAL_BYPASS,
    DOMAIN_RELAY_PROXY: '1'
  }
}

async function runningCommands(): Promise<string[]> {
  const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'pid=,command='])
  return stdout
    .split('\n')
    .map((line) => line.trim().replace(/^\d+\s+/, ''))
    .filter(Boolean)
}

function commandMatchesExecutable(command: string, executablePath: string): boolean {
  return command === executablePath || command.startsWith(`${executablePath} `)
}

export async function applicationStates(
  applications: ManagedApplication[],
  launchedApplicationIds: Set<string>
): Promise<ManagedApplicationState[]> {
  if (applications.length === 0) return []
  const commands = await runningCommands()
  return applications.map((application) => {
    const running = commands.some((command) => commandMatchesExecutable(command, application.executablePath))
    if (!running) launchedApplicationIds.delete(application.id)
    return {
      ...application,
      status: !running ? 'stopped' : launchedApplicationIds.has(application.id) ? 'proxied' : 'running'
    }
  })
}

export async function launchManagedApplication(
  application: ManagedApplication,
  relayPort: number,
  launchedApplicationIds: Set<string>
): Promise<void> {
  const [state] = await applicationStates([application], launchedApplicationIds)
  if (state.status !== 'stopped') {
    throw new Error(`“${application.name}”已经在运行。请完全退出该应用后，再通过 Domain Relay 启动。`)
  }
  await fs.access(application.executablePath, constants.X_OK)
  const child = spawn(application.executablePath, [], {
    cwd: '/',
    detached: true,
    stdio: 'ignore',
    env: buildProxyEnvironment(relayPort)
  })
  await new Promise<void>((resolveSpawn, rejectSpawn) => {
    child.once('spawn', resolveSpawn)
    child.once('error', rejectSpawn)
  })
  child.unref()
  launchedApplicationIds.add(application.id)
}
