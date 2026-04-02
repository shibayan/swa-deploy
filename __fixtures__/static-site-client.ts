import { jest } from '@jest/globals'

export const getDeployCacheInfo =
  jest.fn<typeof import('../src/static-site-client.js').getDeployCacheInfo>()
