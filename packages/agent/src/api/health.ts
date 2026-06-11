import os from 'os'
import { Router, type Request, type Response, type NextFunction } from 'express'
import { platformAllowsPrivateFetch, safeFetch } from '@dotplane/shared'
import { agentConfig } from '../config.js'
import { logger } from '../logger.js'

const router: Router = Router()
const startedAt = Date.now()

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>

function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next)
  }
}

export async function reportOnline(): Promise<void> {
  const { platformUrl, serverId, agentCallbackToken } = agentConfig

  if (!platformUrl || !serverId || !agentCallbackToken) {
    logger.warn('Skipping reportOnline — missing PLATFORM_URL, SERVER_ID, or AGENT_CALLBACK_TOKEN')
    return
  }

  const base = platformUrl.replace(/\/$/, '')
  const url = `${base}/api/servers/internal/agent-online`
  const platformHost = new URL(base).hostname
  const allowPrivate = platformAllowsPrivateFetch(platformUrl)

  try {
    const res = await safeFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: agentCallbackToken,
        osInfo: {
          hostname: os.hostname(),
          uptimeSeconds: String(Math.floor(process.uptime())),
          reportedAt: new Date().toISOString(),
        },
      }),
    }, {
      allowedHostnames: [platformHost],
      allowHttp: base.startsWith('http://'),
      allowPrivateHosts: allowPrivate,
      requireAllowlist: true,
    })

    if (!res.ok) {
      const text = await res.text()
      logger.error({ status: res.status, body: text }, 'reportOnline failed')
      return
    }

    logger.info({ serverId }, 'Reported online to Platform')
  } catch (err) {
    logger.error({ err }, 'reportOnline request failed')
  }
}

router.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.floor(process.uptime()),
    startedAt: new Date(startedAt).toISOString(),
    hostname: os.hostname(),
    serverId: agentConfig.serverId ?? null,
    version: process.env.npm_package_version ?? '0.1.0',
  })
})

router.post('/report-online', asyncHandler(async (_req, res) => {
  await reportOnline()
  res.json({ ok: true })
}))

export default router
