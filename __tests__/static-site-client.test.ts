import { afterAll as afterAllHook, jest } from '@jest/globals'
import * as core from '@actions/core'
import * as nodeFs from 'node:fs'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

describe('static-site-client.ts', () => {
  let tempHome: string
  let cleanUp: typeof import('../src/static-site-client.js').cleanUp
  let getDeployCacheInfo: typeof import('../src/static-site-client.js').getDeployCacheInfo
  let getDeployClientPath: typeof import('../src/static-site-client.js').getDeployClientPath

  function buildPlatformMock(options: {
    arch?: string
    platform?: NodeJS.Platform
  }) {
    const p = options.platform ?? (os.platform() as NodeJS.Platform)
    const a = options.arch ?? os.arch()
    return {
      ...core,
      platform: {
        platform: p,
        arch: a,
        isLinux: p === 'linux',
        isMacOS: p === 'darwin',
        isWindows: p === 'win32',
        getDetails: core.platform.getDetails
      }
    }
  }

  async function importStaticSiteClientWithOs(
    options: {
      arch?: () => string
      platform?: () => NodeJS.Platform
      writeStreamHighWaterMark?: number
    } = {}
  ) {
    jest.resetModules()
    jest.unstable_mockModule('node:fs', () => ({
      ...nodeFs,
      createWriteStream:
        options.writeStreamHighWaterMark === undefined
          ? nodeFs.createWriteStream
          : (filePath: nodeFs.PathLike) =>
              nodeFs.createWriteStream(filePath, {
                highWaterMark: options.writeStreamHighWaterMark
              })
    }))
    jest.unstable_mockModule('node:os', () => ({
      ...os,
      homedir: () => tempHome,
      arch: options.arch ?? os.arch,
      platform: options.platform ?? os.platform
    }))
    jest.unstable_mockModule('@actions/core', () =>
      buildPlatformMock({
        arch: options.arch?.(),
        platform: options.platform?.()
      })
    )

    return import('../src/static-site-client.js')
  }

  beforeAll(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'swa-home-'))

    jest.unstable_mockModule('node:os', () => ({
      ...os,
      homedir: () => tempHome
    }))
    ;({ cleanUp, getDeployCacheInfo, getDeployClientPath } =
      await import('../src/static-site-client.js'))
  })

  beforeEach(async () => {
    await fs.rm(path.join(tempHome, '.swa'), { recursive: true, force: true })
  })

  afterAllHook(async () => {
    jest.restoreAllMocks()
    await fs.rm(tempHome, { recursive: true, force: true })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('reuses fetched release metadata within a single run', async () => {
    const deployFolder = path.join(tempHome, '.swa', 'deploy')
    const binaryPath = path.join(
      deployFolder,
      'build-memo',
      'StaticSitesClient'
    )
    const checksum =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    const remoteMetadata = {
      version: 'memoized',
      buildId: 'build-memo',
      files: {
        'linux-x64': {
          url: 'https://example.invalid/linux-client',
          sha: checksum
        },
        'win-x64': {
          url: 'https://example.invalid/win-client',
          sha: checksum
        },
        'osx-x64': {
          url: 'https://example.invalid/osx-client',
          sha: checksum
        }
      }
    }

    await fs.mkdir(path.dirname(binaryPath), { recursive: true })
    await fs.writeFile(binaryPath, 'client')
    await fs.writeFile(
      path.join(deployFolder, 'StaticSitesClient.json'),
      JSON.stringify(
        {
          metadata: remoteMetadata,
          binary: binaryPath,
          checksum
        },
        null,
        2
      )
    )

    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify([remoteMetadata])))

    await getDeployCacheInfo('memoized')
    const result = await getDeployClientPath('memoized')

    expect(result.binary).toBe(binaryPath)
    expect(result.buildId).toBe('build-memo')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('downloads and validates the client binary as a stream', async () => {
    const binaryContent = Buffer.from('streamed-client-binary')
    const checksum =
      '15085e5d212c9d207bb80b02a808d12d20dd0a91d8dc7fad1d35dfb0a35ab9ad'
    const remoteMetadata = {
      version: 'download-stream',
      buildId: 'build-stream',
      files: {
        'linux-x64': {
          url: 'https://example.invalid/linux-client',
          sha: checksum
        },
        'win-x64': {
          url: 'https://example.invalid/win-client',
          sha: checksum
        },
        'osx-x64': {
          url: 'https://example.invalid/osx-client',
          sha: checksum
        }
      }
    }

    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input: string | URL | Request) => {
        if (`${input}` === 'https://aka.ms/swalocaldeploy') {
          return new Response(JSON.stringify([remoteMetadata]))
        }

        return new Response(binaryContent)
      })

    const result = await getDeployClientPath('download-stream')
    const writtenBinary = await fs.readFile(result.binary)
    const writtenMetadata = JSON.parse(
      await fs.readFile(
        path.join(tempHome, '.swa', 'deploy', 'StaticSitesClient.json'),
        'utf8'
      )
    ) as { binary: string; checksum: string }

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(writtenBinary.equals(binaryContent)).toBe(true)
    expect(writtenMetadata.binary).toBe(result.binary)
    expect(writtenMetadata.checksum).toBe(checksum)
  })

  it('uses the default stable release on linux when local metadata matches', async () => {
    const deployFolder = path.join(tempHome, '.swa', 'deploy')
    const binaryPath = path.join(
      deployFolder,
      'build-linux-stable',
      'StaticSitesClient'
    )
    const checksum =
      'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd'
    const remoteMetadata = {
      version: 'stable',
      buildId: 'build-linux-stable',
      files: {
        'linux-x64': {
          url: 'https://example.invalid/linux-client',
          sha: checksum
        },
        'win-x64': {
          url: 'https://example.invalid/win-client',
          sha: checksum
        },
        'osx-x64': {
          url: 'https://example.invalid/osx-client',
          sha: checksum
        }
      }
    }
    const module = await importStaticSiteClientWithOs({
      arch: () => 'x64',
      platform: () => 'linux'
    })

    await fs.mkdir(path.dirname(binaryPath), { recursive: true })
    await fs.writeFile(binaryPath, 'linux-client')
    await fs.writeFile(
      path.join(deployFolder, 'StaticSitesClient.json'),
      JSON.stringify(
        {
          metadata: remoteMetadata,
          binary: binaryPath,
          checksum
        },
        null,
        2
      )
    )

    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify([remoteMetadata])))

    const result = await module.getDeployClientPath()
    const cacheInfo = await module.getDeployCacheInfo()

    expect(result).toEqual({
      binary: binaryPath,
      buildId: 'build-linux-stable'
    })
    expect(cacheInfo?.primaryKey).toContain('linux-x64-build-linux-stable')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('downloads a fresh binary when the local checksum mismatches', async () => {
    const deployFolder = path.join(tempHome, '.swa', 'deploy')
    const binaryContent = Buffer.from('checksum-mismatch-download')
    const localBinaryPath = path.join(
      deployFolder,
      'build-checksum-mismatch',
      'StaticSitesClient'
    )
    const remoteMetadata = {
      version: 'checksum-refresh',
      buildId: 'build-checksum-mismatch',
      files: {
        'linux-x64': {
          url: 'https://example.invalid/linux-client',
          sha: 'f73a2a6a2f8f337e8ac8b933f9397a13db8194d8794e12daab9ba396c7b9960f'
        },
        'win-x64': {
          url: 'https://example.invalid/win-client',
          sha: 'f73a2a6a2f8f337e8ac8b933f9397a13db8194d8794e12daab9ba396c7b9960f'
        },
        'osx-x64': {
          url: 'https://example.invalid/osx-client',
          sha: 'f73a2a6a2f8f337e8ac8b933f9397a13db8194d8794e12daab9ba396c7b9960f'
        }
      }
    }

    await fs.mkdir(path.dirname(localBinaryPath), { recursive: true })
    await fs.writeFile(localBinaryPath, 'old-binary')
    await fs.writeFile(
      path.join(deployFolder, 'StaticSitesClient.json'),
      JSON.stringify(
        {
          metadata: remoteMetadata,
          binary: localBinaryPath,
          checksum:
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
        },
        null,
        2
      )
    )

    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input: string | URL | Request) => {
        if (`${input}` === 'https://aka.ms/swalocaldeploy') {
          return new Response(JSON.stringify([remoteMetadata]))
        }

        return new Response(binaryContent)
      })

    const result = await getDeployClientPath('checksum-refresh')
    const writtenBinary = await fs.readFile(result.binary)

    expect(result.buildId).toBe('build-checksum-mismatch')
    expect(writtenBinary.equals(binaryContent)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns undefined cache info when release metadata cannot be fetched', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 503 }))

    const result = await getDeployCacheInfo('missing-release')

    expect(result).toBeUndefined()
  })

  it('throws when release metadata cannot be fetched for deployment', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify([])))

    await expect(getDeployClientPath('missing-client')).rejects.toThrow(
      'Could not load StaticSitesClient metadata from remote. Check network connectivity.'
    )
  })

  it('retries metadata fetch after a transient error', async () => {
    const checksum =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    const remoteMetadata = {
      version: 'retry-after-error',
      buildId: 'build-retry',
      files: {
        'linux-x64': {
          url: 'https://example.invalid/linux-client',
          sha: checksum
        },
        'win-x64': {
          url: 'https://example.invalid/win-client',
          sha: checksum
        },
        'osx-x64': {
          url: 'https://example.invalid/osx-client',
          sha: checksum
        }
      }
    }

    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(new Response(JSON.stringify([remoteMetadata])))

    await expect(getDeployCacheInfo('retry-after-error')).rejects.toThrow(
      'network down'
    )

    const result = await getDeployCacheInfo('retry-after-error')

    expect(result?.primaryKey).toContain('build-retry')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('downloads a fresh binary when local metadata is invalid', async () => {
    const deployFolder = path.join(tempHome, '.swa', 'deploy')
    const binaryContent = Buffer.from('fresh-client-binary')
    const checksum =
      '504a7b2f984f264b1439465f7a65c4bc081ca280a538adefb5d4afd9452a138d'
    const remoteMetadata = {
      version: 'invalid-local-metadata',
      buildId: 'build-fresh',
      files: {
        'linux-x64': {
          url: 'https://example.invalid/linux-client',
          sha: checksum
        },
        'win-x64': {
          url: 'https://example.invalid/win-client',
          sha: checksum
        },
        'osx-x64': {
          url: 'https://example.invalid/osx-client',
          sha: checksum
        }
      }
    }

    await fs.mkdir(deployFolder, { recursive: true })
    await fs.writeFile(path.join(deployFolder, 'StaticSitesClient.json'), '{')

    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input: string | URL | Request) => {
        if (`${input}` === 'https://aka.ms/swalocaldeploy') {
          return new Response(JSON.stringify([remoteMetadata]))
        }

        return new Response(binaryContent)
      })

    const result = await getDeployClientPath('invalid-local-metadata')
    const writtenBinary = await fs.readFile(result.binary)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(writtenBinary.equals(binaryContent)).toBe(true)
  })

  it('downloads a fresh binary when local metadata points to a missing binary', async () => {
    const deployFolder = path.join(tempHome, '.swa', 'deploy')
    const binaryContent = Buffer.from('fresh-client-binary-from-missing-local')
    const checksum =
      '514d825abce2528ad0f685c188b3bc45ae87bf71901ea853d45c66b4e32559ba'
    const missingBinaryPath = path.join(
      deployFolder,
      'missing-build',
      'StaticSitesClient'
    )
    const remoteMetadata = {
      version: 'missing-local-binary',
      buildId: 'build-missing-local',
      files: {
        'linux-x64': {
          url: 'https://example.invalid/linux-client',
          sha: checksum
        },
        'win-x64': {
          url: 'https://example.invalid/win-client',
          sha: checksum
        },
        'osx-x64': {
          url: 'https://example.invalid/osx-client',
          sha: checksum
        }
      }
    }

    await fs.mkdir(deployFolder, { recursive: true })
    await fs.writeFile(
      path.join(deployFolder, 'StaticSitesClient.json'),
      JSON.stringify(
        {
          metadata: remoteMetadata,
          binary: missingBinaryPath,
          checksum
        },
        null,
        2
      )
    )

    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input: string | URL | Request) => {
        if (`${input}` === 'https://aka.ms/swalocaldeploy') {
          return new Response(JSON.stringify([remoteMetadata]))
        }

        return new Response(binaryContent)
      })

    const result = await getDeployClientPath('missing-local-binary')
    const writtenBinary = await fs.readFile(result.binary)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(writtenBinary.equals(binaryContent)).toBe(true)
  })

  it('removes a downloaded binary when checksum validation fails', async () => {
    const binaryContent = Buffer.from('checksum-mismatch')
    const remoteMetadata = {
      version: 'checksum-mismatch',
      buildId: 'build-checksum',
      files: {
        'linux-x64': {
          url: 'https://example.invalid/linux-client',
          sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
        },
        'win-x64': {
          url: 'https://example.invalid/win-client',
          sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
        },
        'osx-x64': {
          url: 'https://example.invalid/osx-client',
          sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
        }
      }
    }
    const expectedBinaryPath = path.join(
      tempHome,
      '.swa',
      'deploy',
      'build-checksum',
      'StaticSitesClient'
    )

    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input: string | URL | Request) => {
        if (`${input}` === 'https://aka.ms/swalocaldeploy') {
          return new Response(JSON.stringify([remoteMetadata]))
        }

        return new Response(binaryContent)
      })

    await expect(getDeployClientPath('checksum-mismatch')).rejects.toThrow(
      'Downloaded StaticSitesClient checksum validation failed.'
    )
    await expect(fs.stat(expectedBinaryPath)).rejects.toThrow()
  })

  it('throws when the binary download request fails', async () => {
    const checksum =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    const remoteMetadata = {
      version: 'download-failed',
      buildId: 'build-download-failed',
      files: {
        'linux-x64': {
          url: 'https://example.invalid/linux-client',
          sha: checksum
        },
        'win-x64': {
          url: 'https://example.invalid/win-client',
          sha: checksum
        },
        'osx-x64': {
          url: 'https://example.invalid/osx-client',
          sha: checksum
        }
      }
    }

    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input: string | URL | Request) => {
        if (`${input}` === 'https://aka.ms/swalocaldeploy') {
          return new Response(JSON.stringify([remoteMetadata]))
        }

        return new Response(null, { status: 404 })
      })

    await expect(getDeployClientPath('download-failed')).rejects.toThrow(
      /Failed to download StaticSitesClient from https:\/\/example\.invalid\/.+-client\./
    )
  })

  it('fails when the download response has no body', async () => {
    const checksum =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    const remoteMetadata = {
      version: 'no-body',
      buildId: 'build-no-body',
      files: {
        'linux-x64': {
          url: 'https://example.invalid/linux-client',
          sha: checksum
        },
        'win-x64': {
          url: 'https://example.invalid/win-client',
          sha: checksum
        },
        'osx-x64': {
          url: 'https://example.invalid/osx-client',
          sha: checksum
        }
      }
    }

    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input: string | URL | Request) => {
        if (`${input}` === 'https://aka.ms/swalocaldeploy') {
          return new Response(JSON.stringify([remoteMetadata]))
        }

        return new Response(null)
      })

    await expect(getDeployClientPath('no-body')).rejects.toThrow(
      'Failed to read the StaticSitesClient download stream.'
    )
  })

  it('removes leftover deployment archives during cleanup', async () => {
    const originalCwd = process.cwd()
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'swa-cleanup-'))

    process.chdir(workspace)
    await fs.writeFile(path.join(workspace, 'app.zip'), 'app')
    await fs.writeFile(path.join(workspace, 'api.zip'), 'api')

    try {
      cleanUp()

      await expect(fs.stat(path.join(workspace, 'app.zip'))).rejects.toThrow()
      await expect(fs.stat(path.join(workspace, 'api.zip'))).rejects.toThrow()
    } finally {
      process.chdir(originalCwd)
      await fs.rm(workspace, { recursive: true, force: true })
    }
  })

  it('ignores unlink failures during cleanup', async () => {
    const originalCwd = process.cwd()
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'swa-cleanup-'))

    process.chdir(workspace)
    await fs.mkdir(path.join(workspace, 'app.zip'))

    try {
      expect(() => cleanUp()).not.toThrow()
      const stats = await fs.stat(path.join(workspace, 'app.zip'))
      expect(stats.isDirectory()).toBe(true)
    } finally {
      process.chdir(originalCwd)
      await fs.rm(workspace, { recursive: true, force: true })
    }
  })

  it('throws for unsupported architectures', async () => {
    const module = await importStaticSiteClientWithOs({ arch: () => 'arm64' })

    await expect(module.getDeployCacheInfo()).rejects.toThrow(
      'Unsupported architecture: arm64'
    )
  })

  it('throws for unsupported platforms', async () => {
    const module = await importStaticSiteClientWithOs({
      arch: () => 'x64',
      platform: () => 'freebsd' as NodeJS.Platform
    })

    await expect(module.getDeployCacheInfo()).rejects.toThrow(
      'Unsupported platform: freebsd'
    )
  })

  it('downloads the darwin client binary with chmod', async () => {
    const binaryContent = Buffer.from('darwin-client-binary')
    const checksum =
      '746c92e9bc3257db5d4154f099beecad4a0973c5609d163d89ac9a7ece52bd33'
    const remoteMetadata = {
      version: 'darwin-download',
      buildId: 'build-darwin',
      files: {
        'linux-x64': {
          url: 'https://example.invalid/linux-client',
          sha: checksum
        },
        'win-x64': {
          url: 'https://example.invalid/win-client',
          sha: checksum
        },
        'osx-x64': {
          url: 'https://example.invalid/osx-client',
          sha: checksum
        }
      }
    }
    const module = await importStaticSiteClientWithOs({
      arch: () => 'x64',
      platform: () => 'darwin'
    })

    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input: string | URL | Request) => {
        if (`${input}` === 'https://aka.ms/swalocaldeploy') {
          return new Response(JSON.stringify([remoteMetadata]))
        }

        return new Response(binaryContent)
      })

    const result = await module.getDeployClientPath('darwin-download')

    expect(result.binary).toBe(
      path.join(tempHome, '.swa', 'deploy', 'build-darwin', 'StaticSitesClient')
    )
    await expect(fs.stat(result.binary)).resolves.toBeDefined()
  })

  it('cleans up and rethrows when the download stream fails mid-read', async () => {
    const remoteMetadata = {
      version: 'stream-error',
      buildId: 'build-stream-error',
      files: {
        'linux-x64': {
          url: 'https://example.invalid/linux-client',
          sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
        },
        'win-x64': {
          url: 'https://example.invalid/win-client',
          sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
        },
        'osx-x64': {
          url: 'https://example.invalid/osx-client',
          sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
        }
      }
    }

    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input: string | URL | Request) => {
        if (`${input}` === 'https://aka.ms/swalocaldeploy') {
          return new Response(JSON.stringify([remoteMetadata]))
        }

        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('partial'))
            controller.error(new Error('network interrupted'))
          }
        })

        return new Response(stream)
      })

    await expect(getDeployClientPath('stream-error')).rejects.toThrow(
      'network interrupted'
    )

    const binaryDir = path.join(
      tempHome,
      '.swa',
      'deploy',
      'build-stream-error'
    )
    const binaryName =
      os.platform() === 'win32' ? 'StaticSitesClient.exe' : 'StaticSitesClient'
    const exists = await fs
      .stat(path.join(binaryDir, binaryName))
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(false)
  })

  it('waits for drain when the binary write stream applies backpressure', async () => {
    const binaryContent = Buffer.from('backpressure-binary-content')
    const checksum =
      '37f5aaf4565ae9ca8eda7b0a5e3eb6f4c1066ae3915d5f1de55b78ee4c576818'
    const remoteMetadata = {
      version: 'backpressure-download',
      buildId: 'build-backpressure',
      files: {
        'linux-x64': {
          url: 'https://example.invalid/linux-client',
          sha: checksum
        },
        'win-x64': {
          url: 'https://example.invalid/win-client',
          sha: checksum
        },
        'osx-x64': {
          url: 'https://example.invalid/osx-client',
          sha: checksum
        }
      }
    }
    const module = await importStaticSiteClientWithOs({
      writeStreamHighWaterMark: 1
    })

    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input: string | URL | Request) => {
        if (`${input}` === 'https://aka.ms/swalocaldeploy') {
          return new Response(JSON.stringify([remoteMetadata]))
        }

        return new Response(binaryContent)
      })

    const result = await module.getDeployClientPath('backpressure-download')
    const writtenBinary = await fs.readFile(result.binary)

    expect(writtenBinary.equals(binaryContent)).toBe(true)
  })

  it('downloads the windows client binary with an exe extension', async () => {
    const binaryContent = Buffer.from('windows-client-binary')
    const checksum =
      'ed2542ac02472ae1846f57005c81b3f2e55903cc15a0d10194c4cc5eb9cb0320'
    const remoteMetadata = {
      version: 'windows-download',
      buildId: 'build-win',
      files: {
        'linux-x64': {
          url: 'https://example.invalid/linux-client',
          sha: checksum
        },
        'win-x64': {
          url: 'https://example.invalid/win-client',
          sha: checksum
        },
        'osx-x64': {
          url: 'https://example.invalid/osx-client',
          sha: checksum
        }
      }
    }
    const module = await importStaticSiteClientWithOs({
      arch: () => 'x64',
      platform: () => 'win32'
    })

    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input: string | URL | Request) => {
        if (`${input}` === 'https://aka.ms/swalocaldeploy') {
          return new Response(JSON.stringify([remoteMetadata]))
        }

        return new Response(binaryContent)
      })

    const result = await module.getDeployClientPath('windows-download')

    expect(result.binary).toBe(
      path.join(
        tempHome,
        '.swa',
        'deploy',
        'build-win',
        'StaticSitesClient.exe'
      )
    )
    await expect(fs.stat(result.binary)).resolves.toBeDefined()
  })
})
