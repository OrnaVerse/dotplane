import { count, eq } from 'drizzle-orm'
import { v4 as uuid } from 'uuid'
import { AgentService } from './agent.service.js'
import { getNextAvailablePort } from './utils/port.js'
import { db } from '../db/index.js'
import { instances, provisionJobs, servers } from '../db/schema.js'
import { logger } from '../logger.js'

export type ServerSelectionStrategy = 'least_instances' | 'most_memory' | 'round_robin' | 'specific'

export interface ProvisionRequest {
  id: string
  displayName: string
  appId: string
  domain: string
  memoryTier: 'minimal' | 'standard' | 'professional' | 'enterprise'
  envVars?: Record<string, string>
  initialVersion?: string
  runtimeVersion?: string
}

let roundRobinIndex = 0

export async function createProvisionJob(
  request: ProvisionRequest,
  strategy: ServerSelectionStrategy,
  triggeredBy: number,
  specificServerId?: string,
): Promise<string> {
  const jobId = uuid()

  await db.insert(provisionJobs).values({
    id: jobId,
    status: 'pending',
    appId: request.appId,
    requestBody: request as unknown as Record<string, unknown>,
    triggeredBy,
  })

  void runProvisionJob(jobId, request, strategy, specificServerId)
  return jobId
}

export async function runProvisionJob(
  jobId: string,
  request: ProvisionRequest,
  strategy: ServerSelectionStrategy,
  specificServerId?: string,
): Promise<void> {
  await db
    .update(provisionJobs)
    .set({ status: 'running' })
    .where(eq(provisionJobs.id, jobId))

  try {
    const serverId = specificServerId ?? (await selectServer(strategy))
    const port = await getNextAvailablePort(serverId)
    const appPath = `/var/dotplane/instances/${request.id}/app`
    const uploadsPath = `/var/dotplane/instances/${request.id}/uploads`

    const agent = new AgentService(serverId)
    await agent.createInstance({
      instanceId: request.id,
      appPath,
      uploadsPath,
      port,
      memoryTier: request.memoryTier,
      envVars: request.envVars ?? {},
      runtimeVersion: request.runtimeVersion,
    })

    await agent.addCaddyRoute(request.domain, port, request.id)

    await db.insert(instances).values({
      id: request.id,
      displayName: request.displayName,
      appId: request.appId,
      serverId,
      domain: request.domain,
      port,
      memoryTier: request.memoryTier,
      envVars: request.envVars ?? {},
      appPath,
      uploadsPath,
      runtimeVersion: request.runtimeVersion ?? '8.0',
    })

    await db
      .update(provisionJobs)
      .set({
        status: 'done',
        serverId,
        instanceId: request.id,
        completedAt: new Date().toISOString(),
      })
      .where(eq(provisionJobs.id, jobId))

    if (request.initialVersion) {
      const { DeployService } = await import('./deploy.service.js')
      const deploy = new DeployService()
      await deploy.deployInstanceSSE(request.id, request.initialVersion, 0, () => {})
    }

    logger.info({ jobId, instanceId: request.id, serverId }, 'Provision job completed')
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    await db
      .update(provisionJobs)
      .set({ status: 'failed', errorMessage: msg, completedAt: new Date().toISOString() })
      .where(eq(provisionJobs.id, jobId))
    logger.error({ jobId, err: msg }, 'Provision job failed')
  }
}

async function selectServer(strategy: ServerSelectionStrategy): Promise<string> {
  const onlineServers = await db
    .select()
    .from(servers)
    .where(eq(servers.status, 'online'))

  if (onlineServers.length === 0) {
    const pending = await db.select().from(servers).where(eq(servers.status, 'pending'))
    const fallback = pending[0]
    if (!fallback) {
      throw new Error('No servers available for provisioning')
    }
    return fallback.id
  }

  switch (strategy) {
    case 'specific':
      throw new Error('specific strategy requires serverId')
    case 'most_memory': {
      const sorted = [...onlineServers].sort((a, b) => (b.totalMemory ?? 0) - (a.totalMemory ?? 0))
      const best = sorted[0]
      if (!best) throw new Error('No servers available for provisioning')
      return best.id
    }
    case 'round_robin': {
      const server = onlineServers[roundRobinIndex % onlineServers.length]
      roundRobinIndex++
      if (!server) throw new Error('No servers available for provisioning')
      return server.id
    }
    case 'least_instances':
    default: {
      const counts = await db
        .select({ serverId: instances.serverId, instanceCount: count() })
        .from(instances)
        .groupBy(instances.serverId)

      const countMap = new Map(counts.map((c) => [c.serverId, c.instanceCount]))
      const sorted = [...onlineServers].sort(
        (a, b) => (countMap.get(a.id) ?? 0) - (countMap.get(b.id) ?? 0),
      )
      const best = sorted[0]
      if (!best) throw new Error('No servers available for provisioning')
      return best.id
    }
  }
}

export async function getProvisionJob(jobId: string) {
  const [job] = await db.select().from(provisionJobs).where(eq(provisionJobs.id, jobId))
  return job ?? null
}
