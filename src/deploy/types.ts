import type { ChildProcess } from 'node:child_process'
import type { spawn } from 'node:child_process'
import type {
  StaticSiteARMResource,
  WebSiteManagementClient
} from '@azure/arm-appservice'

export interface DeployInputs {
  appLocation?: string
  apiLocation?: string
  deploymentToken?: string
  appName?: string
  resourceGroupName?: string
  environment?: string
  apiLanguage?: string
  apiVersion?: string
}

export interface DeployResult {
  deploymentUrl?: string
}

export type StaticSitesOperations = Pick<
  WebSiteManagementClient['staticSites'],
  'list' | 'getStaticSite' | 'listStaticSiteSecrets'
>

export interface AzureSubscription {
  subscriptionId: string
  displayName?: string
}

export interface StaticWebAppLocation {
  subscriptionId: string
  resourceGroupName: string
}

export type DeployChildProcess = ChildProcess & {
  stdout: NodeJS.ReadableStream
  stderr: NodeJS.ReadableStream
}

export interface DeploymentDependencies {
  getDeployClientPath: (releaseVersion?: string) => Promise<{
    binary: string
    buildId: string
  }>
  spawn: typeof spawn
  createStaticSitesClient: (subscriptionId: string) => StaticSitesOperations
  listSubscriptions: () => Promise<AzureSubscription[]>
  cleanUp: () => void
  setSecret: (secret: string) => void
  info: (message: string) => void
  warning: (message: string) => void
  debug: (message: string) => void
}

export type StaticSiteResource = Pick<StaticSiteARMResource, 'id' | 'name'>
