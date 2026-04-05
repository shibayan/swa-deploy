import { DEPLOY_BINARY_STABLE_TAG, DEPLOY_FOLDER } from './constants.js'
import { downloadAndValidateBinary } from './download.js'
import { fetchReleaseMetadata, getLocalClientMetadata } from './metadata.js'
import { getPlatform } from './platform.js'
import type { StaticSiteClientCacheInfo } from './types.js'

export async function getDeployClientPath(
  releaseVersion = DEPLOY_BINARY_STABLE_TAG
): Promise<{ binary: string; buildId: string }> {
  const platform = getPlatform()
  const localClientMetadata = getLocalClientMetadata()
  const remoteClientMetadata = await fetchReleaseMetadata(releaseVersion)

  if (!remoteClientMetadata) {
    throw new Error(
      'Could not load StaticSitesClient metadata from remote. Check network connectivity.'
    )
  }

  if (localClientMetadata) {
    const localFile = remoteClientMetadata.files[platform]
    if (
      localClientMetadata.metadata.buildId === remoteClientMetadata.buildId &&
      localClientMetadata.checksum.toLowerCase() === localFile.sha.toLowerCase()
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
  const remoteClientMetadata = await fetchReleaseMetadata(releaseVersion)

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
