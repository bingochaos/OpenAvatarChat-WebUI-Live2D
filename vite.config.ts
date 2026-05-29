// import legacyPlugin from '@vitejs/plugin-legacy'
import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'
import mkcert from 'vite-plugin-mkcert'

import { join } from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Env files live in the project root, but `root` points at src/renderer, so
  // load them explicitly. loadEnv merges `.env` (+ `.env.local`) with the
  // mode-specific `.env.[mode]` (+ `.env.[mode].local`), the latter winning on
  // conflicts — this is how `.env.production` ships the Live2D defaults while
  // keeping a developer's local `.env` for the dev proxy.
  const env = loadEnv(mode, __dirname, '')

  // server of your OpenAvatarChat
  // if you are not use localhost, you need to start https
  const SERVER_IP = env.VITE_SERVER_IP || ''
  const SERVER_PORT = env.VITE_SERVER_PORT || ''
  // Treat an unset OR explicitly-empty value as "auto-detect from location":
  // `.env.production` sets VITE_USE_SSL= empty so a submodule build never hard
  // codes the dev's http/https choice.
  const USE_SSL =
    env.VITE_USE_SSL === undefined || env.VITE_USE_SSL === ''
      ? undefined
      : env.VITE_USE_SSL === 'true'

  // Only create proxy config when SERVER_IP and SERVER_PORT are defined
  const hasServerConfig = SERVER_IP && SERVER_PORT
  const proxyTarget = hasServerConfig
    ? `${USE_SSL ? 'https' : 'http'}://${SERVER_IP}:${SERVER_PORT}`
    : undefined
  const wsProxyTarget = hasServerConfig
    ? `${USE_SSL ? 'wss' : 'ws'}://${SERVER_IP}:${SERVER_PORT}`
    : undefined

  return {
    root: join(__dirname, 'src', 'renderer'),
    // Auto-expose VITE_* vars from the project-root env files (otherwise Vite
    // would look under `root`, i.e. src/renderer, where no .env exists).
    envDir: __dirname,
    base: './',
    build: {
      outDir: join(__dirname, 'dist'),
      // dist lives outside `root` (src/renderer), so Vite won't clear it by
      // default and stale hashed bundles pile up. Force a clean output so the
      // submodule artifact only contains the current build.
      emptyOutDir: true,
      rollupOptions: {
        input: {
          main: join(__dirname, 'src', 'renderer', 'index.html'),
          manager: join(__dirname, 'src', 'renderer', 'manager.html'),
        },
        output: {
          entryFileNames: `assets/[name].[hash].js`,
          chunkFileNames: `assets/[name].[hash].js`,
          assetFileNames: `assets/[name].[hash].[ext]`,
        },
      },
    },
    define: {
      'import.meta.env.SERVER_IP': JSON.stringify(SERVER_IP),
      'import.meta.env.SERVER_PORT': JSON.stringify(SERVER_PORT),
      'import.meta.env.USE_SSL': JSON.stringify(USE_SSL),
    },
    server: {
      // host: '0.0.0.0',
      // https: USE_SSL,
      // port: 443,
      proxy: hasServerConfig
        ? {
            '/download': {
              target: proxyTarget,
              changeOrigin: true,
              secure: false,
            },
            '/openavatarchat': {
              target: proxyTarget,
              changeOrigin: true,
              secure: false,
            },
            '/webrtc/offer': {
              target: proxyTarget,
              changeOrigin: true,
              secure: false,
            },
            '/ws': {
              target: wsProxyTarget,
              ws: true,
              rewriteWsOrigin: true,
              secure: false,
            },
          }
        : undefined,
    },
    plugins: [
      vue(),
      // 本地开发如果需要https才能走通接口的话，则需要开启mkcert,并且开启mkcert需要sudo权限
      // mkcert({
      //   source: 'coding',
      // }),
      // legacyPlugin({
      //   modernPolyfills: true,
      // }),
    ],
    resolve: {
      alias: {
        '@': join(__dirname, 'src/renderer/src'),
        '@renderer': join(__dirname, 'src/renderer/src'),
      },
    },
  }
})
