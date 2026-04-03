import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as core from '@actions/core'
import { cleanUp, getDeployClientPath } from './static-site-client.js'

export interface DeployInputs {
  appLocation?: string
  apiLocation?: string
  deploymentToken?: string
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
  cleanup: () => void
  info: (message: string) => void
  warning: (message: string) => void
  debug: (message: string) => void
}

type DeployChildProcess = ChildProcess & {
  stdout: NodeJS.ReadableStream
  stderr: NodeJS.ReadableStream
}

const defaultDependencies: DeploymentDependencies = {
  getDeployClientPath,
  spawn,
  cleanup: cleanUp,
  info: core.info,
  warning: core.warning,
  debug: core.debug
}

const SWA_CONFIG_FILENAME = 'staticwebapp.config.json'

export async function runDeployment(
  inputs: DeployInputs,
  overrides: Partial<DeploymentDependencies> = {}
): Promise<DeployResult> {
  const dependencies = { ...defaultDependencies, ...overrides }
  const currentDirectory = process.cwd()
  const appLocation = resolveRelativeDirectory(
    currentDirectory,
    inputs.appLocation ?? '.',
    'app_location'
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
        `An API folder was found at "${detectedApiPath}" but api_location was not provided. The API will not be deployed.`
      )
    }
  }

  let apiVersion = inputs.apiVersion
  if (apiLocation && inputs.apiLanguage && !apiVersion) {
    apiVersion = getDefaultApiVersion(inputs.apiLanguage)
    dependencies.info(
      `api_language "${inputs.apiLanguage}" was provided without api_version. Assuming default version "${apiVersion}".`
    )
  } else if (apiLocation && !inputs.apiLanguage) {
    dependencies.warning(
      'api_location is set but api_language is not. Deployment may fail unless platform.apiRuntime is defined in staticwebapp.config.json.'
    )
  }

  const deploymentToken =
    inputs.deploymentToken ?? process.env.SWA_CLI_DEPLOYMENT_TOKEN
  if (!deploymentToken) {
    throw new Error(
      'A deployment token is required to deploy to Azure Static Web Apps'
    )
  }

  const configLocation = resolveConfigLocation({
    appLocation: appLocation.absolutePath,
    workingDirectory: currentDirectory
  })

  dependencies.info(`Deploying to environment: ${deploymentEnvironment}`)
  dependencies.info('Deploying project to Azure Static Web Apps...')

  const { binary, buildId } = await dependencies.getDeployClientPath()
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
    CONFIG_FILE_LOCATION:
      configLocation && configLocation !== appLocation.relativePath
        ? configLocation
        : undefined,
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
    dependencies.cleanup()
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

  const resolvedLocation = path.resolve(workingDirectory, location)
  if (!fs.existsSync(resolvedLocation)) {
    throw new Error(
      `The provided ${kind} folder ${resolvedLocation} does not exist.`
    )
  }

  return toRepositoryRelativePath(workingDirectory, resolvedLocation)
}

function resolveConfigLocation(options: {
  appLocation: string
  workingDirectory: string
}): string | undefined {
  const candidates = [options.appLocation]
  const configDirectory = candidates.find((candidate) =>
    fs.existsSync(path.join(candidate, SWA_CONFIG_FILENAME))
  )

  return configDirectory
    ? toRepositoryRelativePath(options.workingDirectory, configDirectory)
    : undefined
}

function resolveRelativeDirectory(
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

function sanitizeLine(line: string): string {
  let sanitized = ''

  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '\u001b' && line[index + 1] === '[') {
      index += 2

      while (index < line.length && line[index] !== 'm') {
        index += 1
      }

      continue
    }

    sanitized += line[index]
  }

  return sanitized.trim()
}

function isFailureLine(line: string): boolean {
  return /(^error\b|deployment failed|cannot deploy)/i.test(line)
}

function isProductionEnvironment(environment: string): boolean {
  return ['prod', 'production'].includes(environment.toLowerCase())
}
