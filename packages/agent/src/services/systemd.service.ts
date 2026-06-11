import { execa } from 'execa'
import fs from 'fs/promises'
import { agentConfig } from '../config.js'
import type { MemoryTierName } from '../config.js'
import { buildOverrideConf } from './runtime.service.js'

const OVERRIDE_BASE = '/etc/systemd/system/dotnet-app@'
const UNIT_TEMPLATE = 'dotnet-app@'

function overridePath(instanceId: string): string {
  return `${OVERRIDE_BASE}${instanceId}.service.d/override.conf`
}

function overrideDir(instanceId: string): string {
  return `${OVERRIDE_BASE}${instanceId}.service.d`
}

async function systemctl(args: string[]): Promise<void> {
  await execa('sudo', ['systemctl', ...args])
}

export async function createInstance(params: {
  instanceId: string
  appPath: string
  uploadsPath: string
  port: number
  memoryTier: MemoryTierName
  envVars: Record<string, string>
  runtime?: 'dotnet' | 'node'
}): Promise<void> {
  const { instanceId, appPath, uploadsPath, port, memoryTier, envVars, runtime = 'dotnet' } = params

  await fs.mkdir(appPath, { recursive: true })
  await fs.mkdir(uploadsPath, { recursive: true })
  await execa('sudo', ['mkdir', '-p', overrideDir(instanceId)])

  const override = buildOverrideConf({ port, memoryTier, envVars, runtime })
  await execa('sudo', ['tee', overridePath(instanceId)], { input: override })

  await daemonReload()
  await systemctl(['enable', `${UNIT_TEMPLATE}${instanceId}`])
}

export async function startInstance(instanceId: string): Promise<void> {
  await systemctl(['start', `${UNIT_TEMPLATE}${instanceId}`])
}

export async function stopInstance(instanceId: string): Promise<void> {
  await systemctl(['stop', `${UNIT_TEMPLATE}${instanceId}`])
}

export async function reloadInstance(instanceId: string): Promise<void> {
  await systemctl(['reload', `${UNIT_TEMPLATE}${instanceId}`])
}

export async function removeInstance(instanceId: string, deleteData: boolean): Promise<void> {
  await execa('sudo', ['systemctl', 'stop', `${UNIT_TEMPLATE}${instanceId}`]).catch(() => undefined)
  await execa('sudo', ['systemctl', 'disable', `${UNIT_TEMPLATE}${instanceId}`]).catch(() => undefined)

  await execa('sudo', ['rm', '-rf', overrideDir(instanceId)]).catch(() => undefined)
  await daemonReload()

  if (deleteData) {
    await fs.rm(`${agentConfig.instancesRoot}/${instanceId}`, { recursive: true, force: true })
  }
}

export async function getStatus(instanceIds?: string[]): Promise<Record<string, InstanceStatus>> {
  const pattern = instanceIds
    ? instanceIds.map((id) => `${UNIT_TEMPLATE}${id}`).join(' ')
    : `${UNIT_TEMPLATE}*`

  const { stdout } = await execa('sudo', [
    'systemctl',
    'show',
    pattern,
    '--property=Id,ActiveState,SubState,MainPID,MemoryCurrent,CPUUsageNSec,NRestarts,ActiveEnterTimestamp',
    '--no-pager',
  ])

  return parseSystemctlShow(stdout)
}

export async function getLogs(instanceId: string, lines: number): Promise<string> {
  const { stdout } = await execa('sudo', [
    'journalctl',
    '-u',
    `${UNIT_TEMPLATE}${instanceId}`,
    '-n',
    String(lines),
    '--no-pager',
    '--output=json',
  ])
  return stdout
}

async function daemonReload(): Promise<void> {
  await systemctl(['daemon-reload'])
}

function parseSystemctlShow(output: string): Record<string, InstanceStatus> {
  const results: Record<string, InstanceStatus> = {}
  const blocks = output.split('\n\n').filter(Boolean)

  for (const block of blocks) {
    const props: Record<string, string> = {}
    for (const line of block.split('\n')) {
      const eq = line.indexOf('=')
      if (eq > 0) props[line.slice(0, eq)] = line.slice(eq + 1)
    }
    const rawId = props.Id ?? ''
    const instanceId = rawId.replace(UNIT_TEMPLATE, '').replace('.service', '')
    if (!instanceId) continue

    results[instanceId] = {
      activeState: props.ActiveState ?? 'unknown',
      subState: props.SubState ?? 'unknown',
      mainPid: parseInt(props.MainPID ?? '0', 10),
      memoryBytes: parseInt(props.MemoryCurrent ?? '0', 10),
      restartCount: parseInt(props.NRestarts ?? '0', 10),
      startedAt: props.ActiveEnterTimestamp ?? null,
    }
  }
  return results
}

export interface InstanceStatus {
  activeState: string
  subState: string
  mainPid: number
  memoryBytes: number
  restartCount: number
  startedAt: string | null
}
