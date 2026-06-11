export const MEMORY_TIERS = {
  minimal: {
    memoryHigh: '200M',
    memoryMax: '256M',
    cpuQuota: '50%',
    gcHeapHardLimit: 192 * 1024 * 1024,
    memoryMaxBytes: 256 * 1024 * 1024,
  },
  standard: {
    memoryHigh: '400M',
    memoryMax: '512M',
    cpuQuota: '80%',
    gcHeapHardLimit: 384 * 1024 * 1024,
    memoryMaxBytes: 512 * 1024 * 1024,
  },
  professional: {
    memoryHigh: '600M',
    memoryMax: '768M',
    cpuQuota: '120%',
    gcHeapHardLimit: 576 * 1024 * 1024,
    memoryMaxBytes: 768 * 1024 * 1024,
  },
  enterprise: {
    memoryHigh: '800M',
    memoryMax: '1024M',
    cpuQuota: '160%',
    gcHeapHardLimit: 768 * 1024 * 1024,
    memoryMaxBytes: 1024 * 1024 * 1024,
  },
} as const

export type MemoryTierName = keyof typeof MEMORY_TIERS

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env: ${name}`)
  return value
}

export const agentConfig = {
  port: parseInt(process.env.AGENT_PORT ?? '7823', 10),
  host: process.env.AGENT_HOST ?? '127.0.0.1',
  certPath: requireEnv('AGENT_CERT_PATH'),
  keyPath: requireEnv('AGENT_KEY_PATH'),
  caCertPath: requireEnv('CA_CERT_PATH'),
  platformUrl: process.env.PLATFORM_URL,
  serverId: process.env.SERVER_ID,
  agentCallbackToken: process.env.AGENT_CALLBACK_TOKEN,
  caddyAdmin: process.env.CADDY_ADMIN ?? 'http://localhost:2019',
  caddyAdminToken: process.env.CADDY_ADMIN_TOKEN,
  databaseUrl: process.env.DATABASE_URL,
  pgHost: process.env.PG_HOST ?? 'localhost',
  pgPort: parseInt(process.env.PG_PORT ?? '5432', 10),
  pgUser: process.env.PG_USER,
  pgPassword: process.env.PG_PASSWORD,
  pgDatabase: process.env.PG_DATABASE ?? 'postgres',
  instancesRoot: process.env.INSTANCES_ROOT ?? '/var/dotplane/instances',
  certCheckPaths: (process.env.CERT_CHECK_PATHS ?? '/etc/caddy').split(',').map((p) => p.trim()),
  fnmDir: process.env.FNM_DIR ?? '/usr/local/share/fnm',
  dotnetInstallDir: process.env.DOTNET_INSTALL_DIR ?? '/usr/share/dotnet',
} as const
