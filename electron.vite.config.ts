import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared }
  },
  preload: {
    resolve: { alias: shared },
    build: {
      // Sandboxed preload scripts must be CommonJS. `picker` is the screen picker's overlay.
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts'), picker: resolve('src/preload/picker.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    resolve: {
      alias: { ...shared, '@': resolve('src/renderer/src') }
    },
    plugins: [react(), tailwindcss()],
    build: {
      // The app window, and the screen picker's overlay (src/main/screenPicker.ts).
      rollupOptions: { input: { index: resolve('src/renderer/index.html'), picker: resolve('src/renderer/picker.html') } }
    }
  }
})
