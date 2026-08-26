import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildProxyEnvironment,
  resolveApplicationBundle
} from '../src/main/application-launcher'

describe('application proxy launcher', () => {
  const cleanups: Array<() => Promise<void>> = []

  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!()
  })

  it('injects the local relay for common HTTP proxy environment variables', () => {
    const environment = buildProxyEnvironment(47654, { PATH: '/usr/bin', NO_PROXY: 'example.com' })
    expect(environment).toMatchObject({
      HTTP_PROXY: 'http://127.0.0.1:47654',
      HTTPS_PROXY: 'http://127.0.0.1:47654',
      ALL_PROXY: 'http://127.0.0.1:47654',
      http_proxy: 'http://127.0.0.1:47654',
      https_proxy: 'http://127.0.0.1:47654',
      all_proxy: 'http://127.0.0.1:47654',
      NO_PROXY: 'localhost,127.0.0.1,::1',
      no_proxy: 'localhost,127.0.0.1,::1',
      DOMAIN_RELAY_PROXY: '1'
    })
  })

  it('reads a selectable macOS app bundle without trusting renderer metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'domain-relay-app-'))
    cleanups.push(() => rm(directory, { recursive: true, force: true }))
    const applicationPath = join(directory, 'Sample.app')
    const executableDirectory = join(applicationPath, 'Contents', 'MacOS')
    await mkdir(executableDirectory, { recursive: true })
    await writeFile(join(applicationPath, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleDisplayName</key><string>示例应用</string>
<key>CFBundleIdentifier</key><string>test.domain-relay.sample</string>
<key>CFBundleExecutable</key><string>Sample</string>
</dict></plist>`)
    const executablePath = join(executableDirectory, 'Sample')
    await writeFile(executablePath, '#!/bin/sh\nexit 0\n')
    await chmod(executablePath, 0o755)

    await expect(resolveApplicationBundle(applicationPath)).resolves.toMatchObject({
      name: '示例应用',
      path: applicationPath,
      bundleId: 'test.domain-relay.sample',
      executablePath
    })
  })

})
