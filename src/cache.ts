import * as cache from '@actions/cache'
import * as core from '@actions/core'
import * as fs from 'node:fs'
import { getDeployCacheInfo } from './static-site-client.js'

export const CacheState = {
  PostRun: 'SWA_DEPLOY_IS_POST',
  PrimaryKey: 'SWA_DEPLOY_CACHE_PRIMARY_KEY',
  MatchedKey: 'SWA_DEPLOY_CACHE_MATCHED_KEY',
  Paths: 'SWA_DEPLOY_CACHE_PATHS'
} as const

export async function restoreStaticSiteClientCache(): Promise<void> {
  core.saveState(CacheState.PostRun, 'true')

  if (!cache.isFeatureAvailable()) {
    core.warning(
      'The runner was not able to contact the cache service. StaticSitesClient caching will be skipped.'
    )
    return
  }

  const cacheInfo = await getDeployCacheInfo()
  if (!cacheInfo) {
    core.warning(
      'StaticSitesClient metadata could not be resolved for cache restore. Caching will be skipped.'
    )
    return
  }

  core.saveState(CacheState.PrimaryKey, cacheInfo.primaryKey)
  core.saveState(CacheState.Paths, JSON.stringify(cacheInfo.paths))

  const matchedKey = await cache.restoreCache(
    cacheInfo.paths,
    cacheInfo.primaryKey
  )

  core.saveState(CacheState.MatchedKey, matchedKey ?? '')

  if (matchedKey) {
    core.info(`StaticSitesClient cache restored from key: ${matchedKey}`)
  } else {
    core.info('StaticSitesClient cache is not found')
  }
}

export async function saveStaticSiteClientCache(): Promise<void> {
  if (!cache.isFeatureAvailable()) {
    return
  }

  const primaryKey = core.getState(CacheState.PrimaryKey)
  const matchedKey = core.getState(CacheState.MatchedKey)
  const storedPaths = core.getState(CacheState.Paths)
  const cachePaths = storedPaths ? (JSON.parse(storedPaths) as string[]) : []
  const existingPaths = cachePaths.filter((cachePath) =>
    fs.existsSync(cachePath)
  )

  if (!primaryKey || existingPaths.length === 0) {
    return
  }

  if (primaryKey === matchedKey) {
    core.info(
      `Cache hit occurred on the primary key ${primaryKey}, not saving cache.`
    )
    return
  }

  const cacheId = await cache.saveCache(existingPaths, primaryKey)
  if (cacheId === -1) {
    return
  }

  core.info(`StaticSitesClient cache saved with the key: ${primaryKey}`)
}
