import { jest } from '@jest/globals'

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

describe('deploy/azure.ts', () => {
  let createdCredentials: object[]
  let createdStaticSitesClients: Array<{
    credential: object
    subscriptionId: string
    staticSites: { credential: object; subscriptionId: string }
  }>
  let createdSubscriptionClients: Array<{ credential: object }>
  let subscriptionListFactory: () => AsyncGenerator<{
    subscriptionId?: string
    displayName?: string
  }>

  beforeEach(() => {
    subscriptionListFactory = () => createAsyncIterable([])
  })

  async function importAzureModule() {
    jest.resetModules()
    createdCredentials = []
    createdStaticSitesClients = []
    createdSubscriptionClients = []

    jest.unstable_mockModule('@azure/identity', () => ({
      AzureCliCredential: class AzureCliCredential {
        constructor() {
          createdCredentials.push(this)
        }
      }
    }))
    jest.unstable_mockModule('@azure/arm-appservice', () => ({
      WebSiteManagementClient: class WebSiteManagementClient {
        staticSites

        constructor(credential: object, subscriptionId: string) {
          this.staticSites = { credential, subscriptionId }
          createdStaticSitesClients.push({
            credential,
            subscriptionId,
            staticSites: this.staticSites
          })
        }
      }
    }))
    jest.unstable_mockModule('@azure/arm-resources-subscriptions', () => ({
      SubscriptionClient: class SubscriptionClient {
        subscriptions

        constructor(credential: object) {
          createdSubscriptionClients.push({ credential })
          this.subscriptions = {
            list: () => subscriptionListFactory()
          }
        }
      }
    }))

    return import('../../src/deploy/azure.js')
  }

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('reuses a shared Azure CLI credential when creating static sites clients', async () => {
    const module = await importAzureModule()
    const firstClient = module.createStaticSitesClient('subscription-one')
    const secondClient = module.createStaticSitesClient('subscription-two')

    expect(createdCredentials).toHaveLength(1)
    expect(firstClient).toBe(createdStaticSitesClients[0]?.staticSites)
    expect(secondClient).toBe(createdStaticSitesClients[1]?.staticSites)
    expect(firstClient).toEqual({
      credential: createdCredentials[0],
      subscriptionId: 'subscription-one'
    })
    expect(secondClient).toEqual({
      credential: createdCredentials[0],
      subscriptionId: 'subscription-two'
    })
  })

  it('lists subscriptions and ignores entries without a subscription id', async () => {
    subscriptionListFactory = () =>
      createAsyncIterable([
        {
          subscriptionId: 'subscription-one',
          displayName: 'Subscription One'
        },
        {
          displayName: 'Missing Id'
        },
        {
          subscriptionId: 'subscription-two'
        }
      ])

    const module = await importAzureModule()
    const subscriptions = await module.listSubscriptions()

    expect(createdCredentials).toHaveLength(1)
    expect(createdSubscriptionClients).toEqual([
      { credential: createdCredentials[0] }
    ])
    expect(subscriptions).toEqual([
      {
        subscriptionId: 'subscription-one',
        displayName: 'Subscription One'
      },
      {
        subscriptionId: 'subscription-two',
        displayName: undefined
      }
    ])
  })

  it('surfaces object-based Azure SDK errors when listing subscriptions', async () => {
    subscriptionListFactory = () =>
      createFailingAsyncIterable<{
        subscriptionId?: string
        displayName?: string
      }>({ message: 'Azure SDK object error' })

    const module = await importAzureModule()

    await expect(module.listSubscriptions()).rejects.toThrow(
      'Azure SDK object error'
    )
  })
})

describe('resolveDeploymentToken', () => {
  async function importAzureModule() {
    jest.resetModules()
    jest.unstable_mockModule('@azure/identity', () => ({
      AzureCliCredential: class AzureCliCredential {}
    }))
    jest.unstable_mockModule('@azure/arm-appservice', () => ({
      WebSiteManagementClient: class WebSiteManagementClient {
        staticSites
        constructor(credential: object, subscriptionId: string) {
          this.staticSites = { credential, subscriptionId }
        }
      }
    }))
    jest.unstable_mockModule('@azure/arm-resources-subscriptions', () => ({
      SubscriptionClient: class SubscriptionClient {
        subscriptions = { list: () => createAsyncIterable([]) }
      }
    }))

    return import('../../src/deploy/azure.js')
  }

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('returns the deployment token from the input when provided', async () => {
    const module = await importAzureModule()
    const deps = {
      createStaticSitesClient: jest.fn(),
      listSubscriptions: jest.fn(),
      info: jest.fn(),
      warning: jest.fn(),
      debug: jest.fn()
    }

    const token = await module.resolveDeploymentToken(
      { deploymentToken: 'my-token' },
      deps
    )

    expect(token).toBe('my-token')
    expect(deps.listSubscriptions).not.toHaveBeenCalled()
  })

  it('falls back to the SWA_CLI_DEPLOYMENT_TOKEN environment variable', async () => {
    const module = await importAzureModule()
    const deps = {
      createStaticSitesClient: jest.fn(),
      listSubscriptions: jest.fn(),
      info: jest.fn(),
      warning: jest.fn(),
      debug: jest.fn()
    }

    process.env.SWA_CLI_DEPLOYMENT_TOKEN = 'env-token'
    try {
      const token = await module.resolveDeploymentToken({}, deps)
      expect(token).toBe('env-token')
    } finally {
      delete process.env.SWA_CLI_DEPLOYMENT_TOKEN
    }
  })

  it('throws when no token and no app-name are provided', async () => {
    const module = await importAzureModule()
    const deps = {
      createStaticSitesClient: jest.fn(),
      listSubscriptions: jest.fn(),
      info: jest.fn(),
      warning: jest.fn(),
      debug: jest.fn()
    }

    await expect(module.resolveDeploymentToken({}, deps)).rejects.toThrow(
      'A deployment token is required to deploy to Azure Static Web Apps.'
    )
  })

  function createSearchDependencies(error: unknown, useResourceGroup: boolean) {
    const targetClient = {
      list: jest.fn(() =>
        createAsyncIterable([
          {
            name: 'my-app',
            id: '/subscriptions/target/resourceGroups/my-group/providers/Microsoft.Web/staticSites/my-app'
          }
        ])
      ),
      getStaticSite: jest.fn().mockResolvedValue({}),
      listStaticSiteSecrets: jest
        .fn()
        .mockResolvedValue({ properties: { apiKey: 'resolved-token' } })
    }
    const deniedClient = {
      list: jest.fn(() => createFailingAsyncIterable(error)),
      getStaticSite: jest.fn().mockRejectedValue(error),
      listStaticSiteSecrets: jest.fn()
    }
    const deps = {
      createStaticSitesClient: jest.fn((id: string) =>
        id === 'target' ? targetClient : deniedClient
      ),
      listSubscriptions: jest
        .fn()
        .mockResolvedValue([
          { subscriptionId: 'denied' },
          { subscriptionId: 'target' }
        ]),
      info: jest.fn(),
      debug: jest.fn(),
      warning: jest.fn()
    }
    const inputs = {
      appName: 'my-app',
      resourceGroupName: useResourceGroup ? 'my-group' : undefined
    }
    return { deps, inputs, targetClient, deniedClient }
  }

  it.each([
    [false, { statusCode: 403, message: 'Forbidden' }],
    [true, { code: 'AuthorizationFailed', message: 'Forbidden' }]
  ])(
    'skips access-denied subscriptions (resource group: %s)',
    async (useResourceGroup, error) => {
      const module = await importAzureModule()
      const { deps, inputs, targetClient, deniedClient } =
        createSearchDependencies(error, useResourceGroup)

      await expect(module.resolveDeploymentToken(inputs, deps)).resolves.toBe(
        'resolved-token'
      )
      expect(deps.warning).toHaveBeenCalledWith(
        expect.stringContaining('Skipping subscription "denied"')
      )
      expect(targetClient.listStaticSiteSecrets).toHaveBeenCalledWith(
        'my-group',
        'my-app'
      )
      expect(deniedClient.listStaticSiteSecrets).not.toHaveBeenCalled()
    }
  )

  it('searches an explicit subscription without listing subscriptions', async () => {
    const module = await importAzureModule()
    const { deps, inputs } = createSearchDependencies(
      new Error('Forbidden'),
      true
    )

    await expect(
      module.resolveDeploymentToken(
        { ...inputs, subscriptionId: 'target' },
        deps
      )
    ).resolves.toBe('resolved-token')
    expect(deps.listSubscriptions).not.toHaveBeenCalled()
    expect(deps.createStaticSitesClient).toHaveBeenCalledTimes(1)
    expect(deps.createStaticSitesClient).toHaveBeenCalledWith('target')
  })

  it('fails for an explicitly selected subscription that denies access', async () => {
    const module = await importAzureModule()
    const { deps, inputs } = createSearchDependencies(
      { statusCode: 403, message: 'Forbidden' },
      true
    )

    await expect(
      module.resolveDeploymentToken(
        { ...inputs, subscriptionId: 'denied' },
        deps
      )
    ).rejects.toThrow('Forbidden')
    expect(deps.warning).not.toHaveBeenCalled()
    expect(deps.listSubscriptions).not.toHaveBeenCalled()
  })

  it('reports access errors when no accessible subscription contains the app', async () => {
    const module = await importAzureModule()
    const { deps, inputs, targetClient } = createSearchDependencies(
      { statusCode: 403, message: 'Forbidden' },
      false
    )
    targetClient.list.mockImplementation(() => createAsyncIterable([]))

    await expect(module.resolveDeploymentToken(inputs, deps)).rejects.toThrow(
      'Forbidden'
    )
    expect(targetClient.listStaticSiteSecrets).not.toHaveBeenCalled()
  })

  it('does not ignore service failures even when another subscription matches', async () => {
    const module = await importAzureModule()
    const { deps, inputs, targetClient } = createSearchDependencies(
      { statusCode: 503, message: 'Service Unavailable' },
      false
    )

    await expect(module.resolveDeploymentToken(inputs, deps)).rejects.toThrow(
      'Service Unavailable'
    )
    expect(targetClient.listStaticSiteSecrets).not.toHaveBeenCalled()
  })
})
