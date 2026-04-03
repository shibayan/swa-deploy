import * as core from '@actions/core'
import { restoreStaticSiteClientCache } from './cache.js'
import { runDeployment } from './deploy.js'

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    try {
      await restoreStaticSiteClientCache()
    } catch (error) {
      if (error instanceof Error) {
        core.warning(
          `Failed to restore the StaticSitesClient cache: ${error.message}`
        )
      }
    }

    const result = await runDeployment({
      appLocation: getOptionalInput('app-location') ?? '.',
      apiLocation: getOptionalInput('api-location'),
      deploymentToken: getOptionalInput('deployment-token'),
      appName: getOptionalInput('app-name'),
      resourceGroupName: getOptionalInput('resource-group-name'),
      environment: getOptionalInput('environment'),
      apiLanguage: getOptionalInput('api-language'),
      apiVersion: getOptionalInput('api-version')
    })

    if (result.deploymentUrl) {
      core.setOutput('deployment-url', result.deploymentUrl)
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

function getOptionalInput(name: string): string | undefined {
  const value = core.getInput(name)
  return value.trim() === '' ? undefined : value
}
