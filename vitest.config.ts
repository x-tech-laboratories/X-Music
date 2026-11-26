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
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    benchmark: { include: ['bench/**/*.bench.ts'] },
    coverage: {
      provider: 'v8',
      include: ['src/shared/**', 'src/main/library/**'],
      // Raise the floor to the integer reached; never lower it.
      thresholds: {
        lines: 92,
        functions: 89,
        branches: 80,
        statements: 89,
        autoUpdate: (new_threshold: number) => Math.floor(new_threshold)
      }
    }
  }
})
