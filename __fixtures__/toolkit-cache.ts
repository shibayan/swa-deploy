import { jest } from '@jest/globals'

export const isFeatureAvailable = jest.fn<() => boolean>()
export const restoreCache =
  jest.fn<
    (paths: string[], primaryKey: string) => Promise<string | undefined>
  >()
export const saveCache =
  jest.fn<(paths: string[], primaryKey: string) => Promise<number>>()
