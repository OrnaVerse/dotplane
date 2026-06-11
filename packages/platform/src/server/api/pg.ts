import { Router } from 'express'
import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { requireRole } from '../middleware/rbac.js'
import { db } from '../db/index.js'
import {
  pgAlertRules,
  pgAlerts,
  pgMetricsLatest,
  pgServers,
  servers,
} from '../db/schema.js'
import { encrypt } from '../utils/crypto.js'
import { routeParam } from './helpers.js'

const router = Router()

const CreatePgServerSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/).max(50),
  serverId: z.string().min(1),
  displayName: z.string().min(1).max(100),
  pgHost: z.string().default('localhost'),
  pgPort: z.number().int().default(5432),
  pgUser: z.string().min(1),
  pgPass: z.string().optional(),
  pgDatabase: z.string().default('postgres'),
})

const UpdatePgServerSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  pgHost: z.string().optional(),
  pgPort: z.number().int().optional(),
  pgUser: z.string().min(1).optional(),
  pgPass: z.string().optional(),
  pgDatabase: z.string().optional(),
})

const AlertRuleSchema = z.object({
  metric: z.string().min(1),
  operator: z.enum(['>', '<', '>=', '<=']),
  threshold: z.number(),
  isActive: z.boolean().default(true),
})

function sanitizePgServer(row: typeof pgServers.$inferSelect) {
  return {
    ...row,
    pgUserEnc: '[encrypted]',
    pgPassEnc: row.pgPassEnc ? '[encrypted]' : null,
  }
}

router.get('/', requireRole('superadmin', 'manager'), (_req, res) => {
  const rows = db.select().from(pgServers).all()
  res.json(rows.map(sanitizePgServer))
})

router.get('/:id', requireRole('superadmin', 'manager'), (req, res) => {
  const row = db.select().from(pgServers).where(eq(pgServers.id, routeParam(req, 'id'))).get()
  if (!row) {
    res.status(404).json({ error: 'PostgreSQL server not found' })
    return
  }

  const server = db.select().from(servers).where(eq(servers.id, row.serverId)).get()
  res.json({ ...sanitizePgServer(row), agentServer: server ?? null })
})

router.post('/', requireRole('superadmin'), (req, res) => {
  const body = CreatePgServerSchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() })
    return
  }

  const agentServer = db.select().from(servers).where(eq(servers.id, body.data.serverId)).get()
  if (!agentServer) {
    res.status(404).json({ error: 'Agent server not found' })
    return
  }

  db.insert(pgServers)
    .values({
      id: body.data.id,
      serverId: body.data.serverId,
      displayName: body.data.displayName,
      pgHost: body.data.pgHost,
      pgPort: body.data.pgPort,
      pgUserEnc: encrypt(body.data.pgUser),
      pgPassEnc: body.data.pgPass ? encrypt(body.data.pgPass) : null,
      pgDatabase: body.data.pgDatabase,
    })
    .run()

  res.status(201).json({ id: body.data.id })
})

router.patch('/:id', requireRole('superadmin'), (req, res) => {
  const body = UpdatePgServerSchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() })
    return
  }

  const existing = db.select().from(pgServers).where(eq(pgServers.id, routeParam(req, 'id'))).get()
  if (!existing) {
    res.status(404).json({ error: 'PostgreSQL server not found' })
    return
  }

  db.update(pgServers)
    .set({
      ...(body.data.displayName !== undefined ? { displayName: body.data.displayName } : {}),
      ...(body.data.pgHost !== undefined ? { pgHost: body.data.pgHost } : {}),
      ...(body.data.pgPort !== undefined ? { pgPort: body.data.pgPort } : {}),
      ...(body.data.pgUser !== undefined ? { pgUserEnc: encrypt(body.data.pgUser) } : {}),
      ...(body.data.pgPass !== undefined ? { pgPassEnc: encrypt(body.data.pgPass) } : {}),
      ...(body.data.pgDatabase !== undefined ? { pgDatabase: body.data.pgDatabase } : {}),
    })
    .where(eq(pgServers.id, routeParam(req, 'id')))
    .run()

  res.json({ ok: true })
})

router.delete('/:id', requireRole('superadmin'), (req, res) => {
  db.delete(pgServers).where(eq(pgServers.id, routeParam(req, 'id'))).run()
  res.json({ ok: true })
})

router.get('/:id/metrics', requireRole('superadmin', 'manager'), (req, res) => {
  const metrics = db
    .select()
    .from(pgMetricsLatest)
    .where(eq(pgMetricsLatest.pgServerId, routeParam(req, 'id')))
    .get()

  if (!metrics) {
    res.status(404).json({ error: 'Metrics not available yet' })
    return
  }

  res.json(metrics)
})

router.get('/:id/alerts', requireRole('superadmin', 'manager'), (req, res) => {
  const rows = db
    .select()
    .from(pgAlerts)
    .where(eq(pgAlerts.pgServerId, routeParam(req, 'id')))
    .orderBy(desc(pgAlerts.firedAt))
    .all()

  res.json(rows)
})

router.get('/:id/alert-rules', requireRole('superadmin', 'manager'), (req, res) => {
  const rows = db
    .select()
    .from(pgAlertRules)
    .where(eq(pgAlertRules.pgServerId, routeParam(req, 'id')))
    .all()

  res.json(rows)
})

router.post('/:id/alert-rules', requireRole('superadmin'), (req, res) => {
  const body = AlertRuleSchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() })
    return
  }

  const pgServer = db.select().from(pgServers).where(eq(pgServers.id, routeParam(req, 'id'))).get()
  if (!pgServer) {
    res.status(404).json({ error: 'PostgreSQL server not found' })
    return
  }

  const created = db
    .insert(pgAlertRules)
    .values({
      pgServerId: routeParam(req, 'id'),
      metric: body.data.metric,
      operator: body.data.operator,
      threshold: body.data.threshold,
      isActive: body.data.isActive,
    })
    .returning({ id: pgAlertRules.id })
    .get()

  res.status(201).json({ id: created?.id })
})

router.patch('/:id/alert-rules/:ruleId', requireRole('superadmin'), (req, res) => {
  const body = AlertRuleSchema.partial().safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() })
    return
  }

  const ruleId = Number.parseInt(routeParam(req, 'ruleId'), 10)

  db.update(pgAlertRules)
    .set({
      ...(body.data.metric !== undefined ? { metric: body.data.metric } : {}),
      ...(body.data.operator !== undefined ? { operator: body.data.operator } : {}),
      ...(body.data.threshold !== undefined ? { threshold: body.data.threshold } : {}),
      ...(body.data.isActive !== undefined ? { isActive: body.data.isActive } : {}),
    })
    .where(and(eq(pgAlertRules.id, ruleId), eq(pgAlertRules.pgServerId, routeParam(req, 'id'))))
    .run()

  res.json({ ok: true })
})

router.delete('/:id/alert-rules/:ruleId', requireRole('superadmin'), (req, res) => {
  const ruleId = Number.parseInt(routeParam(req, 'ruleId'), 10)
  db.delete(pgAlertRules)
    .where(and(eq(pgAlertRules.id, ruleId), eq(pgAlertRules.pgServerId, routeParam(req, 'id'))))
    .run()
  res.json({ ok: true })
})

export default router
