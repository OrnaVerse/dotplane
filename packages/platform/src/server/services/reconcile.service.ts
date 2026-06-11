import { AgentService } from './agent.service.js'
import { db } from '../db/index.js'
import { instances } from '../db/schema.js'
import { logger } from '../logger.js'

export async function reconcileCaddyRoutes(): Promise<{ synced: number; errors: string[] }> {
  const allInstances = await db.select().from(instances)
  const errors: string[] = []
  let synced = 0

  for (const instance of allInstances) {
    try {
      const agent = new AgentService(instance.serverId)
      await agent.addCaddyRoute(instance.domain, instance.port, instance.id)
      synced++
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      errors.push(`${instance.id}: ${msg}`)
      logger.warn({ instanceId: instance.id, err: msg }, 'Failed to reconcile Caddy route')
    }
  }

  logger.info({ synced, errorCount: errors.length }, 'Caddy route reconciliation complete')
  return { synced, errors }
}
