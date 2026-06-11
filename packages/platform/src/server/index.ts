import express, { type NextFunction, type Request, type Response, type Router } from 'express'
import path from 'path'
import { fileURLToPath } from 'url'

function isDirectExecution(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  return path.resolve(entry) === fileURLToPath(import.meta.url)
}
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import { pinoHttp } from 'pino-http'
import { urlKeyMiddleware } from './middleware/urlKey.js'
import { authMiddleware } from './auth/middleware.js'
import { deployTokenAuth } from './auth/deploy-token.js'
import { apiRateLimiter } from './middleware/rateLimit.js'
import { auditMiddleware } from './middleware/audit.js'
import authRoutes from './auth/routes.js'
import serversRouter, { isPublicServerRoute } from './api/servers.js'
import appsRouter from './api/apps.js'
import releasesRouter, { serveArtifact } from './api/releases.js'
import instancesRouter from './api/instances.js'
import sdkRouter from './api/sdk.js'
import usersRouter from './api/users.js'
import auditRouter from './api/audit.js'
import settingsRouter from './api/settings.js'
import provisionRouter from './api/provision.js'
import webhooksRouter from './api/webhooks.js'
import pgRouter from './api/pg.js'
import openapiRouter from './api/openapi.js'
import { runMigrations } from './db/migrate.js'
import { startHealthPoller } from './services/health.service.js'
import { startPgHealthPoller } from './services/pg-health.service.js'
import { reconcileCaddyRoutes } from './services/reconcile.service.js'
import { logger } from './logger.js'
import { requireEnv } from './config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function isPublicUsersRoute(req: Request): boolean {
  return req.method === 'POST' && req.path === '/invites/accept'
}

function withProtectedStack(router: Router) {
  return (req: Request, res: Response, next: NextFunction) => {
    authMiddleware(req, res, () => {
      apiRateLimiter(req, res, () => {
        auditMiddleware(req, res, () => router(req, res, next))
      })
    })
  }
}

function withConditionalAuth(router: Router, isPublic: (req: Request) => boolean) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isPublic(req)) {
      router(req, res, next)
      return
    }
    withProtectedStack(router)(req, res, next)
  }
}

export function createApp(): express.Application {
  const app = express()

  app.set('trust proxy', 1)
  app.use(urlKeyMiddleware)
  app.use(helmet({ contentSecurityPolicy: process.env.NODE_ENV === 'production' }))
  app.use(express.json({ limit: '10mb' }))
  app.use(express.urlencoded({ extended: true }))
  app.use(cookieParser())
  app.use(pinoHttp({ logger }))

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'dotplane-platform' })
  })

  app.use('/api/auth', authRoutes)

  app.get('/api/artifacts/:appId/:version', (req, res, next) => {
    void serveArtifact(req, res).catch(next)
  })

  app.use('/api/provision', deployTokenAuth, apiRateLimiter, auditMiddleware, provisionRouter)

  app.use('/api/servers', withConditionalAuth(serversRouter, isPublicServerRoute))
  app.use('/api/users', withConditionalAuth(usersRouter, isPublicUsersRoute))

  const protectedApi = express.Router()
  protectedApi.use('/apps', appsRouter)
  protectedApi.use('/releases', releasesRouter)
  protectedApi.use('/instances', instancesRouter)
  protectedApi.use('/sdk', sdkRouter)
  protectedApi.use('/audit', auditRouter)
  protectedApi.use('/settings', settingsRouter)
  protectedApi.use('/webhooks', webhooksRouter)
  protectedApi.use('/pg', pgRouter)
  protectedApi.use('/openapi', openapiRouter)

  app.use('/api', withProtectedStack(protectedApi))

  if (process.env.NODE_ENV === 'production') {
    const clientDist = path.join(__dirname, '../client')
    app.use(express.static(clientDist))
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) {
        next()
        return
      }
      res.sendFile(path.join(clientDist, 'index.html'), (err) => {
        if (err) next()
      })
    })
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const msg = err instanceof Error ? err.message : 'Internal server error'
    logger.error({ err: msg }, 'Unhandled error')
    res.status(500).json({ error: msg })
  })

  return app
}

async function boot(): Promise<void> {
  runMigrations()
  startHealthPoller()
  startPgHealthPoller()

  const host = process.env.PLATFORM_HOST ?? '127.0.0.1'
  const port = Number.parseInt(process.env.PLATFORM_PORT ?? '58291', 10)
  const app = createApp()

  await new Promise<void>((resolve) => {
    app.listen(port, host, () => {
      logger.info({ host, port, urlKey: requireEnv('PLATFORM_URL_KEY') }, 'Dotplane platform listening')
      resolve()
    })
  })

  void reconcileCaddyRoutes()
    .then((reconcile) => logger.info(reconcile, 'Startup reconciliation complete'))
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn({ err: msg }, 'Startup Caddy reconciliation failed')
    })
}

if (isDirectExecution()) {
  void boot()
}
