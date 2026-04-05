import * as os from 'node:os'
import * as path from 'node:path'

export const DEPLOY_BINARY_NAME = 'StaticSitesClient'
export const DEPLOY_BINARY_STABLE_TAG = 'stable'
export const DEPLOY_FOLDER = path.join(os.homedir(), '.swa', 'deploy')
export const STATIC_SITE_CLIENT_RELEASE_METADATA_URL =
  'https://aka.ms/swalocaldeploy'
