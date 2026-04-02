import { jest } from '@jest/globals'

export const restoreStaticSiteClientCache =
  jest.fn<typeof import('../src/cache.js').restoreStaticSiteClientCache>()

export const saveStaticSiteClientCache =
  jest.fn<typeof import('../src/cache.js').saveStaticSiteClientCache>()

export const CacheState = {
  PostRun: 'SWA_DEPLOY_IS_POST',
  PrimaryKey: 'SWA_DEPLOY_CACHE_PRIMARY_KEY',
  MatchedKey: 'SWA_DEPLOY_CACHE_MATCHED_KEY',
  Paths: 'SWA_DEPLOY_CACHE_PATHS'
} as const
