import { jest } from '@jest/globals'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

describe('static-site-client.ts', () => {
  let tempHome: string
  let getDeployCacheInfo: typeof import('../src/static-site-client.js').getDeployCacheInfo
  let getDeployClientPath: typeof import('../src/static-site-client.js').getDeployClientPath

  beforeAll(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'swa-home-'))

    jest.unstable_mockModule('node:os', () => ({
      ...os,
      homedir: () => tempHome
    }))
    ;({ getDeployCacheInfo, getDeployClientPath } =
      await import('../src/static-site-client.js'))
  })

  beforeEach(async () => {
    await fs.rm(path.join(tempHome, '.swa'), { recursive: true, force: true })
  })

  afterAll(async () => {
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
})
