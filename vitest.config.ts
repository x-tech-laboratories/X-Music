import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@main': resolve('src/main')
    }
  },
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    benchmark: { include: ['bench/**/*.bench.ts'] },
    coverage: {
      provider: 'v8',
      include: ['src/shared/**', 'src/main/query/**', 'src/main/library/**'],
      thresholds: { lines: 70, functions: 70, branches: 60 }
    }
  }
})
