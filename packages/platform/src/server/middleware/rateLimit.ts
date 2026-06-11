import rateLimit from 'express-rate-limit'
import type { Request } from 'express'
import { SqliteRateLimitStore } from '../utils/rate-limit-store.js'

function clientKey(req: Request): string {
  return req.user?.userId?.toString() ?? req.ip ?? 'unknown'
}

export const loginRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: new SqliteRateLimitStore('login:'),
  message: { error: 'Too many login attempts, try again in 1 minute' },
})

export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  store: new SqliteRateLimitStore('api:'),
  keyGenerator: clientKey,
})

export const deployRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: new SqliteRateLimitStore('deploy:'),
  keyGenerator: clientKey,
  message: { error: 'Too many deploy requests' },
})
