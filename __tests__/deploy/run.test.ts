import { jest } from '@jest/globals'
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

class MockChildProcess
  extends EventEmitter
  implements Partial<ChildProcessWithoutNullStreams>
{
  stdout = new PassThrough()
  stderr = new PassThrough()
}

describe('deploy/run.ts', () => {
  let tempRoot: string
  let originalCwd: string

  beforeEach(async () => {
    originalCwd = process.cwd()
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'swa-run-'))
    process.chdir(tempRoot)
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await fs.rm(tempRoot, { recursive: true, force: true })
    jest.restoreAllMocks()
  })

  it('uses default overrides and app-location when omitted', async () => {
    jest.resetModules()

    const child = new MockChildProcess()
    const spawn = jest.fn(() => {
      queueMicrotask(() => {
        child.stdout?.end()
        child.stderr?.end()
        child.emit('close', 0)
      })

      return child as ChildProcessWithoutNullStreams
    })
    const cleanUp = jest.fn()
    const info = jest.fn()
    const warning = jest.fn()
    const debug = jest.fn()
    const resolveDeploymentToken = jest.fn().mockResolvedValue('resolved-token')
    const getDeployClientPath = jest.fn().mockResolvedValue({
      binary: '/tmp/StaticSitesClient',
      buildId: 'default-build'
    })

    jest.unstable_mockModule('node:child_process', () => ({ spawn }))
    const setSecret = jest.fn()
    jest.unstable_mockModule('@actions/core', () => ({
      info,
      warning,
      debug,
      setSecret
    }))
    jest.unstable_mockModule('../../src/static-site-client.js', () => ({
      cleanUp,
      getDeployClientPath
    }))
    jest.unstable_mockModule('../../src/deploy/azure.js', () => ({
      createStaticSitesClient: jest.fn(),
      listSubscriptions: jest.fn(),
      resolveDeploymentToken
    }))

    const module = await import('../../src/deploy/run.js')
    await module.runDeployment({})

    expect(resolveDeploymentToken).toHaveBeenCalledTimes(1)
    expect(getDeployClientPath).toHaveBeenCalledTimes(1)
    expect(spawn).toHaveBeenCalledTimes(1)
    const [, , options] = spawn.mock.calls[0]
    expect(options.env.APP_LOCATION).toBe('.')
    expect(options.env.DEPLOYMENT_ENVIRONMENT).toBeUndefined()
    expect(info).toHaveBeenCalledWith(
      `Deploying front-end files from folder: ${tempRoot}`
    )
    expect(cleanUp).toHaveBeenCalledTimes(1)
  })
})
