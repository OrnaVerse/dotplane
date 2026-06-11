import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import forge from 'node-forge'
import { z } from 'zod'
import { eq, sql } from 'drizzle-orm'
import { requireRole } from '../middleware/rbac.js'
import { agentCallbackRateLimiter } from '../middleware/rateLimit.js'
import {
  generateAgentServerCert,
  generateCaCert,
  generatePlatformClientCert,
  type CaMaterial,
} from '../services/cert.service.js'
import { db } from '../db/index.js'
import { instances, serverRuntimes, serverSdks, servers, settings } from '../db/schema.js'
import { requireEnv } from '../config.js'
import { hashSha256 } from '../utils/crypto.js'
import { routeParam } from './helpers.js'

const router: Router = Router()

const AGENT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

const CreateServerSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/).max(50),
  displayName: z.string().min(1).max(100),
  hostname: z.string().min(1).max(253),
  agentPort: z.number().int().min(1).max(65535).default(7823),
})

const UpdateServerSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  hostname: z.string().min(1).max(253).optional(),
  agentPort: z.number().int().min(1).max(65535).optional(),
})

const AgentOnlineSchema = z.object({
  token: z.string().min(1),
  totalMemory: z.number().int().optional(),
  totalCpu: z.number().int().optional(),
  diskTotal: z.number().int().optional(),
  diskUsed: z.number().int().optional(),
  osInfo: z.record(z.string()).optional(),
})

function agentTokenSettingKey(token: string): string {
  return `agent_install:${hashSha256(token)}`
}

function createInstallToken(serverId: string): string {
  const token = `tok_${crypto.randomBytes(16).toString('hex')}`
  const expiresAt = new Date(Date.now() + AGENT_TOKEN_TTL_MS).toISOString()

  db.insert(settings)
    .values({
      key: agentTokenSettingKey(token),
      value: JSON.stringify({ serverId, expiresAt }),
      isSensitive: true,
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: JSON.stringify({ serverId, expiresAt }), updatedAt: new Date().toISOString() },
    })
    .run()

  return token
}

function agentInstallTokenAuth(req: Request, res: Response, next: NextFunction): void {
  const body = AgentOnlineSchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: 'Invalid input' })
    return
  }

  const serverId = resolveServerFromToken(body.data.token)
  if (!serverId) {
    res.status(401).json({ error: 'Invalid or expired token' })
    return
  }

  req.agentInstall = { serverId, token: body.data.token, payload: body.data }
  next()
}

function resolveServerFromToken(token: string): string | null {
  const record = db
    .select()
    .from(settings)
    .where(eq(settings.key, agentTokenSettingKey(token)))
    .get()

  if (!record) return null

  const parsed = JSON.parse(record.value) as { serverId: string; expiresAt: string }
  if (new Date(parsed.expiresAt) <= new Date()) return null
  return parsed.serverId
}

async function loadCaMaterial(): Promise<CaMaterial> {
  const caCertPath = requireEnv('MTLS_CA_CERT_PATH')
  const caKeyPath = caCertPath.replace(/\.crt$/, '.key')

  try {
    const [certPem, keyPem] = await Promise.all([
      fs.readFile(caCertPath, 'utf8'),
      fs.readFile(caKeyPath, 'utf8'),
    ])
    return {
      certPem,
      keyPem,
      cert: forge.pki.certificateFromPem(certPem),
      privateKey: forge.pki.privateKeyFromPem(keyPem),
    }
  } catch {
    return generateCaCert()
  }
}

router.get('/agent-bootstrap/:token', (req, res) => {
  const serverId = resolveServerFromToken(routeParam(req, 'token'))
  if (!serverId) {
    res.status(404).send('Not Found')
    return
  }

  const urlKey = requireEnv('PLATFORM_URL_KEY')
  const platformUrl = process.env.PLATFORM_URL ?? `https://localhost/${urlKey}`

  res.type('text/plain').send(`#!/bin/bash
set -euo pipefail
curl -fsSL "${platformUrl}/api/servers/agent-install/${routeParam(req, 'token')}" | sudo bash
`)
})

router.get('/agent-install/:token', async (req, res) => {
  const serverId = resolveServerFromToken(routeParam(req, 'token'))
  if (!serverId) {
    res.status(404).send('Not Found')
    return
  }

  const server = db.select().from(servers).where(eq(servers.id, serverId)).get()
  if (!server) {
    res.status(404).send('Not Found')
    return
  }

  const urlKey = requireEnv('PLATFORM_URL_KEY')
  const platformUrl = process.env.PLATFORM_URL ?? `https://localhost/${urlKey}`

  res.type('text/plain').send(`#!/bin/bash
set -euo pipefail
export SERVER_ID="${serverId}"
export PLATFORM_URL="${platformUrl}"
export AGENT_CALLBACK_TOKEN="${routeParam(req, 'token')}"
curl -fsSL "${platformUrl}/api/agent-bootstrap/${routeParam(req, 'token')}" >/dev/null 2>&1 || true
echo "Install Dotplane agent for ${server.displayName} (${serverId})"
echo "Run install-agent.sh with SERVER_ID=${serverId}"
`)
})

router.post(
  '/internal/agent-online',
  agentCallbackRateLimiter,
  agentInstallTokenAuth,
  async (req, res) => {
    const { serverId, token, payload } = req.agentInstall!
    const now = new Date().toISOString()

    db.update(servers)
      .set({
        status: 'online',
        lastSeen: now,
        totalMemory: payload.totalMemory ?? null,
        totalCpu: payload.totalCpu ?? null,
        diskTotal: payload.diskTotal ?? null,
        diskUsed: payload.diskUsed ?? null,
        osInfo: payload.osInfo ?? null,
      })
      .where(eq(servers.id, serverId))
      .run()

    db.delete(settings).where(eq(settings.key, agentTokenSettingKey(token))).run()

    res.json({ ok: true, serverId })
  },
)

router.get('/health', async (_req, res) => {
  const allServers = db.select().from(servers).all()
  const enriched = await Promise.all(
    allServers.map(async (server) => {
      const instanceCount = db
        .select({ count: sql<number>`count(*)` })
        .from(instances)
        .where(eq(instances.serverId, server.id))
        .get()?.count ?? 0

      return { ...server, instanceCount }
    }),
  )

  const healthy = enriched.filter((s) => s.status === 'online').length
  const warning = enriched.filter((s) => s.status === 'degraded' || s.status === 'pending').length
  const down = enriched.filter((s) => s.status === 'offline').length

  res.json({ servers: enriched, summary: { healthy, warning, down } })
})

router.get('/', async (_req, res) => {
  const rows = db.select().from(servers).all()
  res.json(rows)
})

router.get('/:id', async (req, res) => {
  const server = db.select().from(servers).where(eq(servers.id, routeParam(req, 'id'))).get()
  if (!server) {
    res.status(404).json({ error: 'Server not found' })
    return
  }

  const serverInstances = db.select().from(instances).where(eq(instances.serverId, server.id)).all()
  const sdks = db.select().from(serverSdks).where(eq(serverSdks.serverId, server.id)).all()
  const runtimes = db.select().from(serverRuntimes).where(eq(serverRuntimes.serverId, server.id)).all()

  res.json({ ...server, instances: serverInstances, sdks, runtimes })
})

router.post('/', requireRole('superadmin'), async (req, res) => {
  const body = CreateServerSchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() })
    return
  }

  const existing = db.select().from(servers).where(eq(servers.id, body.data.id)).get()
  if (existing) {
    res.status(409).json({ error: 'Server already exists' })
    return
  }

  const ca = await loadCaMaterial()
  const agentCert = generateAgentServerCert(body.data.id, body.data.hostname, ca)

  db.insert(servers)
    .values({
      id: body.data.id,
      displayName: body.data.displayName,
      hostname: body.data.hostname,
      agentPort: body.data.agentPort,
      agentCertPem: agentCert.certPem,
      status: 'pending',
    })
    .run()

  const installToken = createInstallToken(body.data.id)
  const urlKey = requireEnv('PLATFORM_URL_KEY')
  const platformUrl = process.env.PLATFORM_URL ?? `https://localhost/${urlKey}`

  res.status(201).json({
    id: body.data.id,
    installToken,
    installUrl: `${platformUrl}/api/servers/agent-install/${installToken}`,
    agentCertPem: agentCert.certPem,
  })
})

router.patch('/:id', requireRole('superadmin'), async (req, res) => {
  const body = UpdateServerSchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() })
    return
  }

  const server = db.select().from(servers).where(eq(servers.id, routeParam(req, 'id'))).get()
  if (!server) {
    res.status(404).json({ error: 'Server not found' })
    return
  }

  db.update(servers)
    .set({
      ...(body.data.displayName !== undefined ? { displayName: body.data.displayName } : {}),
      ...(body.data.hostname !== undefined ? { hostname: body.data.hostname } : {}),
      ...(body.data.agentPort !== undefined ? { agentPort: body.data.agentPort } : {}),
    })
    .where(eq(servers.id, routeParam(req, 'id')))
    .run()

  res.json({ ok: true })
})

router.delete('/:id', requireRole('superadmin'), async (req, res) => {
  const server = db.select().from(servers).where(eq(servers.id, routeParam(req, 'id'))).get()
  if (!server) {
    res.status(404).json({ error: 'Server not found' })
    return
  }

  const boundInstances = db
    .select({ id: instances.id })
    .from(instances)
    .where(eq(instances.serverId, routeParam(req, 'id')))
    .all()

  if (boundInstances.length > 0) {
    res.status(409).json({ error: 'Remove instances before deleting server' })
    return
  }

  db.delete(servers).where(eq(servers.id, routeParam(req, 'id'))).run()
  res.json({ ok: true })
})

router.post('/:id/agent-install-token', requireRole('superadmin'), (req, res) => {
  const server = db.select().from(servers).where(eq(servers.id, routeParam(req, 'id'))).get()
  if (!server) {
    res.status(404).json({ error: 'Server not found' })
    return
  }

  const installToken = createInstallToken(server.id)
  const urlKey = requireEnv('PLATFORM_URL_KEY')
  const platformUrl = process.env.PLATFORM_URL ?? `https://localhost/${urlKey}`

  res.json({
    installToken,
    installUrl: `${platformUrl}/api/servers/agent-install/${installToken}`,
    expiresInHours: 24,
  })
})

router.post('/:id/rotate-cert', requireRole('superadmin'), async (req, res) => {
  const server = db.select().from(servers).where(eq(servers.id, routeParam(req, 'id'))).get()
  if (!server) {
    res.status(404).json({ error: 'Server not found' })
    return
  }

  const ca = await loadCaMaterial()
  const agentCert = generateAgentServerCert(server.id, server.hostname, ca)
  const platformCert = generatePlatformClientCert(ca)

  db.update(servers)
    .set({ agentCertPem: agentCert.certPem })
    .where(eq(servers.id, server.id))
    .run()

  const certDir = path.dirname(requireEnv('MTLS_CLIENT_CERT_PATH'))
  await fs.writeFile(path.join(certDir, 'platform.crt'), platformCert.certPem)
  await fs.writeFile(path.join(certDir, 'platform.key'), platformCert.keyPem)

  res.json({
    ok: true,
    agentCertPem: agentCert.certPem,
    platformCertPem: platformCert.certPem,
  })
})

export function isPublicServerRoute(req: Request): boolean {
  const publicPaths = ['/agent-bootstrap/', '/agent-install/', '/internal/agent-online']
  return publicPaths.some((segment) => req.path.includes(segment))
}

export default router
