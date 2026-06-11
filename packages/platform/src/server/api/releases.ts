import { Router } from 'express'
import fs from 'fs/promises'
import path from 'path'
import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { requireRole } from '../middleware/rbac.js'
import { DeployService } from '../services/deploy.service.js'
import { uploadArtifact, moveUploadedArtifact } from '../services/upload.service.js'
import { createVcsProvider, getVcsRepoPath } from '../services/vcs/factory.js'
import { routeParam } from './helpers.js'
import { db } from '../db/index.js'
import { apps, releases } from '../db/schema.js'

const router = Router()
const deployService = new DeployService()

const ARTIFACTS_DIR = process.env.ARTIFACTS_PATH ?? './data/artifacts'

const downloadProgress = new Map<string, { loaded: number; total: number; status: 'running' | 'done' | 'error' }>()

const SyncSchema = z.object({
  appId: z.string().min(1),
})

const UploadReleaseSchema = z.object({
  appId: z.string().min(1),
  version: z.string().min(1),
  releaseNotes: z.string().optional(),
})

router.get('/', async (req, res) => {
  const appId = typeof req.query.appId === 'string' ? req.query.appId : undefined

  const rows = appId
    ? db.select().from(releases).where(eq(releases.appId, appId)).orderBy(desc(releases.publishedAt)).all()
    : db.select().from(releases).orderBy(desc(releases.publishedAt)).all()

  res.json(rows)
})

router.post('/sync', requireRole('superadmin', 'manager'), async (req, res) => {
  const body = SyncSchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() })
    return
  }

  const app = db.select().from(apps).where(eq(apps.id, body.data.appId)).get()
  if (!app) {
    res.status(404).json({ error: 'App not found' })
    return
  }

  if (app.sourceType !== 'vcs') {
    res.status(400).json({ error: 'App is not configured for VCS sync' })
    return
  }

  const vcs = createVcsProvider(app)
  const { namespace, repo } = getVcsRepoPath(app)
  const remoteReleases = await vcs.listReleases(namespace, repo, 50)

  let synced = 0
  for (const remote of remoteReleases) {
    const existing = db
      .select({ id: releases.id })
      .from(releases)
      .where(and(eq(releases.appId, app.id), eq(releases.version, remote.version)))
      .get()

    if (existing) continue

    db.insert(releases)
      .values({
        appId: app.id,
        version: remote.version,
        githubTag: remote.tag,
        downloadUrl: remote.downloadUrl,
        artifactSize: remote.artifactSize ?? null,
        releaseNotes: remote.releaseNotes ?? null,
        publishedAt: remote.publishedAt,
        source: 'vcs',
      })
      .run()

    synced++
  }

  res.json({ synced, total: remoteReleases.length })
})

router.post('/upload', requireRole('superadmin', 'manager'), uploadArtifact.single('artifact'), async (req, res) => {
  const body = UploadReleaseSchema.safeParse(req.body)
  if (!body.success || !req.file) {
    res.status(400).json({ error: 'Invalid input or missing artifact file' })
    return
  }

  const app = db.select().from(apps).where(eq(apps.id, body.data.appId)).get()
  if (!app) {
    res.status(404).json({ error: 'App not found' })
    return
  }

  if (app.sourceType !== 'upload') {
    res.status(400).json({ error: 'App is not configured for upload releases' })
    return
  }

  const destPath = await moveUploadedArtifact(req.file.filename, app.id, body.data.version)
  const stat = await fs.stat(destPath)
  const now = new Date().toISOString()

  const existing = db
    .select({ id: releases.id })
    .from(releases)
    .where(and(eq(releases.appId, app.id), eq(releases.version, body.data.version)))
    .get()

  if (existing) {
    db.update(releases)
      .set({
        uploadPath: destPath,
        cachedPath: destPath,
        cachedAt: now,
        artifactSize: stat.size,
        releaseNotes: body.data.releaseNotes ?? null,
      })
      .where(eq(releases.id, existing.id))
      .run()
  } else {
    db.insert(releases)
      .values({
        appId: app.id,
        version: body.data.version,
        githubTag: body.data.version.startsWith('v') ? body.data.version : `v${body.data.version}`,
        downloadUrl: destPath,
        uploadPath: destPath,
        cachedPath: destPath,
        cachedAt: now,
        artifactSize: stat.size,
        releaseNotes: body.data.releaseNotes ?? null,
        publishedAt: now,
        source: 'upload',
      })
      .run()
  }

  res.status(201).json({ version: body.data.version, path: destPath, size: stat.size })
})

router.post('/:appId/:version/download', requireRole('superadmin', 'manager'), async (req, res) => {
  const appId = routeParam(req, 'appId')
  const version = routeParam(req, 'version')
  const progressKey = `${appId}:${version}`

  downloadProgress.set(progressKey, { loaded: 0, total: 0, status: 'running' })

  try {
    const app = db.select().from(apps).where(eq(apps.id, appId)).get()
    if (!app) {
      res.status(404).json({ error: 'App not found' })
      return
    }

    const instanceLike = {
      id: '',
      appId: app.id,
      serverId: '',
      appPath: '',
      uploadsPath: '',
      port: 0,
      healthCheckGraceSeconds: 10,
      sourceType: app.sourceType,
      vcsProvider: app.vcsProvider,
      vcsNamespace: app.vcsNamespace,
      vcsRepo: app.vcsRepo,
      vcsTokenEnc: app.vcsTokenEnc,
      artifactName: app.artifactName,
    }

    const artifactPath = await deployService.ensureArtifactReady(instanceLike, version)
    const stat = await fs.stat(artifactPath)

    downloadProgress.set(progressKey, { loaded: stat.size, total: stat.size, status: 'done' })
    res.json({ cached: true, path: artifactPath, size: stat.size })
  } catch (error: unknown) {
    downloadProgress.set(progressKey, { loaded: 0, total: 0, status: 'error' })
    const msg = error instanceof Error ? error.message : 'Download failed'
    res.status(500).json({ error: msg })
  }
})

router.get('/download-progress/:appId/:version', requireRole('superadmin', 'manager', 'viewer'), (req, res) => {
  const progressKey = `${routeParam(req, 'appId')}:${routeParam(req, 'version')}`
  const progress = downloadProgress.get(progressKey)

  if (!progress) {
    res.json({ status: 'idle', loaded: 0, total: 0, percent: 0 })
    return
  }

  const percent = progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : 0
  res.json({ ...progress, percent })
})

export async function serveArtifact(req: import('express').Request, res: import('express').Response): Promise<void> {
  const appId = routeParam(req, 'appId')
  const version = routeParam(req, 'version')
  const artifactPath = path.join(ARTIFACTS_DIR, appId, `${version}.zip`)

  try {
    await fs.access(artifactPath)
    res.download(artifactPath, `${version}.zip`)
  } catch {
    const release = db
      .select()
      .from(releases)
      .where(and(eq(releases.appId, appId), eq(releases.version, version)))
      .get()

    if (release?.cachedPath) {
      res.download(release.cachedPath, `${version}.zip`)
      return
    }

    if (release?.uploadPath) {
      res.download(release.uploadPath, `${version}.zip`)
      return
    }

    res.status(404).json({ error: 'Artifact not found' })
  }
}

export default router
