/**
 * Unit tests for the action's main functionality, src/main.ts
 *
 * To mock dependencies in ESM, you can create fixtures that export mock
 * functions and objects. For example, the core module is mocked in this test,
 * so that the actual '@actions/core' module is not imported.
 */
import { jest } from '@jest/globals'
import * as cache from '../__fixtures__/cache.js'
import * as core from '../__fixtures__/core.js'
import { runDeployment } from '../__fixtures__/deploy.js'

// Mocks should be declared before the module being tested is imported.
jest.unstable_mockModule('../src/cache.js', () => cache)
jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('../src/deploy.js', () => ({ runDeployment }))

// The module being tested should be imported dynamically. This ensures that the
// mocks are used in place of any actual dependencies.
const { run } = await import('../src/main.js')

describe('main.ts', () => {
  beforeEach(() => {
    core.getInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        app_location: '.',
        output_location: 'dist',
        environment: 'production'
      }

      return inputs[name] ?? ''
    })
    cache.restoreStaticSiteClientCache.mockResolvedValue(undefined)
    runDeployment.mockResolvedValue({
      deploymentUrl: 'https://polite-wave-012345678.1.azurestaticapps.net'
    })
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('Sets the deployment_url output', async () => {
    await run()

    expect(cache.restoreStaticSiteClientCache).toHaveBeenCalledTimes(1)
    expect(core.setOutput).toHaveBeenNthCalledWith(
      1,
      'deployment_url',
      'https://polite-wave-012345678.1.azurestaticapps.net'
    )
  })

  it('Sets a failed status', async () => {
    runDeployment.mockRejectedValueOnce(new Error('deployment failed'))

    await run()

    expect(core.setFailed).toHaveBeenNthCalledWith(1, 'deployment failed')
  })

  it('Warns when cache restore fails and continues deployment', async () => {
    cache.restoreStaticSiteClientCache.mockRejectedValueOnce(
      new Error('cache restore failed')
    )

    await run()

    expect(core.warning).toHaveBeenCalledWith(
      'Failed to restore the StaticSitesClient cache: cache restore failed'
    )
    expect(runDeployment).toHaveBeenCalledTimes(1)
  })
})
