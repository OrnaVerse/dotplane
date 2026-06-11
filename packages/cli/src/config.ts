import fs from 'fs'
import os from 'os'
import path from 'path'

export interface DotplaneConfig {
  url: string
  urlKey: string
  token?: string
  username?: string
}

const CONFIG_DIR = path.join(os.homedir(), '.dotplane')
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json')

export function getConfigPath(): string {
  return CONFIG_PATH
}

export function loadConfig(): DotplaneConfig | null {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
    return JSON.parse(raw) as DotplaneConfig
  } catch {
    return null
  }
}

export function saveConfig(config: DotplaneConfig): void {
  fs.mkdirSync(CONFIG_DIR, { mode: 0o700, recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
}

export function requireConfig(): DotplaneConfig {
  const config = loadConfig()
  if (!config?.url || !config?.urlKey) {
    throw new Error('Not logged in. Run: dotplane-remote login')
  }
  if (!config.token) {
    throw new Error('No access token. Run: dotplane-remote login')
  }
  return config
}

export function apiBase(config: DotplaneConfig): string {
  const base = config.url.replace(/\/$/, '')
  return `${base}/${config.urlKey}/api`
}
