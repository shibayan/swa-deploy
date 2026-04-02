import { jest } from '@jest/globals'
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import {
  getDefaultApiVersion,
  runDeployment,
  type DeployInputs
} from '../src/deploy.js'

class MockChildProcess
  extends EventEmitter
  implements Partial<ChildProcessWithoutNullStreams>
{
  stdout = new PassThrough()
  stderr = new PassThrough()
}

describe('deploy.ts', () => {
  let tempRoot: string
  let originalCwd: string

  beforeEach(async () => {
    originalCwd = process.cwd()
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'swa-deploy-'))
    process.chdir(tempRoot)
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await fs.rm(tempRoot, { recursive: true, force: true })
    jest.restoreAllMocks()
  })

  it('resolves paths and runs the deploy client', async () => {
    const appRoot = path.join(tempRoot, 'app')
    const outputRoot = path.join(appRoot, 'dist')
    const apiRoot = path.join(tempRoot, 'api')

    await fs.mkdir(outputRoot, { recursive: true })
    await fs.mkdir(apiRoot, { recursive: true })
    await fs.writeFile(path.join(appRoot, 'staticwebapp.config.json'), '{}')

    const child = new MockChildProcess()
    const cleanup = jest.fn()
    const info = jest.fn()

    const spawn = jest.fn(() => {
      queueMicrotask(() => {
        child.stdout?.write('\u001b[32mPreparing deployment\u001b[0m\n')
        child.stdout?.write(
          'Visit your site at: https://gentle-meadow-123456789.1.azurestaticapps.net\n'
        )
        child.stdout?.end()
        child.stderr?.end()
        child.emit('close', 0)
      })

      return child as ChildProcessWithoutNullStreams
    })

    const result = await runDeployment(
      {
        appLocation: 'app',
        outputLocation: 'dist',
        apiLocation: 'api',
        deploymentToken: 'test-token',
        environment: 'preview',
        apiLanguage: 'node'
      },
      {
        getDeployClientPath: jest.fn().mockResolvedValue({
          binary: '/tmp/StaticSitesClient',
          buildId: '1.2.3'
        }),
        spawn,
        cleanup,
        info,
        warning: jest.fn(),
        debug: jest.fn()
      }
    )

    expect(result.deploymentUrl).toBe(
      'https://gentle-meadow-123456789.1.azurestaticapps.net'
    )
    expect(spawn).toHaveBeenCalledTimes(1)

    const [, , options] = spawn.mock.calls[0]
    expect(options.env.APP_LOCATION).toBe(outputRoot)
    expect(options.env.OUTPUT_LOCATION).toBe(outputRoot)
    expect(options.env.API_LOCATION).toBe(apiRoot)
    expect(options.env.CONFIG_FILE_LOCATION).toBe(appRoot)
    expect(options.env.DEPLOYMENT_ENVIRONMENT).toBe('preview')
    expect(options.env.FUNCTION_LANGUAGE_VERSION).toBe('22')
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith('Preparing deployment')
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('Deploying project to Azure Static Web Apps')
    )
  })

  it('fails when the deployment token is missing', async () => {
    const appRoot = path.join(tempRoot, 'app')
    const outputRoot = path.join(appRoot, 'dist')

    await fs.mkdir(outputRoot, { recursive: true })

    const inputs: DeployInputs = {
      appLocation: 'app',
      outputLocation: 'dist',
      environment: 'preview'
    }

    await expect(
      runDeployment(inputs, {
        getDeployClientPath: jest.fn(),
        spawn: jest.fn(),
        cleanup: jest.fn(),
        info: jest.fn(),
        warning: jest.fn(),
        debug: jest.fn()
      })
    ).rejects.toThrow(
      'A deployment token is required to deploy to Azure Static Web Apps'
    )
  })

  it('detects the default API runtime version', () => {
    expect(getDefaultApiVersion('node')).toBe('22')
    expect(getDefaultApiVersion('python')).toBe('3.11')
    expect(getDefaultApiVersion('dotnet')).toBe('8.0')
    expect(getDefaultApiVersion('dotnetisolated')).toBe('8.0')
  })
})
