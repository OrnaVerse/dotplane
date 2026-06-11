import fs from 'fs'
import { Agent, fetch as undiciFetch } from 'undici'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { servers } from '../db/schema.js'
import { MEMORY_TIERS, requireEnv } from '../config.js'
import type { MemoryTierName } from '../config.js'

export type HealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown'

export interface CreateInstanceParams {
  instanceId: string
  appPath: string
  uploadsPath: string
  port: number
  memoryTier: MemoryTierName
  envVars: Record<string, string>
  runtime?: string
  runtimeVersion?: string
}

export interface DeployInstanceParams {
  instanceId: string
  artifactUrl: string
  version: string
  appPath: string
  uploadsPath: string
}

export interface InstanceStatusEntry {
  instanceId: string
  activeState: string
  subState: string
  memoryBytes?: number
  cpuPercent?: number
  restartCount?: number
}

export interface FirewallStatus {
  enabled: boolean
  defaultIncoming: string
  defaultOutgoing: string
  rules: Array<{ port: string; action: string; from: string }>
}

export interface Fail2banStatus {
  enabled: boolean
  jails: Array<{ name: string; currentlyBanned: number; totalBanned: number }>
}

export interface CertStatus {
  domain: string
  expiresAt: string
  issuer: string
  daysRemaining: number
}

export interface PgMetrics {
  connectionsTotal: number
  connectionsActive: number
  connectionsIdle: number
  connectionsWaiting: number
  dbSizeBytes: number
  cacheHitRatio: number
  tpsCommit: number
  tpsRollback: number
  longQueries: Array<{ pid: number; durationMs: number; state: string; queryTruncated: string }>
  replicationLagBytes: number | null
  bloatEstimate: Array<{ schema: string; table: string; bloatRatio: number }>
  autovacuumRunning: boolean
}

export interface InstalledSdk {
  sdkVersion: string
  runtimeVersion: string
  installPath: string
}

export interface InstalledRuntime {
  runtime: string
  version: string
}

let sharedDispatcher: Agent | null = null

function getDispatcher(): Agent {
  if (!sharedDispatcher) {
    sharedDispatcher = new Agent({
      connect: {
        cert: fs.readFileSync(requireEnv('MTLS_CLIENT_CERT_PATH')),
        key: fs.readFileSync(requireEnv('MTLS_CLIENT_KEY_PATH')),
        ca: [fs.readFileSync(requireEnv('MTLS_CA_CERT_PATH'))],
        rejectUnauthorized: true,
      },
    })
  }
  return sharedDispatcher
}

export class AgentService {
  private baseUrl = ''
  private readonly initPromise: Promise<void>

  constructor(private readonly serverId: string) {
    this.initPromise = this.loadServer()
  }

  private async loadServer(): Promise<void> {
    const [server] = await db.select().from(servers).where(eq(servers.id, this.serverId))
    if (!server) {
      throw new Error(`Server not found: ${this.serverId}`)
    }
    this.baseUrl = `https://${server.hostname}:${server.agentPort}`
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    await this.initPromise

    const res = await undiciFetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      dispatcher: getDispatcher(),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Agent error ${res.status}: ${errText}`)
    }

    if (res.status === 204) {
      return undefined as T
    }

    return res.json() as Promise<T>
  }

  async createInstance(params: CreateInstanceParams): Promise<void> {
    const tier = MEMORY_TIERS[params.memoryTier]
    await this.request('POST', '/instances/create', {
      ...params,
      memoryHigh: tier.memoryHigh,
      memoryMax: tier.memoryMax,
      cpuQuota: tier.cpuQuota,
      gcHeapHardLimit: tier.gcHeapHardLimit,
    })
  }

  async deployInstance(params: DeployInstanceParams): Promise<void> {
    await this.request('POST', '/instances/deploy', params)
  }

  async startInstance(instanceId: string): Promise<void> {
    await this.request('POST', `/instances/${instanceId}/start`)
  }

  async stopInstance(instanceId: string): Promise<void> {
    await this.request('POST', `/instances/${instanceId}/stop`)
  }

  async removeInstance(instanceId: string, deleteData: boolean): Promise<void> {
    await this.request('POST', `/instances/${instanceId}/remove`, { deleteData })
  }

  async getStatus(instanceIds?: string[]): Promise<InstanceStatusEntry[]> {
    const query = instanceIds?.length ? `?ids=${instanceIds.join(',')}` : ''
    return this.request<InstanceStatusEntry[]>('GET', `/instances/status${query}`)
  }

  async healthCheck(instanceId: string, port: number): Promise<HealthStatus> {
    try {
      const result = await this.request<{ status: HealthStatus }>(
        'GET',
        `/instances/${instanceId}/health?port=${port}`,
      )
      return result.status
    } catch {
      return 'down'
    }
  }

  async addCaddyRoute(domain: string, port: number, instanceId: string): Promise<void> {
    await this.request('POST', '/caddy/routes', { domain, port, instanceId })
  }

  async removeCaddyRoute(instanceId: string): Promise<void> {
    await this.request('DELETE', `/caddy/routes/${instanceId}`)
  }

  async installSdk(version: string): Promise<void> {
    await this.request('POST', '/sdk/install', { version })
  }

  async getInstalledSdks(): Promise<InstalledSdk[]> {
    return this.request<InstalledSdk[]>('GET', '/sdk/installed')
  }

  async streamLogs(instanceId: string, lines: number, onLine: (line: string) => void): Promise<void> {
    await this.initPromise

    const res = await undiciFetch(`${this.baseUrl}/instances/${instanceId}/logs?lines=${lines}`, {
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
      dispatcher: getDispatcher(),
    })

    if (!res.ok || !res.body) {
      throw new Error(`Agent log stream error ${res.status}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? ''

      for (const part of parts) {
        for (const line of part.split('\n')) {
          if (line.startsWith('data: ')) {
            onLine(line.slice(6))
          }
        }
      }
    }
  }

  async getFirewallStatus(): Promise<FirewallStatus> {
    return this.request<FirewallStatus>('GET', '/security/firewall')
  }

  async getFail2banStatus(): Promise<Fail2banStatus> {
    return this.request<Fail2banStatus>('GET', '/security/fail2ban')
  }

  async unbanIp(jail: string, ip: string): Promise<void> {
    await this.request('POST', '/security/fail2ban/unban', { jail, ip })
  }

  async getCertStatus(domain?: string): Promise<CertStatus[]> {
    const query = domain ? `?domain=${encodeURIComponent(domain)}` : ''
    return this.request<CertStatus[]>('GET', `/cert/status${query}`)
  }

  async getPgMetrics(pgHost: string, pgPort: number, pgUser: string, pgPass: string, pgDatabase: string): Promise<PgMetrics> {
    return this.request<PgMetrics>('POST', '/pg/metrics', {
      pgHost,
      pgPort,
      pgUser,
      pgPass,
      pgDatabase,
    })
  }

  async installRuntime(runtime: string, version: string): Promise<void> {
    await this.request('POST', '/runtime/install', { runtime, version })
  }

  async getRuntimes(): Promise<InstalledRuntime[]> {
    return this.request<InstalledRuntime[]>('GET', '/runtime/installed')
  }
}

export async function getAgentForInstance(instanceId: string): Promise<AgentService> {
  const { instances } = await import('../db/schema.js')
  const [instance] = await db.select().from(instances).where(eq(instances.id, instanceId))
  if (!instance) {
    throw new Error(`Instance not found: ${instanceId}`)
  }
  return new AgentService(instance.serverId)
}
