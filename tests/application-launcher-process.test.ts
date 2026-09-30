import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManagedApplication } from '../src/shared/types'
import { launchManagedApplication } from '../src/main/application-launcher'

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  access: vi.fn(),
  spawn: vi.fn()
}))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  const { promisify } = await import('node:util')
  return {
    ...actual,
    execFile: Object.assign(vi.fn(), { [promisify.custom]: mocks.run }),
    spawn: mocks.spawn
  }
})

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, promises: { ...actual.promises, access: mocks.access } }
})

const application: ManagedApplication = {
  id: 'example-app',
  name: 'Example App',
  path: '/Applications/Example App.app',
  executablePath: '/Applications/Example App.app/Contents/MacOS/Example App',
  bundleId: 'test.example-app',
  addedAt: '2026-01-01T00:00:00.000Z'
}

describe('managed application launch', () => {
  let processList: string

  beforeEach(() => {
    vi.resetAllMocks()
    processList = ''
    mocks.access.mockResolvedValue(undefined)
    mocks.spawn.mockImplementation(() => { throw new Error('Unexpected direct executable launch') })
    mocks.run.mockImplementation(async (command: string) => {
      if (command === '/bin/ps') return { stdout: processList, stderr: '' }
      if (command === '/usr/bin/open') {
        processList = `123 ${application.executablePath}`
        return { stdout: '', stderr: '' }
      }
      throw new Error(`Unexpected command: ${command}`)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('uses LaunchServices with explicit proxy overrides and keeps unrelated environment values off argv', async () => {
    vi.stubEnv('LAUNCH_TEST_PRIVATE_VALUE', 'not-for-command-line')
    const launched = new Set<string>()

    await launchManagedApplication(application, 47654, launched)

    expect(mocks.run).toHaveBeenCalledWith('/usr/bin/open', [
      '-a', application.path,
      '--env', 'HTTP_PROXY=http://127.0.0.1:47654',
      '--env', 'HTTPS_PROXY=http://127.0.0.1:47654',
      '--env', 'ALL_PROXY=http://127.0.0.1:47654',
      '--env', 'http_proxy=http://127.0.0.1:47654',
      '--env', 'https_proxy=http://127.0.0.1:47654',
      '--env', 'all_proxy=http://127.0.0.1:47654',
      '--env', 'NO_PROXY=localhost,127.0.0.1,::1',
      '--env', 'no_proxy=localhost,127.0.0.1,::1',
      '--env', 'DOMAIN_RELAY_PROXY=1'
    ], expect.objectContaining({
      timeout: 10_000,
      env: expect.objectContaining({
        LAUNCH_TEST_PRIVATE_VALUE: 'not-for-command-line',
        HTTPS_PROXY: 'http://127.0.0.1:47654'
      })
    }))
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(launched.has(application.id)).toBe(true)
  })

  it('rejects an already running application without reopening it', async () => {
    processList = `123 ${application.executablePath} --example`
    const launched = new Set<string>()

    await expect(launchManagedApplication(application, 47654, launched)).rejects.toThrow('已经在运行')

    expect(mocks.run).toHaveBeenCalledTimes(1)
    expect(mocks.access).not.toHaveBeenCalled()
    expect(launched.size).toBe(0)
  })

  it('does not launch or mark an inaccessible executable as proxied', async () => {
    mocks.access.mockRejectedValue(new Error('Executable is unavailable'))
    const launched = new Set<string>()

    await expect(launchManagedApplication(application, 47654, launched)).rejects.toThrow('Executable is unavailable')

    expect(mocks.run).toHaveBeenCalledTimes(1)
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(launched.size).toBe(0)
  })

  it('propagates system launch failures without a direct-spawn fallback', async () => {
    mocks.run.mockImplementation(async (command: string) => {
      if (command === '/bin/ps') return { stdout: '', stderr: '' }
      throw new Error('LaunchServices rejected the application')
    })
    const launched = new Set<string>()

    await expect(launchManagedApplication(application, 47654, launched)).rejects.toThrow('LaunchServices rejected')

    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(launched.size).toBe(0)
  })

  it('waits for a delayed application process before reporting it as proxied', async () => {
    vi.useFakeTimers()
    mocks.run.mockImplementation(async (command: string) => {
      if (command === '/bin/ps') return { stdout: processList, stderr: '' }
      setTimeout(() => { processList = `123 ${application.executablePath}` }, 300)
      return { stdout: '', stderr: '' }
    })
    const launched = new Set<string>()
    const launch = launchManagedApplication(application, 47654, launched)
    await Promise.all([
      expect(launch).resolves.toBeUndefined(),
      (async () => {
        await vi.advanceTimersByTimeAsync(200)
        expect(launched.size).toBe(0)
        await vi.advanceTimersByTimeAsync(200)
      })()
    ])

    expect(launched.has(application.id)).toBe(true)
  })

  it('reports an application that never starts instead of marking it as proxied', async () => {
    vi.useFakeTimers()
    mocks.run.mockResolvedValue({ stdout: '', stderr: '' })
    const launched = new Set<string>()
    const assertion = expect(launchManagedApplication(application, 47654, launched)).rejects.toThrow('未检测到运行进程')

    await Promise.all([assertion, vi.advanceTimersByTimeAsync(10_100)])

    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(launched.size).toBe(0)
  })
})
