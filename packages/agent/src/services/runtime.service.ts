import { execa } from 'execa'
import { agentConfig, MEMORY_TIERS, MemoryTierName } from '../config.js'

export type AppRuntime = 'dotnet' | 'node'

export interface OverrideConfParams {
  port: number
  memoryTier: MemoryTierName
  envVars: Record<string, string>
  runtime?: AppRuntime
  runtimeVersion?: string
}

export function buildOverrideConf(params: OverrideConfParams): string {
  const { port, memoryTier, envVars, runtime = 'dotnet' } = params
  const tier = MEMORY_TIERS[memoryTier]

  const envLines = Object.entries(envVars)
    .map(([key, value]) => `Environment="${key}=${value}"`)
    .join('\n')

  if (runtime === 'node') {
    const fnmBin = `${agentConfig.fnmDir}/aliases/default/bin`
    return `
[Service]
Environment=PORT=${port}
Environment=NODE_ENV=production
Environment=PATH=${fnmBin}:/usr/local/bin:/usr/bin:/bin
${envLines}
MemoryHigh=${tier.memoryHigh}
MemoryMax=${tier.memoryMax}
CPUQuota=${tier.cpuQuota}
`.trim()
  }

  return `
[Service]
Environment=ASPNETCORE_URLS=http://localhost:${port}
Environment=DOTNET_GCHeapHardLimit=${tier.gcHeapHardLimit}
${envLines}
MemoryHigh=${tier.memoryHigh}
MemoryMax=${tier.memoryMax}
CPUQuota=${tier.cpuQuota}
`.trim()
}

export async function listRuntimes(): Promise<{ dotnet: string[]; node: string[] }> {
  const dotnet = await listDotnetRuntimes()
  const node = await listNodeRuntimes()
  return { dotnet, node }
}

async function listDotnetRuntimes(): Promise<string[]> {
  try {
    const { stdout } = await execa('dotnet', ['--list-runtimes'])
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/\s+/)
        return `${parts[0] ?? ''} ${parts[1] ?? ''}`.trim()
      })
  } catch {
    return []
  }
}

async function listNodeRuntimes(): Promise<string[]> {
  try {
    const { stdout } = await execa('/usr/local/bin/fnm', ['list', '--installed'], {
      env: { ...process.env, FNM_DIR: agentConfig.fnmDir },
    })
    return stdout
      .split('\n')
      .map((line) => line.replace(/^\*\s*/, '').trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

export async function installRuntime(runtime: AppRuntime, version: string): Promise<void> {
  if (runtime === 'dotnet') {
    await installDotnetRuntime(version)
    return
  }
  await installNodeRuntime(version)
}

async function installDotnetRuntime(version: string): Promise<void> {
  const script = '/opt/dotplane/scripts/dotnet-install.sh'
  await execa('sudo', [
    'bash',
    script,
    '--runtime',
    'aspnetcore',
    '--version',
    version,
    '--install-dir',
    '/usr/share/dotnet',
    '--no-path',
  ])
}

async function installNodeRuntime(version: string): Promise<void> {
  await execa('/usr/local/bin/fnm', ['install', version], {
    env: { ...process.env, FNM_DIR: agentConfig.fnmDir },
  })
  await execa('/usr/local/bin/fnm', ['default', version], {
    env: { ...process.env, FNM_DIR: agentConfig.fnmDir },
  })
}
