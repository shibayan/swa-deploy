// See: https://rolldown.rs/guide/getting-started

import { defineConfig } from 'rolldown'

const config = defineConfig({
  input: 'src/index.ts',
  platform: 'node',
  tsconfig: 'tsconfig.json',
  output: {
    esModule: true,
    file: 'dist/index.js',
    format: 'es',
    sourcemap: true
  }
})

export default config
