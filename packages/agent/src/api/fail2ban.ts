import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import * as fail2ban from '../services/fail2ban.service.js'

const router = Router()

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>

function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next)
  }
}

const UnbanSchema = z.object({
  jail: z.string().min(1),
  ip: z.string().min(1),
})

router.get('/status', asyncHandler(async (_req, res) => {
  const status = await fail2ban.getStatus()
  res.json(status)
}))

router.post('/unban', asyncHandler(async (req, res) => {
  const { jail, ip } = UnbanSchema.parse(req.body)
  await fail2ban.unbanIp(jail, ip)
  res.json({ ok: true })
}))

export default router
