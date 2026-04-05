import * as fs from 'node:fs'
import * as path from 'node:path'

export function cleanUp(): void {
  for (const file of ['app.zip', 'api.zip']) {
    const filePath = path.join(process.cwd(), file)
    try {
      fs.unlinkSync(filePath)
    } catch {
      // Ignore cleanup failures.
    }
  }
}
