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
  let dependencies: Parameters<typeof runDeployment>[1]

  beforeEach(async () => {
    originalCwd = process.cwd()
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'swa-deploy-'))
    process.chdir(tempRoot)

    dependencies = {
      getDeployClientPath: jest.fn().mockResolvedValue({
        binary: '/tmp/StaticSitesClient',
        buildId: '1.2.3'
      }),
      spawn: jest.fn(),
      cleanup: jest.fn(),
      info: jest.fn(),
      warning: jest.fn(),
      debug: jest.fn()
    }
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await fs.rm(tempRoot, { recursive: true, force: true })
    jest.restoreAllMocks()
  })

  it('resolves paths and runs the deploy client', async () => {
    const appRoot = path.join(tempRoot, 'dist')
    const apiRoot = path.join(tempRoot, 'api')

    await fs.mkdir(appRoot, { recursive: true })
    await fs.mkdir(apiRoot, { recursive: true })
    await fs.writeFile(path.join(appRoot, 'staticwebapp.config.json'), '{}')

    const child = new MockChildProcess()

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
        appLocation: 'dist',
        apiLocation: 'api',
        deploymentToken: 'test-token',
        environment: 'preview',
        apiLanguage: 'node'
      },
      {
        spawn,
        cleanup: dependencies.cleanup,
        getDeployClientPath: dependencies.getDeployClientPath,
        info: dependencies.info,
        warning: dependencies.warning,
        debug: dependencies.debug
      }
    )

    expect(result.deploymentUrl).toBe(
      'https://gentle-meadow-123456789.1.azurestaticapps.net'
    )
    expect(spawn).toHaveBeenCalledTimes(1)

    const [, , options] = spawn.mock.calls[0]
    expect(options.env.REPOSITORY_BASE).toBe(tempRoot)
    expect(options.env.APP_LOCATION).toBe('dist')
    expect(options.env.OUTPUT_LOCATION).toBe('')
    expect(options.env.API_LOCATION).toBe('api')
    expect(options.env.CONFIG_FILE_LOCATION).toBeUndefined()
    expect(options.env.DEPLOYMENT_ENVIRONMENT).toBe('preview')
    expect(options.env.FUNCTION_LANGUAGE_VERSION).toBe('22')
    expect(dependencies.cleanup).toHaveBeenCalledTimes(1)
    expect(dependencies.info).toHaveBeenCalledWith('Preparing deployment')
    expect(dependencies.info).toHaveBeenCalledWith(
      expect.stringContaining('Deploying project to Azure Static Web Apps')
    )
  })

  it('fails when the app_location folder does not exist', async () => {
    await expect(
      runDeployment(
        {
          appLocation: 'missing-app',
          deploymentToken: 'test-token'
        },
        dependencies
      )
    ).rejects.toThrow(
      `The app_location folder "${path.join(tempRoot, 'missing-app')}" does not exist.`
    )
  })

  it('fails when the api_location folder does not exist', async () => {
    const appRoot = path.join(tempRoot, 'dist')

    await fs.mkdir(appRoot, { recursive: true })

    await expect(
      runDeployment(
        {
          appLocation: 'dist',
          apiLocation: 'missing-api',
          deploymentToken: 'test-token'
        },
        dependencies
      )
    ).rejects.toThrow(
      `The provided API folder ${path.join(tempRoot, 'missing-api')} does not exist.`
    )
  })

  it('warns when an api folder exists but api_location is not provided', async () => {
    const appRoot = path.join(tempRoot, 'dist')
    const detectedApiRoot = path.join(appRoot, 'api')
    const child = new MockChildProcess()

    await fs.mkdir(detectedApiRoot, { recursive: true })

    const spawn = jest.fn(() => {
      queueMicrotask(() => {
        child.stdout?.end()
        child.stderr?.end()
        child.emit('close', 0)
      })

      return child as ChildProcessWithoutNullStreams
    })

    await runDeployment(
      {
        appLocation: 'dist',
        deploymentToken: 'test-token'
      },
      {
        ...dependencies,
        spawn
      }
    )

    expect(dependencies.warning).toHaveBeenCalledWith(
      'An API folder was found at "./api" but api_location was not provided. The API will not be deployed.'
    )
    const [, , options] = spawn.mock.calls[0]
    expect(options.env.API_LOCATION).toBeUndefined()
  })

  it('warns when api_location is set without api_language', async () => {
    const appRoot = path.join(tempRoot, 'dist')
    const apiRoot = path.join(tempRoot, 'api')
    const child = new MockChildProcess()

    await fs.mkdir(appRoot, { recursive: true })
    await fs.mkdir(apiRoot, { recursive: true })

    const spawn = jest.fn(() => {
      queueMicrotask(() => {
        child.stdout?.end()
        child.stderr?.end()
        child.emit('close', 0)
      })

      return child as ChildProcessWithoutNullStreams
    })

    await runDeployment(
      {
        appLocation: 'dist',
        apiLocation: 'api',
        deploymentToken: 'test-token'
      },
      {
        ...dependencies,
        spawn
      }
    )

    expect(dependencies.warning).toHaveBeenCalledWith(
      'api_location is set but api_language is not. Deployment may fail unless platform.apiRuntime is defined in staticwebapp.config.json.'
    )
    const [, , options] = spawn.mock.calls[0]
    expect(options.env.API_LOCATION).toBe('api')
    expect(options.env.FUNCTION_LANGUAGE_VERSION).toBeUndefined()
  })

  it('surfaces deploy client failure output', async () => {
    const appRoot = path.join(tempRoot, 'dist')
    const child = new MockChildProcess()

    await fs.mkdir(appRoot, { recursive: true })

    const spawn = jest.fn(() => {
      queueMicrotask(() => {
        child.stderr?.write('Deployment failed: invalid token\n')
        child.stdout?.end()
        child.stderr?.end()
        child.emit('close', 1)
      })

      return child as ChildProcessWithoutNullStreams
    })

    await expect(
      runDeployment(
        {
          appLocation: 'dist',
          deploymentToken: 'test-token'
        },
        {
          ...dependencies,
          spawn
        }
      )
    ).rejects.toThrow('Deployment failed: invalid token')

    expect(dependencies.warning).toHaveBeenCalledWith(
      'Deployment failed: invalid token'
    )
    expect(dependencies.cleanup).toHaveBeenCalledTimes(1)
  })

  it('uses the generic exit-code error when the deploy client fails silently', async () => {
    const appRoot = path.join(tempRoot, 'dist')
    const child = new MockChildProcess()

    await fs.mkdir(appRoot, { recursive: true })

    const spawn = jest.fn(() => {
      queueMicrotask(() => {
        child.stdout?.end()
        child.stderr?.end()
        child.emit('close', 1)
      })

      return child as ChildProcessWithoutNullStreams
    })

    await expect(
      runDeployment(
        {
          appLocation: 'dist',
          deploymentToken: 'test-token'
        },
        {
          ...dependencies,
          spawn
        }
      )
    ).rejects.toThrow('StaticSitesClient exited with code 1.')
  })

  it('captures a deployment URL from stdout without a trailing newline', async () => {
    const appRoot = path.join(tempRoot, 'dist')
    const child = new MockChildProcess()

    await fs.mkdir(appRoot, { recursive: true })

    const spawn = jest.fn(() => {
      queueMicrotask(() => {
        child.stdout?.write(
          'Visit your site at: https://gentle-meadow-123456789.1.azurestaticapps.net'
        )
        child.stdout?.end()
        child.stderr?.end()
        child.emit('close', 0)
      })

      return child as ChildProcessWithoutNullStreams
    })

    const result = await runDeployment(
      {
        appLocation: 'dist',
        deploymentToken: 'test-token'
      },
      {
        ...dependencies,
        spawn
      }
    )

    expect(result.deploymentUrl).toBe(
      'https://gentle-meadow-123456789.1.azurestaticapps.net'
    )
    expect(dependencies.info).toHaveBeenCalledWith(
      'Visit your site at: https://gentle-meadow-123456789.1.azurestaticapps.net'
    )
  })

  it('does not set DEPLOYMENT_ENVIRONMENT for production aliases', async () => {
    const appRoot = path.join(tempRoot, 'dist')
    const child = new MockChildProcess()

    await fs.mkdir(appRoot, { recursive: true })

    const spawn = jest.fn(() => {
      queueMicrotask(() => {
        child.stdout?.end()
        child.stderr?.end()
        child.emit('close', 0)
      })

      return child as ChildProcessWithoutNullStreams
    })

    await runDeployment(
      {
        appLocation: 'dist',
        deploymentToken: 'test-token',
        environment: 'prod'
      },
      {
        ...dependencies,
        spawn
      }
    )

    const [, , options] = spawn.mock.calls[0]
    expect(options.env.DEPLOYMENT_ENVIRONMENT).toBeUndefined()
  })

  it('fails when the deployment token is missing', async () => {
    const appRoot = path.join(tempRoot, 'app')

    await fs.mkdir(appRoot, { recursive: true })

    const inputs: DeployInputs = {
      appLocation: 'app',
      environment: 'preview'
    }

    await expect(
      runDeployment(inputs, {
        ...dependencies
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
