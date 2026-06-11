import { Router } from 'express'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { requireRole } from '../middleware/rbac.js'
import { db } from '../db/index.js'
import { apps, instances } from '../db/schema.js'
import { encrypt } from '../utils/crypto.js'
import { routeParam } from './helpers.js'

const router: Router = Router()

const VcsFieldsSchema = z.object({
  vcsProvider: z.enum(['github', 'gitlab', 'azure', 'bitbucket']),
  vcsNamespace: z.string().min(1),
  vcsRepo: z.string().min(1),
  vcsToken: z.string().min(1),
})

const CreateAppSchema = z.discriminatedUnion('sourceType', [
  z.object({
    id: z.string().regex(/^[a-z0-9-]+$/).max(50),
    displayName: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    sourceType: z.literal('vcs'),
    runtime: z.enum(['dotnet', 'node']).default('dotnet'),
    targetFramework: z.string().default('net8.0'),
    artifactName: z.string().default('app.zip'),
    defaultEnv: z.record(z.string()).default({}),
  }).merge(VcsFieldsSchema),
  z.object({
    id: z.string().regex(/^[a-z0-9-]+$/).max(50),
    displayName: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    sourceType: z.literal('upload'),
    runtime: z.enum(['dotnet', 'node']).default('dotnet'),
    targetFramework: z.string().default('net8.0'),
    artifactName: z.string().default('app.zip'),
    defaultEnv: z.record(z.string()).default({}),
  }),
])

const UpdateAppSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  runtime: z.enum(['dotnet', 'node']).optional(),
  targetFramework: z.string().optional(),
  artifactName: z.string().optional(),
  defaultEnv: z.record(z.string()).optional(),
  vcsProvider: z.enum(['github', 'gitlab', 'azure', 'bitbucket']).optional(),
  vcsNamespace: z.string().min(1).optional(),
  vcsRepo: z.string().min(1).optional(),
  vcsToken: z.string().min(1).optional(),
})

function sanitizeApp(row: typeof apps.$inferSelect) {
  return {
    ...row,
    vcsTokenEnc: row.vcsTokenEnc ? '[encrypted]' : null,
  }
}

router.get('/', async (_req, res) => {
  const rows = db.select().from(apps).all()
  res.json(rows.map(sanitizeApp))
})

router.get('/:id', async (req, res) => {
  const id = routeParam(req, 'id')
  const app = db.select().from(apps).where(eq(apps.id, id)).get()
  if (!app) {
    res.status(404).json({ error: 'App not found' })
    return
  }
  res.json(sanitizeApp(app))
})

router.post('/', requireRole('superadmin'), async (req, res) => {
  const body = CreateAppSchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() })
    return
  }

  const existing = db.select().from(apps).where(eq(apps.id, body.data.id)).get()
  if (existing) {
    res.status(409).json({ error: 'App already exists' })
    return
  }

  const values =
    body.data.sourceType === 'vcs'
      ? {
          id: body.data.id,
          displayName: body.data.displayName,
          description: body.data.description ?? null,
          sourceType: body.data.sourceType,
          vcsProvider: body.data.vcsProvider,
          vcsNamespace: body.data.vcsNamespace,
          vcsRepo: body.data.vcsRepo,
          vcsTokenEnc: encrypt(body.data.vcsToken),
          artifactName: body.data.artifactName,
          targetFramework: body.data.targetFramework,
          runtime: body.data.runtime,
          defaultEnv: body.data.defaultEnv,
        }
      : {
          id: body.data.id,
          displayName: body.data.displayName,
          description: body.data.description ?? null,
          sourceType: body.data.sourceType,
          artifactName: body.data.artifactName,
          targetFramework: body.data.targetFramework,
          runtime: body.data.runtime,
          defaultEnv: body.data.defaultEnv,
        }

  db.insert(apps).values(values).run()
  res.status(201).json({ id: body.data.id })
})

router.patch('/:id', requireRole('superadmin'), async (req, res) => {
  const id = routeParam(req, 'id')
  const body = UpdateAppSchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() })
    return
  }

  const app = db.select().from(apps).where(eq(apps.id, id)).get()
  if (!app) {
    res.status(404).json({ error: 'App not found' })
    return
  }

  const patch: Partial<typeof apps.$inferInsert> = {}

  if (body.data.displayName !== undefined) patch.displayName = body.data.displayName
  if (body.data.description !== undefined) patch.description = body.data.description
  if (body.data.runtime !== undefined) patch.runtime = body.data.runtime
  if (body.data.targetFramework !== undefined) patch.targetFramework = body.data.targetFramework
  if (body.data.artifactName !== undefined) patch.artifactName = body.data.artifactName
  if (body.data.defaultEnv !== undefined) patch.defaultEnv = body.data.defaultEnv
  if (body.data.vcsProvider !== undefined) patch.vcsProvider = body.data.vcsProvider
  if (body.data.vcsNamespace !== undefined) patch.vcsNamespace = body.data.vcsNamespace
  if (body.data.vcsRepo !== undefined) patch.vcsRepo = body.data.vcsRepo
  if (body.data.vcsToken !== undefined) patch.vcsTokenEnc = encrypt(body.data.vcsToken)

  db.update(apps).set(patch).where(eq(apps.id, id)).run()
  res.json({ ok: true })
})

router.delete('/:id', requireRole('superadmin'), async (req, res) => {
  const id = routeParam(req, 'id')
  const app = db.select().from(apps).where(eq(apps.id, id)).get()
  if (!app) {
    res.status(404).json({ error: 'App not found' })
    return
  }

  const bound = db.select({ id: instances.id }).from(instances).where(eq(instances.appId, id)).all()
  if (bound.length > 0) {
    res.status(409).json({ error: 'Remove instances before deleting app' })
    return
  }

  db.delete(apps).where(eq(apps.id, id)).run()
  res.json({ ok: true })
})

export default router
