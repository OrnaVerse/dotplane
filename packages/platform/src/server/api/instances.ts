import { Router } from 'express'
import { z } from 'zod'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { requireRole, requireInstanceAccess } from '../middleware/rbac.js'
import { deployRateLimiter } from '../middleware/rateLimit.js'
import { DeployService } from '../services/deploy.service.js'
import { AgentService, getAgentForInstance } from '../services/agent.service.js'
import { getNextAvailablePort } from '../services/utils/port.js'
import { db } from '../db/index.js'
import {
  apps,
  deployments,
  instanceMetricsHistory,
  instances,
  servers,
} from '../db/schema.js'
import { emitSSE, parseIntQuery, routeParam, setupSSE } from './helpers.js'

const router: Router = Router()
const deployService = new DeployService()

const CreateInstanceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/).max(50),
  displayName: z.string().min(1).max(100),
  appId: z.string().min(1),
  serverId: z.string().min(1),
  domain: z.string().min(1).max(253),
  memoryTier: z.enum(['minimal', 'standard', 'professional', 'enterprise']).default('standard'),
  envVars: z.record(z.string()).default({}),
  initialVersion: z.string().optional(),
  runtimeVersion: z.string().default('8.0'),
  healthCheckPath: z.string().default('/health'),
  healthCheckGraceSeconds: z.number().int().min(0).max(300).default(10),
})

const DeploySchema = z.object({
  version: z.string().min(1),
})

const DeployAllSchema = z.object({
  appId: z.string().min(1),
  version: z.string().min(1),
  batchSize: z.number().int().min(1).max(10).default(3),
  delaySeconds: z.number().int().min(0).max(300).default(30),
  instanceIds: z.array(z.string()).optional(),
})

const EnvUpdateSchema = z.object({
  envVars: z.record(z.string()),
})

const DeleteInstanceSchema = z.object({
  deleteData: z.boolean().default(false),
})

const RollbackSchema = z.object({
  deploymentId: z.number().int().optional(),
})

function scopedInstanceIds(user: Express.Request['user']): string[] | null {
  if (!user) return []
  if (user.role === 'superadmin' || user.instanceScope === 'all') return null
  return user.instanceScope
}

router.get('/', async (req, res) => {
  const scope = scopedInstanceIds(req.user)

  const rows =
    scope === null
      ? db
          .select({
            instance: instances,
            serverName: servers.displayName,
            appName: apps.displayName,
          })
          .from(instances)
          .innerJoin(servers, eq(servers.id, instances.serverId))
          .innerJoin(apps, eq(apps.id, instances.appId))
          .all()
      : db
          .select({
            instance: instances,
            serverName: servers.displayName,
            appName: apps.displayName,
          })
          .from(instances)
          .innerJoin(servers, eq(servers.id, instances.serverId))
          .innerJoin(apps, eq(apps.id, instances.appId))
          .where(inArray(instances.id, scope))
          .all()

  const byServer = new Map<string, string[]>()
  for (const row of rows) {
    const list = byServer.get(row.instance.serverId) ?? []
    list.push(row.instance.id)
    byServer.set(row.instance.serverId, list)
  }

  const liveStatus = new Map<string, { memoryBytes?: number; cpuPercent?: number; restartCount?: number }>()

  await Promise.all(
    [...byServer.entries()].map(async ([serverId, ids]) => {
      try {
        const agent = new AgentService(serverId)
        const statuses = await agent.getStatus(ids)
        for (const entry of statuses) {
          liveStatus.set(entry.instanceId, {
            memoryBytes: entry.memoryBytes,
            cpuPercent: entry.cpuPercent,
            restartCount: entry.restartCount,
          })
        }
      } catch {
        // agent offline — keep DB status
      }
    }),
  )

  res.json(
    rows.map((row) => ({
      ...row.instance,
      serverName: row.serverName,
      appName: row.appName,
      live: liveStatus.get(row.instance.id) ?? null,
    })),
  )
})

router.get('/:id', requireInstanceAccess((req) => routeParam(req, 'id')), async (req, res) => {
  const id = routeParam(req, 'id')
  const row = db
    .select({
      instance: instances,
      serverName: servers.displayName,
      appName: apps.displayName,
    })
    .from(instances)
    .innerJoin(servers, eq(servers.id, instances.serverId))
    .innerJoin(apps, eq(apps.id, instances.appId))
    .where(eq(instances.id, id))
    .get()

  if (!row) {
    res.status(404).json({ error: 'Instance not found' })
    return
  }

  res.json({ ...row.instance, serverName: row.serverName, appName: row.appName })
})

router.post('/', requireRole('superadmin'), async (req, res) => {
  const body = CreateInstanceSchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() })
    return
  }

  const data = body.data
  const existing = db.select().from(instances).where(eq(instances.id, data.id)).get()
  if (existing) {
    res.status(409).json({ error: 'Instance already exists' })
    return
  }

  const appPath = `/var/dotplane/instances/${data.id}/app`
  const uploadsPath = `/var/dotplane/instances/${data.id}/uploads`
  const port = await getNextAvailablePort(data.serverId)

  const agent = new AgentService(data.serverId)
  await agent.createInstance({
    instanceId: data.id,
    appPath,
    uploadsPath,
    port,
    memoryTier: data.memoryTier,
    envVars: data.envVars,
    runtimeVersion: data.runtimeVersion,
  })

  await agent.addCaddyRoute(data.domain, port, data.id)

  db.insert(instances)
    .values({
      id: data.id,
      displayName: data.displayName,
      appId: data.appId,
      serverId: data.serverId,
      domain: data.domain,
      port,
      memoryTier: data.memoryTier,
      envVars: data.envVars,
      appPath,
      uploadsPath,
      runtimeVersion: data.runtimeVersion,
      healthCheckPath: data.healthCheckPath,
      healthCheckGraceSeconds: data.healthCheckGraceSeconds,
    })
    .run()

  if (data.initialVersion) {
    await deployService.deployInstanceSSE(data.id, data.initialVersion, req.user!.userId, () => {})
  }

  res.status(201).json({ id: data.id, port, domain: data.domain })
})

router.post(
  '/:id/deploy',
  requireRole('superadmin', 'manager'),
  requireInstanceAccess((req) => routeParam(req, 'id')),
  deployRateLimiter,
  async (req, res) => {
    const body = DeploySchema.safeParse(req.body)
    if (!body.success) {
      res.status(400).json({ error: body.error.flatten() })
      return
    }

    setupSSE(res)

    try {
      await deployService.deployInstanceSSE(routeParam(req, 'id'), body.data.version, req.user!.userId, (event) => {
        emitSSE(res, event)
      })
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Deploy failed'
      emitSSE(res, { type: 'step', step: 'error', status: 'error', message: msg })
      emitSSE(res, { type: 'done', success: false, deploymentId: 0 })
    }

    res.end()
  },
)

router.post('/deploy-all', requireRole('superadmin', 'manager'), deployRateLimiter, async (req, res) => {
  const body = DeployAllSchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() })
    return
  }

  setupSSE(res)

  await deployService.deployAllSSE(body.data, req.user!.userId, (event) => {
    emitSSE(res, event)
  })

  res.end()
})

router.post(
  '/:id/rollback',
  requireRole('superadmin', 'manager'),
  requireInstanceAccess((req) => routeParam(req, 'id')),
  deployRateLimiter,
  async (req, res) => {
    const body = RollbackSchema.safeParse(req.body ?? {})
    if (!body.success) {
      res.status(400).json({ error: body.error.flatten() })
      return
    }

    let targetVersion: string | null = null

    if (body.data.deploymentId) {
      const deployment = db
        .select()
        .from(deployments)
        .where(and(eq(deployments.id, body.data.deploymentId), eq(deployments.instanceId, routeParam(req, 'id'))))
        .get()
      targetVersion = deployment?.version ?? null
    } else {
      const previous = db
        .select()
        .from(deployments)
        .where(and(eq(deployments.instanceId, routeParam(req, 'id')), eq(deployments.status, 'success')))
        .orderBy(desc(deployments.startedAt))
        .all()

      const current = db.select().from(instances).where(eq(instances.id, routeParam(req, 'id'))).get()
      targetVersion = previous.find((d) => d.version !== current?.currentVersion)?.version ?? null
    }

    if (!targetVersion) {
      res.status(400).json({ error: 'No rollback target found' })
      return
    }

    setupSSE(res)

    await deployService.deployInstanceSSE(routeParam(req, 'id'), targetVersion, req.user!.userId, (event) => {
      emitSSE(res, event)
    })

    res.end()
  },
)

router.patch(
  '/:id/env',
  requireRole('superadmin', 'manager'),
  requireInstanceAccess((req) => routeParam(req, 'id')),
  async (req, res) => {
    const body = EnvUpdateSchema.safeParse(req.body)
    if (!body.success) {
      res.status(400).json({ error: body.error.flatten() })
      return
    }

    const instance = db.select().from(instances).where(eq(instances.id, routeParam(req, 'id'))).get()
    if (!instance) {
      res.status(404).json({ error: 'Instance not found' })
      return
    }

    setupSSE(res)

    try {
      emitSSE(res, { type: 'step', step: 'update', status: 'running' })
      db.update(instances).set({ envVars: body.data.envVars }).where(eq(instances.id, instance.id)).run()
      emitSSE(res, { type: 'step', step: 'update', status: 'done' })

      const agent = new AgentService(instance.serverId)

      emitSSE(res, { type: 'step', step: 'stop', status: 'running' })
      await agent.stopInstance(instance.id)
      emitSSE(res, { type: 'step', step: 'stop', status: 'done' })

      emitSSE(res, { type: 'step', step: 'recreate', status: 'running' })
      await agent.createInstance({
        instanceId: instance.id,
        appPath: instance.appPath,
        uploadsPath: instance.uploadsPath,
        port: instance.port,
        memoryTier: instance.memoryTier,
        envVars: body.data.envVars,
        runtimeVersion: instance.runtimeVersion,
      })
      emitSSE(res, { type: 'step', step: 'recreate', status: 'done' })

      emitSSE(res, { type: 'step', step: 'start', status: 'running' })
      await agent.startInstance(instance.id)
      emitSSE(res, { type: 'step', step: 'start', status: 'done' })

      emitSSE(res, { type: 'done', success: true })
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Env update failed'
      emitSSE(res, { type: 'step', step: 'error', status: 'error', message: msg })
      emitSSE(res, { type: 'done', success: false })
    }

    res.end()
  },
)

router.get('/:id/logs', requireInstanceAccess((req) => routeParam(req, 'id')), async (req, res) => {
  const lines = parseIntQuery(req.query.lines, 100)

  setupSSE(res)

  try {
    const agent = await getAgentForInstance(routeParam(req, 'id'))
    await agent.streamLogs(routeParam(req, 'id'), lines, (line) => {
      emitSSE(res, { line })
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Log stream failed'
    emitSSE(res, { error: msg })
  }

  res.end()
})

router.get('/:id/metrics', requireInstanceAccess((req) => routeParam(req, 'id')), (req, res) => {
  const limit = parseIntQuery(req.query.limit, 100)

  const rows = db
    .select()
    .from(instanceMetricsHistory)
    .where(eq(instanceMetricsHistory.instanceId, routeParam(req, 'id')))
    .orderBy(desc(instanceMetricsHistory.collectedAt))
    .limit(limit)
    .all()

  res.json(rows)
})

router.get('/:id/deployments', requireInstanceAccess((req) => routeParam(req, 'id')), (req, res) => {
  const limit = parseIntQuery(req.query.limit, 50)

  const rows = db
    .select()
    .from(deployments)
    .where(eq(deployments.instanceId, routeParam(req, 'id')))
    .orderBy(desc(deployments.startedAt))
    .limit(limit)
    .all()

  res.json(rows)
})

router.delete('/:id', requireRole('superadmin'), async (req, res) => {
  const body = DeleteInstanceSchema.safeParse(req.body ?? {})
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() })
    return
  }

  const instance = db.select().from(instances).where(eq(instances.id, routeParam(req, 'id'))).get()
  if (!instance) {
    res.status(404).json({ error: 'Instance not found' })
    return
  }

  const agent = new AgentService(instance.serverId)
  await agent.removeInstance(routeParam(req, 'id'), body.data.deleteData)
  await agent.removeCaddyRoute(routeParam(req, 'id'))

  db.delete(instances).where(eq(instances.id, routeParam(req, 'id'))).run()
  res.json({ ok: true })
})

export default router
