import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const sharedAlias = { '@shared': resolve(__dirname, 'shared') }

/*
 * Same three targets as Trackvid-CMS, trimmed to what this app has: no
 * obfuscation pass, no baked-in env, no Next shims.
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { ...sharedAlias, '@main': resolve(__dirname, 'electron/main') } },
    build: {
      outDir: 'out/main',
      minify: 'esbuild',
      lib: { entry: resolve(__dirname, 'electron/main/main.ts') },
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'main.js' } }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sharedAlias },
    build: {
      outDir: 'out/preload',
      minify: 'esbuild',
      // Must stay CommonJS: sandboxed preload scripts cannot be ES modules.
      lib: { entry: resolve(__dirname, 'electron/preload/preload.ts') },
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'preload.js' } }
    }
  },
  renderer: {
    root: resolve(__dirname, 'electron/renderer'),
    plugins: [react(), tailwindcss()],
    // Monitor's aliases, spelled the same way, so the ported theme files stay
    // byte-comparable with Trackvid-CMS and Monitor.
    resolve: {
      alias: {
        ...sharedAlias,
        '@renderer': resolve(__dirname, 'electron/renderer'),
        '@core': resolve(__dirname, 'electron/renderer/@core'),
        '@layouts': resolve(__dirname, 'electron/renderer/@layouts'),
        '@configs': resolve(__dirname, 'electron/renderer/configs'),
        '@': resolve(__dirname, 'electron/renderer')
      }
    },
    server: { port: 5183, strictPort: true },
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      emptyOutDir: true,
      minify: 'esbuild',
      sourcemap: false,
      rollupOptions: { input: resolve(__dirname, 'electron/renderer/index.html') }
    }
  }
})
