import { spawn } from 'node:child_process'
import * as core from '@actions/core'
import { cleanUp, getDeployClientPath } from '../static-site-client.js'
import { getDefaultApiVersion } from './api-version.js'
import {
  createStaticSitesClient,
  listSubscriptions,
  resolveDeploymentToken
} from './azure.js'
import {
  findApiFolderInPath,
  isProductionEnvironment,
  resolveDirectory
} from './paths.js'
import { watchDeployProcess } from './process.js'
import type {
  DeployChildProcess,
  DeployInputs,
  DeployResult,
  DeploymentDependencies
} from './types.js'

const defaultDependencies: DeploymentDependencies = {
  getDeployClientPath,
  spawn,
  createStaticSitesClient,
  listSubscriptions,
  cleanUp,
  setSecret: core.setSecret,
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
    apiLocation = resolveDirectory(
      currentDirectory,
      inputs.apiLocation,
      'API'
    ).relativePath
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
    if (apiVersion) {
      dependencies.info(
        `api-language "${inputs.apiLanguage}" was provided without api-version. Assuming default version "${apiVersion}".`
      )
    } else {
      dependencies.warning(
        `api-language "${inputs.apiLanguage}" is not a recognized runtime. Provide api-version explicitly.`
      )
    }
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
  dependencies.setSecret(deploymentToken)
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
