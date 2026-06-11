import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import * as firewall from '../services/firewall.service.js'
import { requireParam } from '../utils/params.js'

const router: Router = Router()

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>

function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next)
  }
}

const AllowSchema = z.object({
  port: z.number().int().positive(),
  protocol: z.enum(['tcp', 'udp']).default('tcp'),
  from: z.string().optional(),
})

router.get('/status', asyncHandler(async (_req, res) => {
  const status = await firewall.getStatus()
  res.json(status)
}))

router.post('/allow', asyncHandler(async (req, res) => {
  const body = AllowSchema.parse(req.body)
  await firewall.allowRule(body)
  res.json({ ok: true })
}))

router.delete('/rules/:number', asyncHandler(async (req, res) => {
  const ruleNumber = parseInt(requireParam(req, 'number'), 10)
  if (Number.isNaN(ruleNumber) || ruleNumber < 1) {
    res.status(400).json({ error: 'Invalid rule number' })
    return
  }
  await firewall.deleteRule(ruleNumber)
  res.json({ ok: true })
}))

export default router
