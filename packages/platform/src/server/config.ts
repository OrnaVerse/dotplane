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

export const START_PORT = 5100
export const RESERVED_PORTS = new Set([80, 443, 2019, 3000, 7823])

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env: ${name}`)
  return value
}
