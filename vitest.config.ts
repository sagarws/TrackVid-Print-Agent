import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
      '@main': resolve(__dirname, 'electron/main')
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    restoreMocks: true
  }
})
