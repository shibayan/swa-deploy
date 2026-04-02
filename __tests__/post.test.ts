import { jest } from '@jest/globals'
import * as cache from '../__fixtures__/cache.js'
import * as core from '../__fixtures__/core.js'

jest.unstable_mockModule('../src/cache.js', () => cache)
jest.unstable_mockModule('@actions/core', () => core)

const { runPost } = await import('../src/post.js')

describe('post.ts', () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  it('saves the StaticSitesClient cache', async () => {
    cache.saveStaticSiteClientCache.mockResolvedValueOnce(undefined)

    await runPost()

    expect(cache.saveStaticSiteClientCache).toHaveBeenCalledTimes(1)
  })

  it('fails the action when cache save throws', async () => {
    cache.saveStaticSiteClientCache.mockRejectedValueOnce(
      new Error('cache save failed')
    )

    await runPost()

    expect(core.setFailed).toHaveBeenCalledWith('cache save failed')
  })
})
