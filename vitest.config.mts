import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  // many tests start real processes (git, PowerShell) and write run files; on Windows under load one can take
  // several seconds, so the 5 s default made the suite (and npm run dist) fail at random
  test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 30_000, hookTimeout: 30_000 }
})
