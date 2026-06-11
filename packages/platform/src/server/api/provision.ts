import { Router } from 'express'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { deployTokenAuth } from '../auth/deploy-token.js'
import { createProvisionJob, getProvisionJob } from '../services/provision.service.js'
import { db } from '../db/index.js'
import { provisionJobs } from '../db/schema.js'

import { routeParam } from './helpers.js'

const router: Router = Router()
router.use(deployTokenAuth)

const CreateProvisionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/).max(50),
  displayName: z.string().min(1).max(100),
  appId: z.string().min(1),
  domain: z.string().min(1).max(253),
  memoryTier: z.enum(['minimal', 'standard', 'professional', 'enterprise']).default('standard'),
  envVars: z.record(z.string()).optional(),
  initialVersion: z.string().optional(),
  runtimeVersion: z.string().optional(),
  strategy: z.enum(['least_instances', 'most_memory', 'round_robin', 'specific']).default('least_instances'),
  serverId: z.string().optional(),
})

router.post('/', async (req, res) => {
  const body = CreateProvisionSchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() })
    return
  }

  if (body.data.strategy === 'specific' && !body.data.serverId) {
    res.status(400).json({ error: 'serverId required for specific strategy' })
    return
  }

  const jobId = await createProvisionJob(
    {
      id: body.data.id,
      displayName: body.data.displayName,
      appId: body.data.appId,
      domain: body.data.domain,
      memoryTier: body.data.memoryTier,
      envVars: body.data.envVars,
      initialVersion: body.data.initialVersion,
      runtimeVersion: body.data.runtimeVersion,
    },
    body.data.strategy,
    0,
    body.data.serverId,
  )

  res.status(202).json({ jobId })
})

router.get('/:id', async (req, res) => {
  const job = await getProvisionJob(routeParam(req, 'id'))
  if (!job) {
    res.status(404).json({ error: 'Job not found' })
    return
  }

  res.json(job)
})

router.delete('/:id', async (req, res) => {
  const job = await getProvisionJob(routeParam(req, 'id'))
  if (!job) {
    res.status(404).json({ error: 'Job not found' })
    return
  }

  if (job.status === 'running') {
    res.status(409).json({ error: 'Cannot delete a running job' })
    return
  }

  db.delete(provisionJobs).where(eq(provisionJobs.id, routeParam(req, 'id'))).run()
  res.json({ ok: true })
})

export default router
