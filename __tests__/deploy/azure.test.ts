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
      debug: jest.fn()
    }

    await expect(module.resolveDeploymentToken({}, deps)).rejects.toThrow(
      'A deployment token is required to deploy to Azure Static Web Apps.'
    )
  })
})
