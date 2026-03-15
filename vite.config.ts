import { defineConfig } from 'vite'
import { resolve } from 'path'

const entry = process.env.ENTRY || 'content'

const entries: Record<string, string> = {
  background: resolve(__dirname, 'src/background/index.ts'),
  content: resolve(__dirname, 'src/content/index.ts'),
  options: resolve(__dirname, 'src/options/index.ts'),
  'page-bridge': resolve(__dirname, 'src/content/page-bridge.ts'),
}

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome120',
    rollupOptions: {
      input: entries[entry],
      output: {
        entryFileNames: `${entry}.js`,
        format: 'iife',
        inlineDynamicImports: true,
      },
    },
    modulePreload: false,
    copyPublicDir: false,
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
})
