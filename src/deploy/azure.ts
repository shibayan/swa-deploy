import {
  WebSiteManagementClient,
  type StaticSiteARMResource
} from '@azure/arm-appservice'
import { SubscriptionClient } from '@azure/arm-resources-subscriptions'
import { AzureCliCredential } from '@azure/identity'
import type {
  AzureSubscription,
  DeploymentDependencies,
  StaticSitesOperations,
  StaticWebAppLocation
} from './types.js'

export async function resolveDeploymentToken(
  inputs: {
    deploymentToken?: string
    appName?: string
    resourceGroupName?: string
  },
  dependencies: Pick<
    DeploymentDependencies,
    'createStaticSitesClient' | 'listSubscriptions' | 'info' | 'debug'
  >
): Promise<string> {
  const deploymentToken =
    inputs.deploymentToken ?? process.env.SWA_CLI_DEPLOYMENT_TOKEN
  if (deploymentToken) {
    return deploymentToken
  }

  if (!inputs.appName) {
    throw new Error(
      'A deployment token is required to deploy to Azure Static Web Apps. Provide deployment-token, set SWA_CLI_DEPLOYMENT_TOKEN, or specify app-name after running azure/login.'
    )
  }

  dependencies.info(
    'deployment-token was not provided. Attempting to resolve a deployment token from Azure Resource Manager using the current Azure CLI login session.'
  )

  return getDeploymentTokenFromAzure(inputs, dependencies)
}

async function getDeploymentTokenFromAzure(
  inputs: {
    appName?: string
    resourceGroupName?: string
  },
  dependencies: Pick<
    DeploymentDependencies,
    'createStaticSitesClient' | 'listSubscriptions' | 'debug'
  >
): Promise<string> {
  const location = await resolveStaticWebAppLocation(inputs, dependencies)
  const staticSitesClient = dependencies.createStaticSitesClient(
    location.subscriptionId
  )

  dependencies.debug(
    `Resolving deployment token with Azure Resource Manager SDK for Static Web App "${inputs.appName}" in subscription "${location.subscriptionId}".`
  )

  let payload
  try {
    payload = await staticSitesClient.listStaticSiteSecrets(
      location.resourceGroupName,
      inputs.appName as string
    )
  } catch (error) {
    throw new Error(
      getAzureErrorMessage(
        error,
        'Azure Resource Manager failed to resolve the deployment token.'
      ),
      { cause: error }
    )
  }

  const deploymentToken = extractDeploymentToken(payload)
  if (!deploymentToken) {
    throw new Error(
      'Azure Resource Manager resolved successfully, but no deployment token was returned. Verify app-name.'
    )
  }

  return deploymentToken
}

async function resolveStaticWebAppLocation(
  inputs: {
    appName?: string
    resourceGroupName?: string
  },
  dependencies: Pick<
    DeploymentDependencies,
    'createStaticSitesClient' | 'listSubscriptions' | 'debug'
  >
): Promise<StaticWebAppLocation> {
  const subscriptions = await dependencies.listSubscriptions()
  if (subscriptions.length === 0) {
    throw new Error(
      'Azure subscription could not be determined. Ensure azure/login has already run and that the current Azure CLI session can list subscriptions.'
    )
  }

  const results = await Promise.all(
    subscriptions.map(async (subscription) => {
      const staticSitesClient = dependencies.createStaticSitesClient(
        subscription.subscriptionId
      )
      const resourceGroupName = await findStaticWebAppResourceGroup(
        inputs.appName as string,
        inputs.resourceGroupName,
        subscription.subscriptionId,
        staticSitesClient,
        dependencies
      )

      if (resourceGroupName) {
        return {
          subscriptionId: subscription.subscriptionId,
          resourceGroupName,
          displayName: subscription.displayName
        }
      }

      return undefined
    })
  )

  const matches = results.filter(
    (
      result
    ): result is StaticWebAppLocation & {
      displayName: string | undefined
    } => result !== undefined
  )

  if (matches.length === 0) {
    throw new Error(
      `Static Web App "${inputs.appName}" was not found in any accessible subscription.`
    )
  }

  if (matches.length > 1) {
    const subscriptionsDescription = matches
      .map((match) =>
        match.displayName
          ? `${match.displayName} (${match.subscriptionId})`
          : match.subscriptionId
      )
      .join(', ')

    throw new Error(
      `Static Web App "${inputs.appName}" was found in multiple subscriptions: ${subscriptionsDescription}. Restrict the search further by setting resource-group-name.`
    )
  }

  return matches[0]!
}

async function findStaticWebAppResourceGroup(
  staticWebAppName: string,
  resourceGroupName: string | undefined,
  subscriptionId: string,
  staticSitesClient: StaticSitesOperations,
  dependencies: Pick<DeploymentDependencies, 'debug'>
): Promise<string | undefined> {
  if (resourceGroupName) {
    dependencies.debug(
      `Checking resource group "${resourceGroupName}" for Static Web App "${staticWebAppName}" in subscription "${subscriptionId}".`
    )

    try {
      await staticSitesClient.getStaticSite(resourceGroupName, staticWebAppName)
      return resourceGroupName
    } catch (error) {
      if (isAzureNotFoundError(error)) {
        return undefined
      }

      throw new Error(
        getAzureErrorMessage(
          error,
          'Azure Resource Manager failed to resolve the Static Web App.'
        ),
        { cause: error }
      )
    }
  }

  try {
    return await resolveStaticWebAppResourceGroup(
      staticWebAppName,
      subscriptionId,
      staticSitesClient,
      dependencies
    )
  } catch (error) {
    if (
      error instanceof Error &&
      isStaticWebAppNotFoundMessage(error.message)
    ) {
      return undefined
    }

    throw error
  }
}

async function resolveStaticWebAppResourceGroup(
  staticWebAppName: string,
  subscriptionId: string,
  staticSitesClient: StaticSitesOperations,
  dependencies: Pick<DeploymentDependencies, 'debug'>
): Promise<string> {
  dependencies.debug(
    `Resolving Static Web App resource group from Azure Resource Manager SDK for subscription "${subscriptionId}".`
  )

  const matchingResources: Array<Pick<StaticSiteARMResource, 'id' | 'name'>> =
    []

  try {
    for await (const resource of staticSitesClient.list()) {
      if (resource.name?.toLowerCase() === staticWebAppName.toLowerCase()) {
        matchingResources.push(resource)
      }
    }
  } catch (error) {
    throw new Error(
      getAzureErrorMessage(
        error,
        'Azure Resource Manager failed to resolve the Static Web App.'
      ),
      { cause: error }
    )
  }

  if (matchingResources.length === 0) {
    throw new Error(
      `Static Web App "${staticWebAppName}" was not found in subscription "${subscriptionId}".`
    )
  }

  if (matchingResources.length > 1) {
    throw new Error(
      `Multiple Static Web Apps named "${staticWebAppName}" were found in subscription "${subscriptionId}".`
    )
  }

  const resourceGroup = extractResourceGroupName(matchingResources[0].id)
  if (!resourceGroup) {
    throw new Error(
      `Failed to determine the resource group for Static Web App "${staticWebAppName}".`
    )
  }

  return resourceGroup
}

let sharedCredential: AzureCliCredential | undefined

function getSharedCredential(): AzureCliCredential {
  if (!sharedCredential) {
    sharedCredential = new AzureCliCredential()
  }
  return sharedCredential
}

export function createStaticSitesClient(
  subscriptionId: string
): StaticSitesOperations {
  const credential = getSharedCredential()
  const client = new WebSiteManagementClient(credential, subscriptionId)
  return client.staticSites
}

export async function listSubscriptions(): Promise<AzureSubscription[]> {
  const client = new SubscriptionClient(getSharedCredential())
  const subscriptions: AzureSubscription[] = []
  try {
    for await (const subscription of client.subscriptions.list()) {
      if (subscription.subscriptionId) {
        subscriptions.push({
          subscriptionId: subscription.subscriptionId,
          displayName: subscription.displayName
        })
      }
    }
  } catch (error) {
    throw new Error(
      getAzureErrorMessage(
        error,
        'Azure Resource Manager failed to list subscriptions.'
      ),
      { cause: error }
    )
  }

  return subscriptions
}

function extractDeploymentToken(payload: {
  properties?: Record<string, unknown>
}): string | undefined {
  const apiKey = payload.properties?.apiKey
  if (typeof apiKey !== 'string') {
    return undefined
  }

  return apiKey.trim() || undefined
}

function getAzureErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  if (typeof error === 'object' && error !== null) {
    const maybeError = error as { message?: unknown }
    if (typeof maybeError.message === 'string' && maybeError.message.trim()) {
      return maybeError.message
    }
  }

  return fallbackMessage
}

function isStaticWebAppNotFoundMessage(message: string): boolean {
  return message.includes('was not found in subscription')
}

function isAzureNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  const maybeError = error as {
    statusCode?: number
    code?: string
  }

  return (
    maybeError.statusCode === 404 ||
    maybeError.code === 'ResourceNotFound' ||
    maybeError.code === 'ResourceGroupNotFound'
  )
}

function extractResourceGroupName(resourceId?: string): string | undefined {
  if (!resourceId) {
    return undefined
  }

  const match = resourceId.match(/\/resourceGroups\/([^/]+)/i)
  return match?.[1]
}
