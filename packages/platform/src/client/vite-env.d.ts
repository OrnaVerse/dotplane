/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PLATFORM_URL_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
