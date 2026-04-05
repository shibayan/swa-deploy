import { jest } from '@jest/globals'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { watchDeployProcess } from '../../src/deploy/process.js'

class MockChildProcess
  extends EventEmitter
  implements Partial<ChildProcessWithoutNullStreams>
{
  stdout = new PassThrough()
  stderr = new PassThrough()
}

describe('deploy/process.ts', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('emits complete lines and preserves the trailing remainder until close', async () => {
    const child = new MockChildProcess()
    const info = jest.fn()
    const warning = jest.fn()

    const resultPromise = watchDeployProcess(
      child as ChildProcessWithoutNullStreams,
      {
        info,
        warning
      }
    )

    child.stdout.write('first line\nsecond')
    child.stderr.write('warning line\n')
    child.stdout.end()
    child.stderr.end()
    child.emit('close', 0)

    await expect(resultPromise).resolves.toBeUndefined()
    expect(info).toHaveBeenNthCalledWith(1, 'first line')
    expect(info).toHaveBeenNthCalledWith(2, 'second')
    expect(warning).toHaveBeenCalledWith('warning line')
  })

  it('throws when the child process exits with a non-zero code', async () => {
    const child = new MockChildProcess()
    const info = jest.fn()
    const warning = jest.fn()

    const resultPromise = watchDeployProcess(
      child as ChildProcessWithoutNullStreams,
      { info, warning }
    )

    child.stdout.end()
    child.stderr.end()
    child.emit('close', 1)

    await expect(resultPromise).rejects.toThrow(
      'StaticSitesClient exited with code 1.'
    )
  })

  it('uses stderr failure message when the process exits non-zero', async () => {
    const child = new MockChildProcess()
    const info = jest.fn()
    const warning = jest.fn()

    const resultPromise = watchDeployProcess(
      child as ChildProcessWithoutNullStreams,
      { info, warning }
    )

    child.stderr.write('Deployment failed: bad token\n')
    child.stdout.end()
    child.stderr.end()
    child.emit('close', 1)

    await expect(resultPromise).rejects.toThrow('Deployment failed: bad token')
    expect(warning).toHaveBeenCalledWith('Deployment failed: bad token')
  })

  it('strips ANSI escape sequences from output lines', async () => {
    const child = new MockChildProcess()
    const info = jest.fn()
    const warning = jest.fn()

    const resultPromise = watchDeployProcess(
      child as ChildProcessWithoutNullStreams,
      { info, warning }
    )

    child.stdout.write('\u001b[32mDeploying\u001b[0m\n')
    child.stdout.end()
    child.stderr.end()
    child.emit('close', 0)

    await expect(resultPromise).resolves.toBeUndefined()
    expect(info).toHaveBeenCalledWith('Deploying')
  })

  it('skips empty lines after ANSI stripping', async () => {
    const child = new MockChildProcess()
    const info = jest.fn()
    const warning = jest.fn()

    const resultPromise = watchDeployProcess(
      child as ChildProcessWithoutNullStreams,
      { info, warning }
    )

    child.stdout.write('\u001b[32m\u001b[0m\n')
    child.stdout.write('real line\n')
    child.stdout.end()
    child.stderr.end()
    child.emit('close', 0)

    await expect(resultPromise).resolves.toBeUndefined()
    expect(info).not.toHaveBeenCalledWith('')
    expect(info).toHaveBeenCalledWith('real line')
  })

  it('parses a deployment URL from stdout', async () => {
    const child = new MockChildProcess()
    const info = jest.fn()
    const warning = jest.fn()

    const resultPromise = watchDeployProcess(
      child as ChildProcessWithoutNullStreams,
      { info, warning }
    )

    child.stdout.write(
      'Visit your site at: https://example-123456789.1.azurestaticapps.net\n'
    )
    child.stdout.end()
    child.stderr.end()
    child.emit('close', 0)

    const url = await resultPromise
    expect(url).toBe('https://example-123456789.1.azurestaticapps.net')
  })

  it('detects failure lines on stdout when the process exits non-zero', async () => {
    const child = new MockChildProcess()
    const info = jest.fn()
    const warning = jest.fn()

    const resultPromise = watchDeployProcess(
      child as ChildProcessWithoutNullStreams,
      { info, warning }
    )

    child.stdout.write('Cannot deploy preview to the requested environment\n')
    child.stdout.end()
    child.stderr.end()
    child.emit('close', 1)

    await expect(resultPromise).rejects.toThrow(
      'Cannot deploy preview to the requested environment'
    )
  })

  it('uses unknown exit code message when the process exits with null', async () => {
    const child = new MockChildProcess()
    const info = jest.fn()
    const warning = jest.fn()

    const resultPromise = watchDeployProcess(
      child as ChildProcessWithoutNullStreams,
      { info, warning }
    )

    child.stdout.end()
    child.stderr.end()
    child.emit('close', null)

    await expect(resultPromise).rejects.toThrow(
      'StaticSitesClient exited with code unknown.'
    )
  })
})
