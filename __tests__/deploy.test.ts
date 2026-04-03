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

async function* createAsyncIterable<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item
  }
}

async function* createFailingAsyncIterable<T>(
  error: unknown
): AsyncGenerator<T> {
  yield* []
  throw error
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
      createStaticSitesClient: jest.fn().mockReturnValue({
        list: jest.fn(() => createAsyncIterable([])),
        listStaticSitesByResourceGroup: jest.fn(() => createAsyncIterable([])),
        listStaticSiteSecrets: jest.fn()
      }),
      listSubscriptions: jest.fn().mockResolvedValue([]),
      cleanUp: jest.fn(),
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
        cleanUp: dependencies.cleanUp,
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
    expect(dependencies.cleanUp).toHaveBeenCalledTimes(1)
    expect(dependencies.info).toHaveBeenCalledWith('Preparing deployment')
    expect(dependencies.info).toHaveBeenCalledWith(
      expect.stringContaining('Deploying project to Azure Static Web Apps')
    )
  })

  it('resolves the deployment token from Azure Resource Manager when not provided', async () => {
    const appRoot = path.join(tempRoot, 'dist')
    const deployChild = new MockChildProcess()
    const list = jest.fn(() =>
      createAsyncIterable([
        {
          id: '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/my-resource-group/providers/Microsoft.Web/staticSites/my-static-app',
          name: 'my-static-app'
        }
      ])
    )
    const listStaticSiteSecrets = jest
      .fn()
      .mockResolvedValue({ properties: { apiKey: 'resolved-token' } })
    const createStaticSitesClient = jest.fn().mockReturnValue({
      list,
      listStaticSitesByResourceGroup: jest.fn(() => createAsyncIterable([])),
      listStaticSiteSecrets
    })
    const listSubscriptions = jest.fn().mockResolvedValue([
      {
        subscriptionId: '00000000-0000-0000-0000-000000000000',
        displayName: 'Subscription One'
      }
    ])

    await fs.mkdir(appRoot, { recursive: true })

    const spawn = jest.fn().mockImplementationOnce(() => {
      queueMicrotask(() => {
        deployChild.stdout?.end()
        deployChild.stderr?.end()
        deployChild.emit('close', 0)
      })

      return deployChild as ChildProcessWithoutNullStreams
    })

    await runDeployment(
      {
        appLocation: 'dist',
        appName: 'my-static-app'
      },
      {
        ...dependencies,
        listSubscriptions,
        createStaticSitesClient,
        spawn
      }
    )

    expect(createStaticSitesClient).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000000'
    )
    expect(list).toHaveBeenCalledTimes(1)
    expect(listStaticSiteSecrets).toHaveBeenCalledWith(
      'my-resource-group',
      'my-static-app'
    )

    expect(spawn).toHaveBeenNthCalledWith(
      1,
      '/tmp/StaticSitesClient',
      [],
      expect.objectContaining({
        env: expect.objectContaining({
          DEPLOYMENT_TOKEN: 'resolved-token'
        })
      })
    )
  })

  it('uses resource-group-name directly when resolving the deployment token', async () => {
    const appRoot = path.join(tempRoot, 'dist')
    const deployChild = new MockChildProcess()
    const list = jest.fn(() => createAsyncIterable([]))
    const listStaticSitesByResourceGroup = jest.fn(() =>
      createAsyncIterable([
        {
          id: '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/my-resource-group/providers/Microsoft.Web/staticSites/my-static-app',
          name: 'my-static-app'
        }
      ])
    )
    const listStaticSiteSecrets = jest
      .fn()
      .mockResolvedValue({ properties: { apiKey: 'resolved-token' } })
    const createStaticSitesClient = jest.fn().mockReturnValue({
      list,
      listStaticSitesByResourceGroup,
      listStaticSiteSecrets
    })
    const listSubscriptions = jest.fn().mockResolvedValue([
      {
        subscriptionId: '00000000-0000-0000-0000-000000000000',
        displayName: 'Subscription One'
      }
    ])

    await fs.mkdir(appRoot, { recursive: true })

    const spawn = jest.fn().mockImplementationOnce(() => {
      queueMicrotask(() => {
        deployChild.stdout?.end()
        deployChild.stderr?.end()
        deployChild.emit('close', 0)
      })

      return deployChild as ChildProcessWithoutNullStreams
    })

    await runDeployment(
      {
        appLocation: 'dist',
        appName: 'my-static-app',
        resourceGroupName: 'my-resource-group'
      },
      {
        ...dependencies,
        listSubscriptions,
        createStaticSitesClient,
        spawn
      }
    )

    expect(list).not.toHaveBeenCalled()
    expect(listStaticSitesByResourceGroup).toHaveBeenCalledWith(
      'my-resource-group'
    )
    expect(listStaticSiteSecrets).toHaveBeenCalledWith(
      'my-resource-group',
      'my-static-app'
    )
  })

  it('fails when the app-location folder does not exist', async () => {
    await expect(
      runDeployment(
        {
          appLocation: 'missing-app',
          deploymentToken: 'test-token'
        },
        dependencies
      )
    ).rejects.toThrow(
      `The app-location folder "${path.join(tempRoot, 'missing-app')}" does not exist.`
    )
  })

  it('fails when the api-location folder does not exist', async () => {
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
      `The API folder "${path.join(tempRoot, 'missing-api')}" does not exist.`
    )
  })

  it('fails when neither a deployment token nor static web app name is provided', async () => {
    const appRoot = path.join(tempRoot, 'dist')

    await fs.mkdir(appRoot, { recursive: true })

    await expect(
      runDeployment(
        {
          appLocation: 'dist'
        },
        dependencies
      )
    ).rejects.toThrow(
      'A deployment token is required to deploy to Azure Static Web Apps. Provide deployment-token, set SWA_CLI_DEPLOYMENT_TOKEN, or specify app-name after running azure/login.'
    )
  })

  it('fails when the static web app is not found during Azure login token resolution', async () => {
    const appRoot = path.join(tempRoot, 'dist')
    const createStaticSitesClient = jest.fn().mockReturnValue({
      list: jest.fn(() => createAsyncIterable([])),
      listStaticSitesByResourceGroup: jest.fn(() => createAsyncIterable([])),
      listStaticSiteSecrets: jest.fn()
    })
    const listSubscriptions = jest.fn().mockResolvedValue([
      {
        subscriptionId: '00000000-0000-0000-0000-000000000000',
        displayName: 'Subscription One'
      }
    ])

    await fs.mkdir(appRoot, { recursive: true })

    await expect(
      runDeployment(
        {
          appLocation: 'dist',
          appName: 'my-static-app'
        },
        {
          ...dependencies,
          listSubscriptions,
          createStaticSitesClient
        }
      )
    ).rejects.toThrow(
      'Static Web App "my-static-app" was not found in any accessible subscription.'
    )
  })

  it('selects the subscription from the Azure subscription list', async () => {
    const appRoot = path.join(tempRoot, 'dist')
    const deployChild = new MockChildProcess()
    const selectedSubscriptionClient = {
      list: jest.fn(() =>
        createAsyncIterable([
          {
            id: '/subscriptions/22222222-2222-2222-2222-222222222222/resourceGroups/my-resource-group/providers/Microsoft.Web/staticSites/my-static-app',
            name: 'my-static-app'
          }
        ])
      ),
      listStaticSitesByResourceGroup: jest.fn(() => createAsyncIterable([])),
      listStaticSiteSecrets: jest
        .fn()
        .mockResolvedValue({ properties: { apiKey: 'resolved-token' } })
    }
    const createStaticSitesClient = jest
      .fn()
      .mockReturnValueOnce({
        list: jest.fn(() => createAsyncIterable([])),
        listStaticSitesByResourceGroup: jest.fn(() => createAsyncIterable([])),
        listStaticSiteSecrets: jest.fn()
      })
      .mockReturnValue(selectedSubscriptionClient)

    await fs.mkdir(appRoot, { recursive: true })

    const spawn = jest.fn().mockImplementationOnce(() => {
      queueMicrotask(() => {
        deployChild.stdout?.end()
        deployChild.stderr?.end()
        deployChild.emit('close', 0)
      })

      return deployChild as ChildProcessWithoutNullStreams
    })

    await runDeployment(
      {
        appLocation: 'dist',
        appName: 'my-static-app'
      },
      {
        ...dependencies,
        listSubscriptions: jest.fn().mockResolvedValue([
          {
            subscriptionId: '11111111-1111-1111-1111-111111111111',
            displayName: 'Subscription One'
          },
          {
            subscriptionId: '22222222-2222-2222-2222-222222222222',
            displayName: 'Subscription Two'
          }
        ]),
        createStaticSitesClient,
        spawn
      }
    )

    expect(createStaticSitesClient).toHaveBeenNthCalledWith(
      1,
      '11111111-1111-1111-1111-111111111111'
    )
    expect(createStaticSitesClient).toHaveBeenNthCalledWith(
      2,
      '22222222-2222-2222-2222-222222222222'
    )
    expect(createStaticSitesClient).toHaveBeenNthCalledWith(
      3,
      '22222222-2222-2222-2222-222222222222'
    )
  })

  it('fails when the Azure subscription list is empty for Azure login token resolution', async () => {
    const appRoot = path.join(tempRoot, 'dist')

    await fs.mkdir(appRoot, { recursive: true })

    await expect(
      runDeployment(
        {
          appLocation: 'dist',
          appName: 'my-static-app'
        },
        {
          ...dependencies,
          listSubscriptions: jest.fn().mockResolvedValue([])
        }
      )
    ).rejects.toThrow(
      'Azure subscription could not be determined. Ensure azure/login has already run and that the current Azure CLI session can list subscriptions.'
    )
  })

  it('fails when the static web app is found in multiple subscriptions', async () => {
    const appRoot = path.join(tempRoot, 'dist')
    const createStaticSitesClient = jest.fn().mockReturnValue({
      list: jest.fn(() =>
        createAsyncIterable([
          {
            id: '/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/my-resource-group/providers/Microsoft.Web/staticSites/my-static-app',
            name: 'my-static-app'
          }
        ])
      ),
      listStaticSitesByResourceGroup: jest.fn(() => createAsyncIterable([])),
      listStaticSiteSecrets: jest.fn()
    })

    await fs.mkdir(appRoot, { recursive: true })

    await expect(
      runDeployment(
        {
          appLocation: 'dist',
          appName: 'my-static-app'
        },
        {
          ...dependencies,
          listSubscriptions: jest.fn().mockResolvedValue([
            {
              subscriptionId: '11111111-1111-1111-1111-111111111111',
              displayName: 'Subscription One'
            },
            {
              subscriptionId: '22222222-2222-2222-2222-222222222222',
              displayName: 'Subscription Two'
            }
          ]),
          createStaticSitesClient
        }
      )
    ).rejects.toThrow(
      'Static Web App "my-static-app" was found in multiple subscriptions:'
    )
  })

  it('warns when an api folder exists but api-location is not provided', async () => {
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
      'An API folder was found at "./api" but api-location was not provided. The API will not be deployed.'
    )
    const [, , options] = spawn.mock.calls[0]
    expect(options.env.API_LOCATION).toBeUndefined()
  })

  it('warns when api-location is set without api-language', async () => {
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
      'api-location is set but api-language is not. Deployment may fail unless platform.apiRuntime is defined in staticwebapp.config.json.'
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
    expect(dependencies.cleanUp).toHaveBeenCalledTimes(1)
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

  it('defaults the deployment environment to production when omitted', async () => {
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
        deploymentToken: 'test-token'
      },
      {
        ...dependencies,
        spawn
      }
    )

    const [, , options] = spawn.mock.calls[0]
    expect(options.env.DEPLOYMENT_ENVIRONMENT).toBeUndefined()
    expect(dependencies.info).toHaveBeenCalledWith(
      'Deploying to environment: production'
    )
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
      'A deployment token is required to deploy to Azure Static Web Apps. Provide deployment-token, set SWA_CLI_DEPLOYMENT_TOKEN, or specify app-name after running azure/login.'
    )
  })

  it('uses the deployment token from the environment when the input is omitted', async () => {
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

    process.env.SWA_CLI_DEPLOYMENT_TOKEN = 'env-token'

    try {
      await runDeployment(
        {
          appLocation: 'dist'
        },
        {
          ...dependencies,
          spawn
        }
      )
    } finally {
      delete process.env.SWA_CLI_DEPLOYMENT_TOKEN
    }

    expect(spawn).toHaveBeenCalledWith(
      '/tmp/StaticSitesClient',
      [],
      expect.objectContaining({
        env: expect.objectContaining({
          DEPLOYMENT_TOKEN: 'env-token'
        })
      })
    )
  })

  it('uses a repository relative app path of dot when app-location is the workspace root', async () => {
    const child = new MockChildProcess()

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
        appLocation: '.',
        deploymentToken: 'test-token'
      },
      {
        ...dependencies,
        spawn
      }
    )

    expect(spawn).toHaveBeenCalledWith(
      '/tmp/StaticSitesClient',
      [],
      expect.objectContaining({
        env: expect.objectContaining({
          APP_LOCATION: '.'
        })
      })
    )
  })

  it('uses a failure message detected on stdout when the deploy client exits non-zero', async () => {
    const appRoot = path.join(tempRoot, 'dist')
    const child = new MockChildProcess()

    await fs.mkdir(appRoot, { recursive: true })

    const spawn = jest.fn(() => {
      queueMicrotask(() => {
        child.stdout?.write(
          'Cannot deploy preview to the requested environment\n'
        )
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
    ).rejects.toThrow('Cannot deploy preview to the requested environment')

    expect(dependencies.info).toHaveBeenCalledWith(
      'Cannot deploy preview to the requested environment'
    )
  })

  it('fails when multiple apps with the same name exist in one subscription', async () => {
    const appRoot = path.join(tempRoot, 'dist')
    const createStaticSitesClient = jest.fn().mockReturnValue({
      list: jest.fn(() =>
        createAsyncIterable([
          {
            id: '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/group-one/providers/Microsoft.Web/staticSites/my-static-app',
            name: 'my-static-app'
          },
          {
            id: '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/group-two/providers/Microsoft.Web/staticSites/my-static-app',
            name: 'my-static-app'
          }
        ])
      ),
      listStaticSitesByResourceGroup: jest.fn(() => createAsyncIterable([])),
      listStaticSiteSecrets: jest.fn()
    })

    await fs.mkdir(appRoot, { recursive: true })

    await expect(
      runDeployment(
        {
          appLocation: 'dist',
          appName: 'my-static-app'
        },
        {
          ...dependencies,
          listSubscriptions: jest.fn().mockResolvedValue([
            {
              subscriptionId: '00000000-0000-0000-0000-000000000000',
              displayName: 'Subscription One'
            }
          ]),
          createStaticSitesClient
        }
      )
    ).rejects.toThrow(
      'Multiple Static Web Apps named "my-static-app" were found in subscription "00000000-0000-0000-0000-000000000000".'
    )
  })

  it('fails when the matched static web app resource has no resource group in its id', async () => {
    const appRoot = path.join(tempRoot, 'dist')
    const createStaticSitesClient = jest.fn().mockReturnValue({
      list: jest.fn(() =>
        createAsyncIterable([
          {
            id: '/subscriptions/00000000-0000-0000-0000-000000000000/providers/Microsoft.Web/staticSites/my-static-app',
            name: 'my-static-app'
          }
        ])
      ),
      listStaticSitesByResourceGroup: jest.fn(() => createAsyncIterable([])),
      listStaticSiteSecrets: jest.fn()
    })

    await fs.mkdir(appRoot, { recursive: true })

    await expect(
      runDeployment(
        {
          appLocation: 'dist',
          appName: 'my-static-app'
        },
        {
          ...dependencies,
          listSubscriptions: jest.fn().mockResolvedValue([
            {
              subscriptionId: '00000000-0000-0000-0000-000000000000',
              displayName: 'Subscription One'
            }
          ]),
          createStaticSitesClient
        }
      )
    ).rejects.toThrow(
      'Failed to determine the resource group for Static Web App "my-static-app".'
    )
  })

  it('treats explicit resource-group not-found errors as a missing static web app', async () => {
    const appRoot = path.join(tempRoot, 'dist')
    const createStaticSitesClient = jest.fn().mockReturnValue({
      list: jest.fn(() => createAsyncIterable([])),
      listStaticSitesByResourceGroup: jest.fn(() =>
        createFailingAsyncIterable({ code: 'ResourceGroupNotFound' })
      ),
      listStaticSiteSecrets: jest.fn()
    })

    await fs.mkdir(appRoot, { recursive: true })

    await expect(
      runDeployment(
        {
          appLocation: 'dist',
          appName: 'my-static-app',
          resourceGroupName: 'missing-group'
        },
        {
          ...dependencies,
          listSubscriptions: jest.fn().mockResolvedValue([
            {
              subscriptionId: '00000000-0000-0000-0000-000000000000',
              displayName: 'Subscription One'
            }
          ]),
          createStaticSitesClient
        }
      )
    ).rejects.toThrow(
      'Static Web App "my-static-app" was not found in any accessible subscription.'
    )
  })

  it('uses the Azure fallback error message when deployment token resolution throws a non-Error value', async () => {
    const appRoot = path.join(tempRoot, 'dist')
    const createStaticSitesClient = jest.fn().mockReturnValue({
      list: jest.fn(() => createAsyncIterable([])),
      listStaticSitesByResourceGroup: jest.fn(() =>
        createAsyncIterable([
          {
            id: '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/my-resource-group/providers/Microsoft.Web/staticSites/my-static-app',
            name: 'my-static-app'
          }
        ])
      ),
      listStaticSiteSecrets: jest.fn().mockRejectedValue({})
    })

    await fs.mkdir(appRoot, { recursive: true })

    await expect(
      runDeployment(
        {
          appLocation: 'dist',
          appName: 'my-static-app',
          resourceGroupName: 'my-resource-group'
        },
        {
          ...dependencies,
          listSubscriptions: jest.fn().mockResolvedValue([
            {
              subscriptionId: '00000000-0000-0000-0000-000000000000',
              displayName: 'Subscription One'
            }
          ]),
          createStaticSitesClient
        }
      )
    ).rejects.toThrow(
      'Azure Resource Manager failed to resolve the deployment token.'
    )
  })

  it('fails when Azure Resource Manager resolves a blank deployment token', async () => {
    const appRoot = path.join(tempRoot, 'dist')
    const createStaticSitesClient = jest.fn().mockReturnValue({
      list: jest.fn(() => createAsyncIterable([])),
      listStaticSitesByResourceGroup: jest.fn(() =>
        createAsyncIterable([
          {
            id: '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/my-resource-group/providers/Microsoft.Web/staticSites/my-static-app',
            name: 'my-static-app'
          }
        ])
      ),
      listStaticSiteSecrets: jest
        .fn()
        .mockResolvedValue({ properties: { apiKey: '   ' } })
    })

    await fs.mkdir(appRoot, { recursive: true })

    await expect(
      runDeployment(
        {
          appLocation: 'dist',
          appName: 'my-static-app',
          resourceGroupName: 'my-resource-group'
        },
        {
          ...dependencies,
          listSubscriptions: jest.fn().mockResolvedValue([
            {
              subscriptionId: '00000000-0000-0000-0000-000000000000',
              displayName: 'Subscription One'
            }
          ]),
          createStaticSitesClient
        }
      )
    ).rejects.toThrow(
      'Azure Resource Manager resolved successfully, but no deployment token was returned. Verify app-name.'
    )
  })

  it('throws when listStaticSitesByResourceGroup fails with a non-NotFound error', async () => {
    const appRoot = path.join(tempRoot, 'dist')
    const createStaticSitesClient = jest.fn().mockReturnValue({
      list: jest.fn(() => createAsyncIterable([])),
      listStaticSitesByResourceGroup: jest.fn(() =>
        createFailingAsyncIterable(new Error('Forbidden'))
      ),
      listStaticSiteSecrets: jest.fn()
    })

    await fs.mkdir(appRoot, { recursive: true })

    await expect(
      runDeployment(
        {
          appLocation: 'dist',
          appName: 'my-static-app',
          resourceGroupName: 'my-resource-group'
        },
        {
          ...dependencies,
          listSubscriptions: jest.fn().mockResolvedValue([
            {
              subscriptionId: '00000000-0000-0000-0000-000000000000',
              displayName: 'Subscription One'
            }
          ]),
          createStaticSitesClient
        }
      )
    ).rejects.toThrow('Forbidden')
  })

  it('throws when staticSitesClient.list() fails during resource group resolution', async () => {
    const appRoot = path.join(tempRoot, 'dist')
    const createStaticSitesClient = jest.fn().mockReturnValue({
      list: jest.fn(() =>
        createFailingAsyncIterable(new Error('Service Unavailable'))
      ),
      listStaticSitesByResourceGroup: jest.fn(() => createAsyncIterable([])),
      listStaticSiteSecrets: jest.fn()
    })

    await fs.mkdir(appRoot, { recursive: true })

    await expect(
      runDeployment(
        {
          appLocation: 'dist',
          appName: 'my-static-app'
        },
        {
          ...dependencies,
          listSubscriptions: jest.fn().mockResolvedValue([
            {
              subscriptionId: '00000000-0000-0000-0000-000000000000',
              displayName: 'Subscription One'
            }
          ]),
          createStaticSitesClient
        }
      )
    ).rejects.toThrow('Service Unavailable')
  })

  it('skips empty lines after ANSI stripping in stdout', async () => {
    const appRoot = path.join(tempRoot, 'dist')
    const child = new MockChildProcess()

    await fs.mkdir(appRoot, { recursive: true })

    const spawn = jest.fn(() => {
      queueMicrotask(() => {
        child.stdout?.write('\u001b[32m\u001b[0m\n')
        child.stdout?.write('Deploying\n')
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

    expect(dependencies.info).not.toHaveBeenCalledWith('')
    expect(dependencies.info).toHaveBeenCalledWith('Deploying')
  })

  it('captures remaining stderr without a trailing newline', async () => {
    const appRoot = path.join(tempRoot, 'dist')
    const child = new MockChildProcess()

    await fs.mkdir(appRoot, { recursive: true })

    const spawn = jest.fn(() => {
      queueMicrotask(() => {
        child.stdout?.end()
        child.stderr?.write('partial error')
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
    ).rejects.toThrow('partial error')

    expect(dependencies.warning).toHaveBeenCalledWith('partial error')
  })

  it('fails when the matched static web app resource has an undefined id', async () => {
    const appRoot = path.join(tempRoot, 'dist')
    const createStaticSitesClient = jest.fn().mockReturnValue({
      list: jest.fn(() =>
        createAsyncIterable([
          {
            name: 'my-static-app'
          }
        ])
      ),
      listStaticSitesByResourceGroup: jest.fn(() => createAsyncIterable([])),
      listStaticSiteSecrets: jest.fn()
    })

    await fs.mkdir(appRoot, { recursive: true })

    await expect(
      runDeployment(
        {
          appLocation: 'dist',
          appName: 'my-static-app'
        },
        {
          ...dependencies,
          listSubscriptions: jest.fn().mockResolvedValue([
            {
              subscriptionId: '00000000-0000-0000-0000-000000000000',
              displayName: 'Subscription One'
            }
          ]),
          createStaticSitesClient
        }
      )
    ).rejects.toThrow(
      'Failed to determine the resource group for Static Web App "my-static-app".'
    )
  })

  it('fails when the secrets payload does not contain an apiKey string', async () => {
    const appRoot = path.join(tempRoot, 'dist')
    const createStaticSitesClient = jest.fn().mockReturnValue({
      list: jest.fn(() => createAsyncIterable([])),
      listStaticSitesByResourceGroup: jest.fn(() =>
        createAsyncIterable([
          {
            id: '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/my-resource-group/providers/Microsoft.Web/staticSites/my-static-app',
            name: 'my-static-app'
          }
        ])
      ),
      listStaticSiteSecrets: jest
        .fn()
        .mockResolvedValue({ properties: { apiKey: 42 } })
    })

    await fs.mkdir(appRoot, { recursive: true })

    await expect(
      runDeployment(
        {
          appLocation: 'dist',
          appName: 'my-static-app',
          resourceGroupName: 'my-resource-group'
        },
        {
          ...dependencies,
          listSubscriptions: jest.fn().mockResolvedValue([
            {
              subscriptionId: '00000000-0000-0000-0000-000000000000',
              displayName: 'Subscription One'
            }
          ]),
          createStaticSitesClient
        }
      )
    ).rejects.toThrow(
      'Azure Resource Manager resolved successfully, but no deployment token was returned. Verify app-name.'
    )
  })

  it('detects the default API runtime version', () => {
    expect(getDefaultApiVersion('node')).toBe('22')
    expect(getDefaultApiVersion('python')).toBe('3.11')
    expect(getDefaultApiVersion('dotnet')).toBe('8.0')
    expect(getDefaultApiVersion('dotnetisolated')).toBe('8.0')
  })
})
