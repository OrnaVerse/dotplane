import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import * as systemd from '../services/systemd.service.js'
import * as deploy from '../services/deploy.service.js'
import * as caddy from '../services/caddy.service.js'
import { MEMORY_TIERS } from '../config.js'
import type { MemoryTierName } from '../config.js'
import { requireParam } from '../utils/params.js'

const router: Router = Router()

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>

function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next)
  }
}

const CreateSchema = z.object({
  instanceId: z.string().min(1),
  appPath: z.string().min(1),
  uploadsPath: z.string().min(1),
  port: z.number().int().positive(),
  memoryTier: z.enum(Object.keys(MEMORY_TIERS) as [MemoryTierName, ...MemoryTierName[]]),
  envVars: z.record(z.string()).default({}),
  runtime: z.enum(['dotnet', 'node']).optional(),
})

const DeploySchema = z.object({
  instanceId: z.string().min(1),
  artifactUrl: z.string().url(),
  appPath: z.string().min(1),
  uploadsPath: z.string().min(1),
})

const CaddyRouteSchema = z.object({
  domain: z.string().min(1),
  port: z.number().int().positive(),
  instanceId: z.string().min(1),
})

const RemoveSchema = z.object({
  deleteData: z.boolean().default(false),
})

router.post('/create', asyncHandler(async (req, res) => {
  const body = CreateSchema.parse(req.body)
  await systemd.createInstance(body)
  res.json({ ok: true })
}))

router.post('/:id/start', asyncHandler(async (req, res) => {
  await systemd.startInstance(requireParam(req, 'id'))
  res.json({ ok: true })
}))

router.post('/:id/stop', asyncHandler(async (req, res) => {
  await systemd.stopInstance(requireParam(req, 'id'))
  res.json({ ok: true })
}))

router.post('/:id/reload', asyncHandler(async (req, res) => {
  await systemd.reloadInstance(requireParam(req, 'id'))
  res.json({ ok: true })
}))

router.post('/deploy', asyncHandler(async (req, res) => {
  const body = DeploySchema.parse(req.body)
  await deploy.deployArtifact(body)
  res.json({ ok: true })
}))

router.post('/:id/remove', asyncHandler(async (req, res) => {
  const { deleteData } = RemoveSchema.parse(req.body ?? {})
  await systemd.removeInstance(requireParam(req, 'id'), deleteData)
  res.json({ ok: true })
}))

router.get('/status', asyncHandler(async (req, res) => {
  const ids = typeof req.query.ids === 'string'
    ? req.query.ids.split(',').filter(Boolean)
    : undefined
  const status = await systemd.getStatus(ids)
  res.json(status)
}))

router.get('/:id/logs', asyncHandler(async (req, res) => {
  const lines = parseInt(typeof req.query.lines === 'string' ? req.query.lines : '100', 10)
  const logs = await systemd.getLogs(requireParam(req, 'id'), lines)

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  for (const line of logs.split('\n').filter(Boolean)) {
    res.write(`data: ${line}\n\n`)
  }
  res.end()
}))

router.post('/caddy/routes', asyncHandler(async (req, res) => {
  const { domain, port, instanceId } = CaddyRouteSchema.parse(req.body)
  await caddy.addRoute(domain, port, instanceId)
  res.json({ ok: true })
}))

router.delete('/caddy/routes/:instanceId', asyncHandler(async (req, res) => {
  await caddy.removeRoute(requireParam(req, 'instanceId'))
  res.json({ ok: true })
}))

router.get('/caddy/routes', asyncHandler(async (_req, res) => {
  const routes = await caddy.getRoutes()
  res.json(routes)
}))

export default router
