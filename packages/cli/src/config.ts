import fs from 'fs'
import os from 'os'
import path from 'path'
import { z } from 'zod'

export interface DotplaneConfig {
  url: string
  urlKey: string
  token?: string
  username?: string
}

const ConfigSchema = z.object({
  url: z.string().url(),
  urlKey: z.string().min(1).max(64),
  token: z.string().min(1).optional(),
  username: z.string().min(1).max(64).optional(),
})

const CONFIG_DIR = path.join(os.homedir(), '.dotplane')
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json')

export function getConfigPath(): string {
  return CONFIG_PATH
}

export function loadConfig(): DotplaneConfig | null {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
    const parsed = ConfigSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return null
    return parsed.data
  } catch {
    return null
  }
}

export function saveConfig(config: DotplaneConfig): void {
  const validated = ConfigSchema.parse(config)
  fs.mkdirSync(CONFIG_DIR, { mode: 0o700, recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(validated, null, 2) + '\n', { mode: 0o600 })
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
