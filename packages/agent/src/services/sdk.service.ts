import { execa } from 'execa'
import fs from 'fs/promises'
import { createWriteStream } from 'fs'
import { pipeline } from 'stream/promises'
import { agentConfig } from '../config.js'

const DOTNET_INSTALL_SCRIPT = '/opt/dotplane/scripts/dotnet-install.sh'

export async function getInstalledSdks(): Promise<{ sdks: string[]; runtimes: string[] }> {
  try {
    const sdkResult = await execa('dotnet', ['--list-sdks'])
    const runtimeResult = await execa('dotnet', ['--list-runtimes'])
    return {
      sdks: sdkResult.stdout.split('\n').filter(Boolean).map((line) => line.split(' ')[0] ?? ''),
      runtimes: runtimeResult.stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const parts = line.split(' ')
          return `${parts[0] ?? ''} ${parts[1] ?? ''}`.trim()
        }),
    }
  } catch {
    return { sdks: [], runtimes: [] }
  }
}

export async function installSdk(
  version: string,
  onProgress: (line: string) => void
): Promise<void> {
  await ensureInstallScript()

  const args = [
    DOTNET_INSTALL_SCRIPT,
    '--version',
    version,
    '--install-dir',
    agentConfig.dotnetInstallDir,
    '--no-path',
  ]

  const proc = execa('sudo', ['bash', ...args])

  proc.stdout?.on('data', (chunk: Buffer) => onProgress(chunk.toString()))
  proc.stderr?.on('data', (chunk: Buffer) => onProgress(chunk.toString()))

  await proc
}

async function ensureInstallScript(): Promise<void> {
  try {
    await fs.access(DOTNET_INSTALL_SCRIPT)
  } catch {
    const res = await fetch('https://dot.net/v1/dotnet-install.sh')
    if (!res.ok || !res.body) throw new Error('Failed to download dotnet-install.sh')
    await fs.mkdir('/opt/dotplane/scripts', { recursive: true })
    const write = createWriteStream(DOTNET_INSTALL_SCRIPT)
    await pipeline(res.body as unknown as NodeJS.ReadableStream, write)
    await fs.chmod(DOTNET_INSTALL_SCRIPT, 0o755)
  }
}
