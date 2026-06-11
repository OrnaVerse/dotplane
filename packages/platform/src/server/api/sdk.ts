import { Router } from 'express'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { requireRole } from '../middleware/rbac.js'
import { AgentService } from '../services/agent.service.js'
import { db } from '../db/index.js'
import { serverRuntimes, servers } from '../db/schema.js'
import { emitSSE, setupSSE } from './helpers.js'

const router: Router = Router()

const InstallSchema = z.object({
  serverId: z.string().min(1),
  runtime: z.enum(['dotnet', 'node']).default('dotnet'),
  version: z.string().min(1),
})

router.get('/runtimes', async (_req, res) => {
  const allServers = db.select().from(servers).all()
  const matrix: Array<{
    serverId: string
    serverName: string
    status: string
    runtimes: Array<{ runtime: string; version: string; installedAt: string }>
    agentRuntimes: Awaited<ReturnType<AgentService['getRuntimes']>>
  }> = []

  for (const server of allServers) {
    const dbRuntimes = db.select().from(serverRuntimes).where(eq(serverRuntimes.serverId, server.id)).all()

    let agentRuntimes: Awaited<ReturnType<AgentService['getRuntimes']>> = []
    if (server.status === 'online') {
      try {
        const agent = new AgentService(server.id)
        agentRuntimes = await agent.getRuntimes()
      } catch {
        agentRuntimes = []
      }
    }

    matrix.push({
      serverId: server.id,
      serverName: server.displayName,
      status: server.status,
      runtimes: dbRuntimes,
      agentRuntimes,
    })
  }

  res.json(matrix)
})

router.post('/install', requireRole('superadmin'), async (req, res) => {
  const body = InstallSchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() })
    return
  }

  const server = db.select().from(servers).where(eq(servers.id, body.data.serverId)).get()
  if (!server) {
    res.status(404).json({ error: 'Server not found' })
    return
  }

  setupSSE(res)

  try {
    emitSSE(res, { type: 'step', step: 'connect', status: 'running' })
    const agent = new AgentService(body.data.serverId)
    emitSSE(res, { type: 'step', step: 'connect', status: 'done' })

    emitSSE(res, { type: 'step', step: 'install', status: 'running', runtime: body.data.runtime, version: body.data.version })
    await agent.installRuntime(body.data.runtime, body.data.version)
    emitSSE(res, { type: 'step', step: 'install', status: 'done' })

    const now = new Date().toISOString()
    db.insert(serverRuntimes)
      .values({
        serverId: body.data.serverId,
        runtime: body.data.runtime,
        version: body.data.version,
        installedAt: now,
      })
      .onConflictDoUpdate({
        target: [serverRuntimes.serverId, serverRuntimes.runtime, serverRuntimes.version],
        set: { installedAt: now },
      })
      .run()

    emitSSE(res, { type: 'done', success: true })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Install failed'
    emitSSE(res, { type: 'step', step: 'error', status: 'error', message: msg })
    emitSSE(res, { type: 'done', success: false })
  }

  res.end()
})

export default router
