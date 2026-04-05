import * as fs from 'node:fs'
import * as path from 'node:path'

export function resolveDirectory(
  workingDirectory: string,
  location: string,
  kind: string
): { absolutePath: string; relativePath: string } {
  const absolutePath = path.resolve(workingDirectory, location)
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`The ${kind} folder "${absolutePath}" does not exist.`)
  }

  return {
    absolutePath,
    relativePath: toRepositoryRelativePath(workingDirectory, absolutePath)
  }
}

export function toRepositoryRelativePath(
  workingDirectory: string,
  absolutePath: string
): string {
  const relativePath = path.relative(workingDirectory, absolutePath)
  return relativePath === '' ? '.' : relativePath
}

export async function findApiFolderInPath(
  appPath: string
): Promise<string | undefined> {
  const entries = await fs.promises.readdir(appPath, { withFileTypes: true })
  return entries.find(
    (entry: fs.Dirent) =>
      entry.name.toLowerCase() === 'api' && entry.isDirectory()
  )?.name
}

export function isProductionEnvironment(environment: string): boolean {
  const lower = environment.toLowerCase()
  return lower === 'prod' || lower === 'production'
}
