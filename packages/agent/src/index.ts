import https from 'https'
import fs from 'fs'
import express, { type Request, type Response, type NextFunction } from 'express'
import instanceRoutes from './api/instances.js'
import sdkRoutes from './api/sdk.js'
import runtimeRoutes from './api/runtime.js'
import healthRoutes, { reportOnline } from './api/health.js'
import pgRoutes from './api/pg.js'
import firewallRoutes from './api/firewall.js'
import fail2banRoutes from './api/fail2ban.js'
import certStatusRoutes from './api/cert-status.js'
import { agentConfig } from './config.js'
import { logger } from './logger.js'
import { ZodError } from 'zod'

const app = express()
app.use(express.json())

app.use('/instances', instanceRoutes)
app.use('/sdk', sdkRoutes)
app.use('/runtime', runtimeRoutes)
app.use('/health', healthRoutes)
app.use('/pg', pgRoutes)
app.use('/firewall', firewallRoutes)
app.use('/fail2ban', fail2banRoutes)
app.use('/cert-status', certStatusRoutes)

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Invalid request', details: err.flatten() })
    return
  }

  const message = err instanceof Error ? err.message : 'Internal server error'
  logger.error({ err }, 'Unhandled agent error')
  res.status(500).json({ error: message })
})

const server = https.createServer({
  cert: fs.readFileSync(agentConfig.certPath),
  key: fs.readFileSync(agentConfig.keyPath),
  ca: fs.readFileSync(agentConfig.caCertPath),
  requestCert: true,
  rejectUnauthorized: true,
}, app)

server.listen(agentConfig.port, agentConfig.host, () => {
  logger.info(`Dotplane Agent running on ${agentConfig.host}:${agentConfig.port}`)
  void reportOnline()
})

export default app
