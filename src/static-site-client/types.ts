export interface StaticSiteClientReleaseMetadata {
  version: string
  buildId: string
  files: Record<string, { url: string; sha: string }>
}

export interface StaticSiteClientLocalMetadata {
  metadata: StaticSiteClientReleaseMetadata
  binary: string
  checksum: string
}

export interface StaticSiteClientCacheInfo {
  primaryKey: string
  paths: string[]
}

export type StaticSiteClientPlatform = 'linux-x64' | 'win-x64' | 'osx-x64'
