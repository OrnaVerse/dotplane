import { Router } from 'express'
import { z } from 'zod'
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { requireRole } from '../middleware/rbac.js'
import { db } from '../db/index.js'
import { auditLog } from '../db/schema.js'
import { routeParam } from './helpers.js'

const router = Router()

const QuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  action: z.string().optional(),
  actorId: z.coerce.number().int().optional(),
  targetType: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

router.get('/', requireRole('superadmin'), (req, res) => {
  const query = QuerySchema.safeParse(req.query)
  if (!query.success) {
    res.status(400).json({ error: query.error.flatten() })
    return
  }

  const { page, pageSize, action, actorId, targetType, from, to } = query.data
  const offset = (page - 1) * pageSize

  const conditions = []

  if (action) conditions.push(eq(auditLog.action, action))
  if (actorId) conditions.push(eq(auditLog.actorId, actorId))
  if (targetType) conditions.push(eq(auditLog.targetType, targetType))
  if (from) conditions.push(gte(auditLog.createdAt, from))
  if (to) conditions.push(lte(auditLog.createdAt, to))

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const rows = db
    .select()
    .from(auditLog)
    .where(whereClause)
    .orderBy(desc(auditLog.createdAt))
    .limit(pageSize)
    .offset(offset)
    .all()

  const countRow = db
    .select({ count: sql<number>`count(*)` })
    .from(auditLog)
    .where(whereClause)
    .get()

  res.json({
    items: rows,
    page,
    pageSize,
    total: countRow?.count ?? 0,
    totalPages: Math.ceil((countRow?.count ?? 0) / pageSize),
  })
})

router.get('/:id', requireRole('superadmin'), (req, res) => {
  const id = Number.parseInt(routeParam(req, 'id'), 10)
  const row = db.select().from(auditLog).where(eq(auditLog.id, id)).get()

  if (!row) {
    res.status(404).json({ error: 'Audit entry not found' })
    return
  }

  res.json(row)
})

export default router
