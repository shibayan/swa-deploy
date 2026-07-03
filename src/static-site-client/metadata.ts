import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  DEPLOY_BINARY_NAME,
  DEPLOY_FOLDER,
  STATIC_SITE_CLIENT_RELEASE_METADATA_URL
} from './constants.js'
import type {
  StaticSiteClientLocalMetadata,
  StaticSiteClientReleaseMetadata
} from './types.js'

const releaseMetadataCache = new Map<
  string,
  Promise<StaticSiteClientReleaseMetadata | undefined>
>()

export function getLocalClientMetadata():
  | StaticSiteClientLocalMetadata
  | undefined {
  const metadataFilePath = path.join(
    DEPLOY_FOLDER,
    `${DEPLOY_BINARY_NAME}.json`
  )

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

export async function fetchReleaseMetadata(
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
