import { Router } from 'express'
import crypto from 'crypto'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { requireRole } from '../middleware/rbac.js'
import { fireWebhooks } from '../services/webhook.service.js'
import { db } from '../db/index.js'
import { outboundWebhooks } from '../db/schema.js'

import { routeParam } from './helpers.js'

const router = Router()

const CreateWebhookSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  events: z.array(z.string()).min(1),
  secret: z.string().min(16).optional(),
})

const UpdateWebhookSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  url: z.string().url().optional(),
  events: z.array(z.string()).min(1).optional(),
  isActive: z.boolean().optional(),
  secret: z.string().min(16).optional(),
})

const TestWebhookSchema = z.object({
  event: z.string().default('test'),
  data: z.record(z.unknown()).default({}),
})

function sanitizeWebhook(row: typeof outboundWebhooks.$inferSelect) {
  return {
    ...row,
    secret: '[redacted]',
  }
}

router.get('/', requireRole('superadmin'), (_req, res) => {
  const rows = db.select().from(outboundWebhooks).all()
  res.json(rows.map(sanitizeWebhook))
})

router.get('/:id', requireRole('superadmin'), (req, res) => {
  const row = db
    .select()
    .from(outboundWebhooks)
    .where(eq(outboundWebhooks.id, Number.parseInt(routeParam(req, 'id'), 10)))
    .get()

  if (!row) {
    res.status(404).json({ error: 'Webhook not found' })
    return
  }

  res.json(sanitizeWebhook(row))
})

router.post('/', requireRole('superadmin'), (req, res) => {
  const body = CreateWebhookSchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() })
    return
  }

  const secret = body.data.secret ?? crypto.randomBytes(32).toString('hex')

  const created = db
    .insert(outboundWebhooks)
    .values({
      name: body.data.name,
      url: body.data.url,
      events: body.data.events,
      secret,
    })
    .returning({ id: outboundWebhooks.id })
    .get()

  res.status(201).json({ id: created?.id, secret })
})

router.patch('/:id', requireRole('superadmin'), (req, res) => {
  const body = UpdateWebhookSchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() })
    return
  }

  const id = Number.parseInt(routeParam(req, 'id'), 10)
  const existing = db.select().from(outboundWebhooks).where(eq(outboundWebhooks.id, id)).get()
  if (!existing) {
    res.status(404).json({ error: 'Webhook not found' })
    return
  }

  db.update(outboundWebhooks)
    .set({
      ...(body.data.name !== undefined ? { name: body.data.name } : {}),
      ...(body.data.url !== undefined ? { url: body.data.url } : {}),
      ...(body.data.events !== undefined ? { events: body.data.events } : {}),
      ...(body.data.isActive !== undefined ? { isActive: body.data.isActive } : {}),
      ...(body.data.secret !== undefined ? { secret: body.data.secret } : {}),
    })
    .where(eq(outboundWebhooks.id, id))
    .run()

  res.json({ ok: true })
})

router.delete('/:id', requireRole('superadmin'), (req, res) => {
  const id = Number.parseInt(routeParam(req, 'id'), 10)
  db.delete(outboundWebhooks).where(eq(outboundWebhooks.id, id)).run()
  res.json({ ok: true })
})

router.post('/:id/test', requireRole('superadmin'), async (req, res) => {
  const body = TestWebhookSchema.safeParse(req.body ?? {})
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() })
    return
  }

  const id = Number.parseInt(routeParam(req, 'id'), 10)
  const hook = db.select().from(outboundWebhooks).where(eq(outboundWebhooks.id, id)).get()
  if (!hook) {
    res.status(404).json({ error: 'Webhook not found' })
    return
  }

  await fireWebhooks(body.data.event, { ...body.data.data, webhookId: id, test: true })
  res.json({ ok: true })
})

export default router
