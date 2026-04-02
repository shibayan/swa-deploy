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
      appLocation: getOptionalInput('app_location') ?? '.',
      outputLocation: getOptionalInput('output_location') ?? '.',
      apiLocation: getOptionalInput('api_location'),
      swaConfigLocation: getOptionalInput('swa_config_location'),
      deploymentToken: getOptionalInput('deployment_token'),
      environment: getOptionalInput('environment') ?? 'production',
      apiLanguage: getOptionalInput('api_language'),
      apiVersion: getOptionalInput('api_version')
    })

    if (result.deploymentUrl) {
      core.setOutput('deployment_url', result.deploymentUrl)
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

function getOptionalInput(name: string): string | undefined {
  const value = core.getInput(name)
  return value.trim() === '' ? undefined : value
}
