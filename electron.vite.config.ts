import { resolve } from 'path'
import { readFileSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// The version the app reports, from the one place that has to be right anyway:
// electron-builder reads package.json to name the installer, so anything else
// claiming to be the version is a second copy waiting to disagree with it.
const APP_VERSION: string =
  (JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as { version: string }).version

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), {
      name: 'context-runtime-bridge',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'mnemosyne-sidecar.py', source: readFileSync(resolve('electron/main/context/mnemosyne-sidecar.py')) })
      }
    }],
    build: {
      lib: {
        entry: { index: resolve('electron/main/index.ts'), 'context-worker': resolve('electron/main/context/worker.ts'), 'context-backup-inspection': resolve('electron/main/context/backup-inspection-worker.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve('electron/preload/index.ts')
      }
    }
  },
  renderer: {
    root: resolve('src'),
    build: {
      rollupOptions: {
        input: resolve('src/index.html')
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve('src'),
        '@': resolve('src')
      }
    },
    plugins: [react()],
    define: { __APP_VERSION__: JSON.stringify(APP_VERSION) }
  }
})
