import { jest } from '@jest/globals'

export const runDeployment =
  jest.fn<typeof import('../src/deploy.js').runDeployment>()
