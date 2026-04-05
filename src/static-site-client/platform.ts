import { platform } from '@actions/core'
import type { StaticSiteClientPlatform } from './types.js'

export function getPlatform(): StaticSiteClientPlatform {
  if (platform.arch !== 'x64') {
    throw new Error(`Unsupported architecture: ${platform.arch}`)
  }

  if (platform.isLinux) {
    return 'linux-x64'
  }
  if (platform.isWindows) {
    return 'win-x64'
  }
  if (platform.isMacOS) {
    return 'osx-x64'
  }

  throw new Error(`Unsupported platform: ${platform.platform}`)
}
