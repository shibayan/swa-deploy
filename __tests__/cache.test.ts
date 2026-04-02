import { jest } from '@jest/globals'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as core from '../__fixtures__/core.js'
import * as staticSiteClient from '../__fixtures__/static-site-client.js'
import * as toolkitCache from '../__fixtures__/toolkit-cache.js'

jest.unstable_mockModule('@actions/cache', () => toolkitCache)
jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('../src/static-site-client.js', () => staticSiteClient)

const { CacheState, restoreStaticSiteClientCache, saveStaticSiteClientCache } =
  await import('../src/cache.js')

describe('cache.ts', () => {
  let cacheDirectory: string

  beforeEach(() => {
    cacheDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'swa-cache-'))

    toolkitCache.isFeatureAvailable.mockReturnValue(true)
    toolkitCache.restoreCache.mockResolvedValue(undefined)
    toolkitCache.saveCache.mockResolvedValue(1)
    staticSiteClient.getDeployCacheInfo.mockResolvedValue({
      primaryKey: 'swa-deploy-static-sites-client-linux-x64-build-sha',
      paths: [cacheDirectory]
    })
    core.getState.mockImplementation((name: string) => {
      const values: Record<string, string> = {
        [CacheState.PrimaryKey]:
          'swa-deploy-static-sites-client-linux-x64-build-sha',
        [CacheState.MatchedKey]: '',
        [CacheState.Paths]: JSON.stringify([cacheDirectory])
      }

      return values[name] ?? ''
    })
  })

  afterEach(() => {
    fs.rmSync(cacheDirectory, { recursive: true, force: true })
    jest.restoreAllMocks()
  })

  it('restores StaticSitesClient cache and stores state', async () => {
    toolkitCache.restoreCache.mockResolvedValueOnce(
      'swa-deploy-static-sites-client-linux-x64-build-sha'
    )

    await restoreStaticSiteClientCache()

    expect(core.saveState).toHaveBeenCalledWith(CacheState.PostRun, 'true')
    expect(core.saveState).toHaveBeenCalledWith(
      CacheState.PrimaryKey,
      'swa-deploy-static-sites-client-linux-x64-build-sha'
    )
    expect(core.saveState).toHaveBeenCalledWith(
      CacheState.Paths,
      JSON.stringify([cacheDirectory])
    )
    expect(core.saveState).toHaveBeenCalledWith(
      CacheState.MatchedKey,
      'swa-deploy-static-sites-client-linux-x64-build-sha'
    )
    expect(core.info).toHaveBeenCalledWith(
      'StaticSitesClient cache restored from key: swa-deploy-static-sites-client-linux-x64-build-sha'
    )
  })

  it('saves StaticSitesClient cache on cache miss', async () => {
    await saveStaticSiteClientCache()

    expect(toolkitCache.saveCache).toHaveBeenCalledWith(
      [cacheDirectory],
      'swa-deploy-static-sites-client-linux-x64-build-sha'
    )
    expect(core.info).toHaveBeenCalledWith(
      'StaticSitesClient cache saved with the key: swa-deploy-static-sites-client-linux-x64-build-sha'
    )
  })

  it('does not save cache when the primary key already matched', async () => {
    core.getState.mockImplementation((name: string) => {
      const values: Record<string, string> = {
        [CacheState.PrimaryKey]:
          'swa-deploy-static-sites-client-linux-x64-build-sha',
        [CacheState.MatchedKey]:
          'swa-deploy-static-sites-client-linux-x64-build-sha',
        [CacheState.Paths]: JSON.stringify([cacheDirectory])
      }

      return values[name] ?? ''
    })

    await saveStaticSiteClientCache()

    expect(toolkitCache.saveCache).not.toHaveBeenCalled()
    expect(core.info).toHaveBeenCalledWith(
      'Cache hit occurred on the primary key swa-deploy-static-sites-client-linux-x64-build-sha, not saving cache.'
    )
  })
})
