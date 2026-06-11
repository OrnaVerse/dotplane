import type { Request, Response, NextFunction } from 'express'
import { requireEnv } from '../config.js'

export function urlKeyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const key = requireEnv('PLATFORM_URL_KEY')

  if (!req.path.startsWith(`/${key}`)) {
    res.status(404).send('Not Found')
    return
  }

  req.url = req.url.replace(`/${key}`, '') || '/'
  next()
}
