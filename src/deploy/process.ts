import { once } from 'node:events'
import type { DeployChildProcess, DeploymentDependencies } from './types.js'

export async function watchDeployProcess(
  child: DeployChildProcess,
  dependencies: Pick<DeploymentDependencies, 'info' | 'warning'>
): Promise<string | undefined> {
  let stdoutBuffer = ''
  let stderrBuffer = ''
  let deploymentUrl: string | undefined
  let failureMessage: string | undefined

  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')

  child.stdout.on('data', (chunk: string) => {
    stdoutBuffer = emitCompleteLines(stdoutBuffer + chunk, (line) => {
      const cleanLine = sanitizeLine(line)
      if (!cleanLine) {
        return
      }

      deploymentUrl ||= parseDeploymentUrl(cleanLine)
      if (isFailureLine(cleanLine)) {
        failureMessage = cleanLine
      }

      dependencies.info(cleanLine)
    })
  })

  child.stderr.on('data', (chunk: string) => {
    stderrBuffer = emitCompleteLines(stderrBuffer + chunk, (line) => {
      const cleanLine = sanitizeLine(line)
      if (!cleanLine) {
        return
      }

      failureMessage = cleanLine
      dependencies.warning(cleanLine)
    })
  })

  const [code] = (await once(child, 'close')) as [number | null]

  const remainingStdout = sanitizeLine(stdoutBuffer)
  const remainingStderr = sanitizeLine(stderrBuffer)
  if (remainingStdout) {
    deploymentUrl ||= parseDeploymentUrl(remainingStdout)
    dependencies.info(remainingStdout)
  }
  if (remainingStderr) {
    failureMessage = remainingStderr
    dependencies.warning(remainingStderr)
  }

  if (code !== 0) {
    throw new Error(
      failureMessage ??
        `StaticSitesClient exited with code ${code ?? 'unknown'}.`
    )
  }

  return deploymentUrl
}

function emitCompleteLines(
  buffer: string,
  onLine: (line: string) => void
): string {
  const lines = buffer.split(/\r?\n/)
  const remainder = lines.pop() as string

  for (const line of lines) {
    onLine(line)
  }

  return remainder
}

function parseDeploymentUrl(line: string): string | undefined {
  const match = line.match(/https?:\/\/\S+/)
  return match?.[0]
}

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERN = /\u001b\[[^m]*m/g

function sanitizeLine(line: string): string {
  return line.replace(ANSI_ESCAPE_PATTERN, '').trim()
}

const FAILURE_PATTERN = /(\berror\b|deployment failed|cannot deploy)/i

function isFailureLine(line: string): boolean {
  return FAILURE_PATTERN.test(line)
}
