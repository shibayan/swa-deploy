import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as core from '@actions/core'
import {
  WebSiteManagementClient,
  type StaticSiteARMResource
} from '@azure/arm-appservice'
import { SubscriptionClient } from '@azure/arm-resources-subscriptions'
import { AzureCliCredential } from '@azure/identity'
import { cleanUp, getDeployClientPath } from './static-site-client.js'

export interface DeployInputs {
  appLocation?: string
  apiLocation?: string
  deploymentToken?: string
  appName?: string
  resourceGroupName?: string
  environment?: string
  apiLanguage?: string
  apiVersion?: string
}

export interface DeployResult {
  deploymentUrl?: string
}

interface DeploymentDependencies {
  getDeployClientPath: (releaseVersion?: string) => Promise<{
    binary: string
    buildId: string
  }>
  spawn: typeof spawn
  createStaticSitesClient: (subscriptionId: string) => StaticSitesOperations
  listSubscriptions: () => Promise<AzureSubscription[]>
  cleanUp: () => void
  info: (message: string) => void
  warning: (message: string) => void
  debug: (message: string) => void
}

type StaticSitesOperations = Pick<
  WebSiteManagementClient['staticSites'],
  'list' | 'listStaticSiteSecrets' | 'listStaticSitesByResourceGroup'
>

interface AzureSubscription {
  subscriptionId: string
  displayName?: string
}

interface StaticWebAppLocation {
  subscriptionId: string
  resourceGroupName: string
}

type DeployChildProcess = ChildProcess & {
  stdout: NodeJS.ReadableStream
  stderr: NodeJS.ReadableStream
}

const defaultDependencies: DeploymentDependencies = {
  getDeployClientPath,
  spawn,
  createStaticSitesClient,
  listSubscriptions,
  cleanUp,
  info: core.info,
  warning: core.warning,
  debug: core.debug
}

export async function runDeployment(
  inputs: DeployInputs,
  overrides: Partial<DeploymentDependencies> = {}
): Promise<DeployResult> {
  const dependencies = { ...defaultDependencies, ...overrides }
  const currentDirectory = process.cwd()
  const appLocation = resolveDirectory(
    currentDirectory,
    inputs.appLocation ?? '.',
    'app-location'
  )
  const deploymentEnvironment = inputs.environment ?? 'production'

  dependencies.info(
    `Deploying front-end files from folder: ${appLocation.absolutePath}`
  )

  let apiLocation: string | undefined
  if (inputs.apiLocation) {
    apiLocation = resolveOptionalDirectory(
      currentDirectory,
      inputs.apiLocation,
      'API'
    )
    dependencies.info(`Deploying API from folder: ${apiLocation}`)
  } else {
    const apiFolder = await findApiFolderInPath(appLocation.absolutePath)
    if (apiFolder) {
      const detectedApiPath = `./${apiFolder}`
      dependencies.warning(
        `An API folder was found at "${detectedApiPath}" but api-location was not provided. The API will not be deployed.`
      )
    }
  }

  let apiVersion = inputs.apiVersion
  if (apiLocation && inputs.apiLanguage && !apiVersion) {
    apiVersion = getDefaultApiVersion(inputs.apiLanguage)
    dependencies.info(
      `api-language "${inputs.apiLanguage}" was provided without api-version. Assuming default version "${apiVersion}".`
    )
  } else if (apiLocation && !inputs.apiLanguage) {
    dependencies.warning(
      'api-location is set but api-language is not. Deployment may fail unless platform.apiRuntime is defined in staticwebapp.config.json.'
    )
  }

  dependencies.info(`Deploying to environment: ${deploymentEnvironment}`)
  dependencies.info('Deploying project to Azure Static Web Apps...')

  const [deploymentToken, { binary, buildId }] = await Promise.all([
    resolveDeploymentToken(inputs, dependencies),
    dependencies.getDeployClientPath()
  ])
  dependencies.debug(`Using StaticSitesClient ${binary}@${buildId}`)

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DEPLOYMENT_ACTION: 'upload',
    DEPLOYMENT_PROVIDER: 'GitHubAction',
    REPOSITORY_BASE: currentDirectory,
    SKIP_APP_BUILD: 'true',
    SKIP_API_BUILD: 'true',
    DEPLOYMENT_TOKEN: deploymentToken,
    APP_LOCATION: appLocation.relativePath,
    OUTPUT_LOCATION: '',
    API_LOCATION: apiLocation,
    FUNCTION_LANGUAGE: inputs.apiLanguage,
    FUNCTION_LANGUAGE_VERSION: apiVersion,
    SWA_CLI_DEPLOY_BINARY: `${binary}@${buildId}`
  }

  if (!isProductionEnvironment(deploymentEnvironment)) {
    env.DEPLOYMENT_ENVIRONMENT = deploymentEnvironment
  }

  try {
    const child = dependencies.spawn(binary, [], {
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    }) as DeployChildProcess

    const deploymentUrl = await watchDeployProcess(child, dependencies)
    return { deploymentUrl }
  } finally {
    dependencies.cleanUp()
  }
}

export function getDefaultApiVersion(apiLanguage: string): string {
  switch (apiLanguage.toLowerCase()) {
    case 'python':
      return '3.11'
    case 'dotnet':
    case 'dotnetisolated':
      return '8.0'
    case 'node':
    default:
      return '22'
  }
}

function resolveOptionalDirectory(
  workingDirectory: string,
  location: string | undefined,
  kind: string
): string | undefined {
  if (!location) {
    return undefined
  }

  return resolveDirectory(workingDirectory, location, kind).relativePath
}

function resolveDirectory(
  workingDirectory: string,
  location: string,
  kind: string
): { absolutePath: string; relativePath: string } {
  const absolutePath = path.resolve(workingDirectory, location)
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`The ${kind} folder "${absolutePath}" does not exist.`)
  }

  return {
    absolutePath,
    relativePath: toRepositoryRelativePath(workingDirectory, absolutePath)
  }
}

function toRepositoryRelativePath(
  workingDirectory: string,
  absolutePath: string
): string {
  const relativePath = path.relative(workingDirectory, absolutePath)
  return relativePath === '' ? '.' : relativePath
}

async function findApiFolderInPath(
  appPath: string
): Promise<string | undefined> {
  const entries = await fs.promises.readdir(appPath, { withFileTypes: true })
  return entries.find(
    (entry: fs.Dirent) =>
      entry.name.toLowerCase() === 'api' && entry.isDirectory()
  )?.name
}

async function resolveDeploymentToken(
  inputs: DeployInputs,
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
  inputs: DeployInputs,
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
  inputs: DeployInputs,
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
    (result): result is StaticWebAppLocation & { displayName?: string } =>
      result !== undefined
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

  return matches[0]
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
      for await (const resource of staticSitesClient.listStaticSitesByResourceGroup(
        resourceGroupName
      )) {
        if (resource.name?.toLowerCase() === staticWebAppName.toLowerCase()) {
          return resourceGroupName
        }
      }

      return undefined
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

async function watchDeployProcess(
  child: DeployChildProcess,
  dependencies: Pick<DeploymentDependencies, 'info' | 'warning'>
): Promise<string | undefined> {
  let stdoutBuffer = ''
  let stderrBuffer = ''
  let deploymentUrl: string | undefined
  let failureMessage: string | undefined

  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')

  child.stdout.on('data', (chunk: string) => {
    stdoutBuffer = emitCompleteLines(stdoutBuffer + chunk, (line) => {
      const cleanLine = sanitizeLine(line)
      if (!cleanLine) {
        return
      }

      deploymentUrl ||= parseDeploymentUrl(cleanLine)
      if (isFailureLine(cleanLine)) {
        failureMessage = cleanLine
      }

      dependencies.info(cleanLine)
    })
  })

  child.stderr.on('data', (chunk: string) => {
    stderrBuffer = emitCompleteLines(stderrBuffer + chunk, (line) => {
      const cleanLine = sanitizeLine(line)
      if (!cleanLine) {
        return
      }

      failureMessage = cleanLine
      dependencies.warning(cleanLine)
    })
  })

  const [code] = (await once(child, 'close')) as [number | null]

  const remainingStdout = sanitizeLine(stdoutBuffer)
  const remainingStderr = sanitizeLine(stderrBuffer)
  if (remainingStdout) {
    deploymentUrl ||= parseDeploymentUrl(remainingStdout)
    dependencies.info(remainingStdout)
  }
  if (remainingStderr) {
    failureMessage = remainingStderr
    dependencies.warning(remainingStderr)
  }

  if (code !== 0) {
    throw new Error(
      failureMessage ??
        `StaticSitesClient exited with code ${code ?? 'unknown'}.`
    )
  }

  return deploymentUrl
}

function emitCompleteLines(
  buffer: string,
  onLine: (line: string) => void
): string {
  const lines = buffer.split(/\r?\n/)
  const remainder = lines.pop() ?? ''

  for (const line of lines) {
    onLine(line)
  }

  return remainder
}

function parseDeploymentUrl(line: string): string | undefined {
  const match = line.match(/https?:\/\/\S+/)
  return match?.[0]
}

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERN = /\u001b\[[^m]*m/g

function sanitizeLine(line: string): string {
  return line.replace(ANSI_ESCAPE_PATTERN, '').trim()
}

const FAILURE_PATTERN = /(^error\b|deployment failed|cannot deploy)/i

function isFailureLine(line: string): boolean {
  return FAILURE_PATTERN.test(line)
}

function isProductionEnvironment(environment: string): boolean {
  const lower = environment.toLowerCase()
  return lower === 'prod' || lower === 'production'
}

function extractResourceGroupName(resourceId?: string): string | undefined {
  if (!resourceId) {
    return undefined
  }

  const match = resourceId.match(/\/resourceGroups\/([^/]+)/i)
  return match?.[1]
}

function createStaticSitesClient(
  subscriptionId: string
): StaticSitesOperations {
  const credential = new AzureCliCredential()
  const client = new WebSiteManagementClient(credential, subscriptionId)
  return client.staticSites
}

async function listSubscriptions(): Promise<AzureSubscription[]> {
  const client = new SubscriptionClient(new AzureCliCredential())
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
