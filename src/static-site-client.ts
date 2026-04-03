import crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { once } from 'node:events'
import { Readable } from 'node:stream'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'

const DEPLOY_BINARY_NAME = 'StaticSitesClient'
const DEPLOY_BINARY_STABLE_TAG = 'stable'
const DEPLOY_FOLDER = path.join(os.homedir(), '.swa', 'deploy')
const STATIC_SITE_CLIENT_RELEASE_METADATA_URL = 'https://aka.ms/swalocaldeploy'
const releaseMetadataCache = new Map<
  string,
  Promise<StaticSiteClientReleaseMetadata | undefined>
>()

interface StaticSiteClientReleaseMetadata {
  version: string
  buildId: string
  files: Record<string, { url: string; sha: string }>
}

interface StaticSiteClientLocalMetadata {
  metadata: StaticSiteClientReleaseMetadata
  binary: string
  checksum: string
}

export interface StaticSiteClientCacheInfo {
  primaryKey: string
  paths: string[]
}

export async function getDeployClientPath(
  releaseVersion = DEPLOY_BINARY_STABLE_TAG
): Promise<{ binary: string; buildId: string }> {
  const platform = getPlatform()
  const localClientMetadata = getLocalClientMetadata()
  const remoteClientMetadata =
    await fetchReleaseMetadata(releaseVersion)

  if (!remoteClientMetadata) {
    throw new Error(
      'Could not load StaticSitesClient metadata from remote. Check network connectivity.'
    )
  }

  if (localClientMetadata) {
    const localFile = remoteClientMetadata.files[platform]
    if (
      localClientMetadata.metadata.buildId === remoteClientMetadata.buildId &&
      localClientMetadata.checksum.toLowerCase() ===
        localFile.sha.toLowerCase() &&
      fs.existsSync(localClientMetadata.binary)
    ) {
      return {
        binary: localClientMetadata.binary,
        buildId: localClientMetadata.metadata.buildId
      }
    }
  }

  const binary = await downloadAndValidateBinary(remoteClientMetadata, platform)
  return { binary, buildId: remoteClientMetadata.buildId }
}

export async function getDeployCacheInfo(
  releaseVersion = DEPLOY_BINARY_STABLE_TAG
): Promise<StaticSiteClientCacheInfo | undefined> {
  const platform = getPlatform()
  const remoteClientMetadata =
    await fetchReleaseMetadata(releaseVersion)

  if (!remoteClientMetadata) {
    return undefined
  }

  const release = remoteClientMetadata.files[platform]
  return {
    primaryKey: [
      'swa-deploy',
      'static-sites-client',
      platform,
      remoteClientMetadata.buildId,
      release.sha.toLowerCase()
    ].join('-'),
    paths: [DEPLOY_FOLDER]
  }
}

export function cleanUp(): void {
  for (const file of ['app.zip', 'api.zip']) {
    const filePath = path.join(process.cwd(), file)
    try {
      fs.unlinkSync(filePath)
    } catch {
      // Ignore cleanup failures.
    }
  }
}

function getPlatform(): 'linux-x64' | 'win-x64' | 'osx-x64' {
  if (os.arch() !== 'x64') {
    throw new Error(`Unsupported architecture: ${os.arch()}`)
  }

  switch (os.platform()) {
    case 'linux':
      return 'linux-x64'
    case 'win32':
      return 'win-x64'
    case 'darwin':
      return 'osx-x64'
    default:
      throw new Error(`Unsupported platform: ${os.platform()}`)
  }
}

function getLocalClientMetadata(): StaticSiteClientLocalMetadata | undefined {
  const metadataFilePath = path.join(
    DEPLOY_FOLDER,
    `${DEPLOY_BINARY_NAME}.json`
  )
  if (!fs.existsSync(metadataFilePath)) {
    return undefined
  }

  try {
    const metadata = JSON.parse(
      fs.readFileSync(metadataFilePath, 'utf8')
    ) as StaticSiteClientLocalMetadata

    if (fs.existsSync(metadata.binary)) {
      return metadata
    }
  } catch {
    return undefined
  }

  return undefined
}

async function fetchReleaseMetadata(
  releaseVersion: string
): Promise<StaticSiteClientReleaseMetadata | undefined> {
  const cachedMetadata = releaseMetadataCache.get(releaseVersion)
  if (cachedMetadata) {
    return cachedMetadata
  }

  const metadataPromise = (async () => {
    const response = await fetch(STATIC_SITE_CLIENT_RELEASE_METADATA_URL)
    if (!response.ok) {
      return undefined
    }

    const remoteVersions =
      (await response.json()) as StaticSiteClientReleaseMetadata[]
    return remoteVersions.find((version) => version.version === releaseVersion)
  })()

  releaseMetadataCache.set(releaseVersion, metadataPromise)

  try {
    const metadata = await metadataPromise
    if (!metadata) {
      releaseMetadataCache.delete(releaseVersion)
    }

    return metadata
  } catch (error) {
    releaseMetadataCache.delete(releaseVersion)
    throw error
  }
}

async function downloadAndValidateBinary(
  metadata: StaticSiteClientReleaseMetadata,
  platform: 'linux-x64' | 'win-x64' | 'osx-x64'
): Promise<string> {
  const release = metadata.files[platform]
  const response = await fetch(release.url)
  if (!response.ok) {
    throw new Error(`Failed to download StaticSitesClient from ${release.url}.`)
  }

  const destinationDirectory = path.join(DEPLOY_FOLDER, metadata.buildId)
  const binaryName =
    platform === 'win-x64' ? `${DEPLOY_BINARY_NAME}.exe` : DEPLOY_BINARY_NAME
  const binaryPath = path.join(destinationDirectory, binaryName)

  await fs.promises.mkdir(destinationDirectory, { recursive: true })
  const checksum = await streamDownloadToFile(response, binaryPath)
  if (checksum.toLowerCase() !== release.sha.toLowerCase()) {
    await fs.promises.rm(binaryPath, { force: true })
    throw new Error('Downloaded StaticSitesClient checksum validation failed.')
  }

  if (platform !== 'win-x64') {
    await fs.promises.chmod(binaryPath, 0o755)
  }

  const localMetadata: StaticSiteClientLocalMetadata = {
    metadata,
    binary: binaryPath,
    checksum
  }
  await fs.promises.writeFile(
    path.join(DEPLOY_FOLDER, `${DEPLOY_BINARY_NAME}.json`),
    JSON.stringify(localMetadata, null, 2)
  )

  return binaryPath
}

async function streamDownloadToFile(
  response: Response,
  destinationPath: string
): Promise<string> {
  if (!response.body) {
    throw new Error('Failed to read the StaticSitesClient download stream.')
  }

  const hash = crypto.createHash('sha256')
  const readStream = Readable.fromWeb(
    response.body as WebReadableStream<Uint8Array>
  )
  const writeStream = fs.createWriteStream(destinationPath)

  try {
    for await (const chunk of readStream) {
      hash.update(chunk)

      if (!writeStream.write(chunk)) {
        await once(writeStream, 'drain')
      }
    }

    await closeWriteStream(writeStream)
    return hash.digest('hex')
  } catch (error) {
    writeStream.destroy()
    await fs.promises.rm(destinationPath, { force: true })
    throw error
  }
}

async function closeWriteStream(writeStream: fs.WriteStream): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    writeStream.on('error', reject)
    writeStream.end(() => resolve())
  })
}
