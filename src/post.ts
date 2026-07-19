import * as core from '@actions/core'
import { saveStaticSiteClientCache } from './cache.js'

export async function runPost(): Promise<void> {
  try {
    await saveStaticSiteClientCache()
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}
