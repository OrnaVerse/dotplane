import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '')
  const urlKey = env.VITE_PLATFORM_URL_KEY ?? 'dev'

  return {
    root: __dirname,
    publicDir: path.resolve(__dirname, 'public'),
    // Production uses relative assets — URL key comes from the browser path at runtime.
    base: mode === 'production' ? './' : `/${urlKey}/`,
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        [`/${urlKey}/api`]: {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          rewrite: (p) => `/${urlKey}${p}`,
        },
      },
    },
    build: {
      outDir: path.resolve(__dirname, '../../dist/client'),
      emptyOutDir: true,
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          sw: path.resolve(__dirname, 'sw.ts'),
        },
        output: {
          entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname),
      },
    },
  }
})
