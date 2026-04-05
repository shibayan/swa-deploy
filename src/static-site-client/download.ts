import crypto from 'node:crypto'
import { once } from 'node:events'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { DEPLOY_BINARY_NAME, DEPLOY_FOLDER } from './constants.js'
import type {
  StaticSiteClientPlatform,
  StaticSiteClientLocalMetadata,
  StaticSiteClientReleaseMetadata
} from './types.js'

export async function downloadAndValidateBinary(
  metadata: StaticSiteClientReleaseMetadata,
  platform: StaticSiteClientPlatform
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

    writeStream.end()
    await finished(writeStream)
    return hash.digest('hex')
  } catch (error) {
    writeStream.destroy()
    await fs.promises.rm(destinationPath, { force: true })
    throw error
  }
}
