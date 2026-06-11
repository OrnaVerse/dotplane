import { eq } from 'drizzle-orm'
import { AgentService } from './agent.service.js'
import { db } from '../db/index.js'
import { instances, servers } from '../db/schema.js'
import { logger } from '../logger.js'

const POLL_INTERVAL_MS = 30_000

let pollerTimer: ReturnType<typeof setInterval> | null = null

export function startHealthPoller(): void {
  if (pollerTimer) return

  void pollAllServers()
  pollerTimer = setInterval(() => {
    void pollAllServers()
  }, POLL_INTERVAL_MS)

  logger.info('Health poller started (30s interval)')
}

export function stopHealthPoller(): void {
  if (pollerTimer) {
    clearInterval(pollerTimer)
    pollerTimer = null
  }
}

async function pollAllServers(): Promise<void> {
  const allServers = await db.select().from(servers)

  await Promise.all(
    allServers.map(async (server) => {
      try {
        const agent = new AgentService(server.id)
        await agent.getStatus()
        const now = new Date().toISOString()
        await db
          .update(servers)
          .set({ status: 'online', lastSeen: now })
          .where(eq(servers.id, server.id))
      } catch {
        await db
          .update(servers)
          .set({ status: 'offline', lastSeen: new Date().toISOString() })
          .where(eq(servers.id, server.id))
      }
    }),
  )

  const allInstances = await db.select().from(instances)
  const byServer = new Map<string, string[]>()

  for (const instance of allInstances) {
    const list = byServer.get(instance.serverId) ?? []
    list.push(instance.id)
    byServer.set(instance.serverId, list)
  }

  for (const [serverId, instanceIds] of byServer) {
    const [server] = await db.select().from(servers).where(eq(servers.id, serverId))
    if (!server || server.status === 'offline') continue

    try {
      const agent = new AgentService(serverId)
      const statuses = await agent.getStatus(instanceIds)
      const statusMap = new Map(statuses.map((s) => [s.instanceId, s]))

      for (const instanceId of instanceIds) {
        const entry = statusMap.get(instanceId)
        const instance = allInstances.find((i) => i.id === instanceId)
        if (!instance || !entry) continue

        let healthStatus: 'healthy' | 'degraded' | 'down' | 'unknown' = 'unknown'
        if (entry.activeState === 'active' && entry.subState === 'running') {
          healthStatus = await agent.healthCheck(instanceId, instance.port)
        } else if (entry.activeState === 'failed') {
          healthStatus = 'down'
        } else {
          healthStatus = 'degraded'
        }

        await db
          .update(instances)
          .set({ healthStatus })
          .where(eq(instances.id, instanceId))
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      logger.warn({ serverId, err: msg }, 'Failed to poll instance health')
    }
  }
}
