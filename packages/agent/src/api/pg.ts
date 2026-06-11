import { Router, type Request, type Response, type NextFunction } from 'express'
import * as pgService from '../services/pg.service.js'

const router = Router()

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>

function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next)
  }
}

router.get('/metrics', asyncHandler(async (req, res) => {
  const config = pgService.resolvePgConfig(req.query as Record<string, unknown>)

  if (!config.user) {
    res.status(400).json({ error: 'Missing PostgreSQL user (PG_USER or query.user)' })
    return
  }

  const metrics = await pgService.collectMetrics(config)
  res.json(metrics)
}))

export default router
