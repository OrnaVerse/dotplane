import fs from 'fs/promises'
import path from 'path'
import { and, eq } from 'drizzle-orm'
import { AgentService } from './agent.service.js'
import { createVcsProvider, getVcsRepoPath } from './vcs/factory.js'
import { db } from '../db/index.js'
import { apps, deployments, instances, releases, servers } from '../db/schema.js'

export type DeployEvent =
  | { type: 'step'; step: string; status: 'running' | 'done' | 'error'; message?: string }
  | { type: 'health'; status: 'healthy' | 'degraded' | 'down' }
  | { type: 'done'; success: boolean; deploymentId: number }

export interface DeployAllParams {
  appId: string
  version: string
  batchSize: number
  delaySeconds: number
  instanceIds?: string[]
}

export type DeployAllEvent =
  | { type: 'batch_start'; instanceIds: string[] }
  | { type: 'aborted'; reason: string }
  | { type: 'complete'; results: Record<string, boolean> }
  | ({ instanceId: string } & DeployEvent)

interface InstanceWithApp {
  id: string
  appId: string
  serverId: string
  appPath: string
  uploadsPath: string
  port: number
  healthCheckGraceSeconds: number
  sourceType: 'vcs' | 'upload'
  vcsProvider: 'github' | 'gitlab' | 'azure' | 'bitbucket' | null
  vcsNamespace: string | null
  vcsRepo: string | null
  vcsTokenEnc: string | null
  artifactName: string
}

const ARTIFACTS_DIR = process.env.ARTIFACTS_PATH ?? './data/artifacts'

export class DeployService {
  async deployInstanceSSE(
    instanceId: string,
    version: string,
    userId: number,
    emit: (event: DeployEvent) => void,
  ): Promise<void> {
    const instance = await this.loadInstance(instanceId)
    await this.preDeployValidate(instance, version)

    const [release] = await db
      .select({ id: releases.id })
      .from(releases)
      .where(and(eq(releases.appId, instance.appId), eq(releases.version, version)))

    if (!release) {
      throw new Error(`Release ${version} not found for app ${instance.appId}`)
    }

    const [deployment] = await db
      .insert(deployments)
      .values({
        instanceId,
        releaseId: release.id,
        version,
        status: 'running',
        triggeredBy: userId,
      })
      .returning({ id: deployments.id })

    if (!deployment) {
      throw new Error('Failed to create deployment record')
    }

    const deploymentId = deployment.id
    const log: string[] = []
    const agent = new AgentService(instance.serverId)

    try {
      emit({ type: 'step', step: 'download', status: 'running' })
      const artifactPath = await this.ensureArtifactReady(instance, version)
      log.push(`Artifact ready: ${artifactPath}`)
      emit({ type: 'step', step: 'download', status: 'done' })

      emit({ type: 'step', step: 'stop', status: 'running' })
      await agent.stopInstance(instanceId)
      log.push('Instance stopped')
      emit({ type: 'step', step: 'stop', status: 'done' })

      emit({ type: 'step', step: 'deploy', status: 'running' })
      await agent.deployInstance({
        instanceId,
        artifactUrl: this.getArtifactUrl(instance.appId, version),
        version,
        appPath: instance.appPath,
        uploadsPath: instance.uploadsPath,
      })
      log.push('Artifact extracted')
      emit({ type: 'step', step: 'deploy', status: 'done' })

      emit({ type: 'step', step: 'start', status: 'running' })
      await agent.startInstance(instanceId)
      log.push('Instance started')
      emit({ type: 'step', step: 'start', status: 'done' })

      emit({ type: 'step', step: 'health', status: 'running' })
      await sleep(instance.healthCheckGraceSeconds * 1000 + 3000)
      const health = await agent.healthCheck(instanceId, instance.port)
      log.push(`Health: ${health}`)
      emit({ type: 'health', status: health === 'unknown' ? 'down' : health })
      emit({ type: 'step', step: 'health', status: health === 'down' ? 'error' : 'done' })

      const healthStatus = health === 'unknown' ? 'down' : health
      const now = new Date().toISOString()

      await db
        .update(instances)
        .set({ currentVersion: version, lastDeployed: now, healthStatus })
        .where(eq(instances.id, instanceId))

      await db
        .update(deployments)
        .set({
          status: healthStatus === 'down' ? 'failed' : 'success',
          finishedAt: now,
          log: log.join('\n'),
          healthAfter: healthStatus,
        })
        .where(eq(deployments.id, deploymentId))

      emit({ type: 'done', success: healthStatus !== 'down', deploymentId })
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      log.push(`ERROR: ${msg}`)
      await db
        .update(deployments)
        .set({ status: 'failed', finishedAt: new Date().toISOString(), log: log.join('\n') })
        .where(eq(deployments.id, deploymentId))
      emit({ type: 'step', step: 'error', status: 'error', message: msg })
      emit({ type: 'done', success: false, deploymentId })
    }
  }

  async deployAllSSE(
    params: DeployAllParams,
    userId: number,
    emit: (event: DeployAllEvent) => void,
  ): Promise<void> {
    const instanceRows = params.instanceIds?.length
      ? await db
          .select({ id: instances.id })
          .from(instances)
          .where(and(eq(instances.appId, params.appId)))
      : await db.select({ id: instances.id }).from(instances).where(eq(instances.appId, params.appId))

    const filtered = params.instanceIds
      ? instanceRows.filter((row) => params.instanceIds?.includes(row.id))
      : instanceRows

    const batches = chunk(filtered.map((i) => i.id), params.batchSize)
    let consecutiveFailures = 0
    const results: Record<string, boolean> = {}

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex]
      if (!batch?.length) continue

      emit({ type: 'batch_start', instanceIds: batch })

      let batchFailures = 0
      await Promise.all(
        batch.map(async (instanceId) => {
          try {
            await this.deployInstanceSSE(instanceId, params.version, userId, (event) => {
              emit({ instanceId, ...event })
            })
            results[instanceId] = true
          } catch {
            results[instanceId] = false
            batchFailures++
          }
        }),
      )

      if (batchFailures > 0) {
        consecutiveFailures++
      } else {
        consecutiveFailures = 0
      }

      if (consecutiveFailures >= 2) {
        emit({ type: 'aborted', reason: '2 consecutive batch failures' })
        break
      }

      if (batchIndex < batches.length - 1) {
        await sleep(params.delaySeconds * 1000)
      }
    }

    emit({ type: 'complete', results })
  }

  async preDeployValidate(instance: InstanceWithApp, version: string): Promise<void> {
    const [server] = await db.select().from(servers).where(eq(servers.id, instance.serverId))
    if (!server) {
      throw new Error('Target server not found')
    }
    if (server.status === 'offline') {
      throw new Error(`Server ${server.displayName} is offline`)
    }

    const [release] = await db
      .select()
      .from(releases)
      .where(and(eq(releases.appId, instance.appId), eq(releases.version, version)))

    if (!release && instance.sourceType === 'upload') {
      throw new Error(`Release ${version} not found — upload artifact first`)
    }

    if (!release && instance.sourceType === 'vcs') {
      const vcs = createVcsProvider(instance)
      const { namespace, repo } = getVcsRepoPath(instance)
      const remote = await vcs.getRelease(namespace, repo, version)
      if (!remote) {
        throw new Error(`Release ${version} not found in VCS`)
      }
    }
  }

  async ensureArtifactReady(instance: InstanceWithApp, version: string): Promise<string> {
    const cachedPath = path.join(ARTIFACTS_DIR, instance.appId, `${version}.zip`)

    try {
      await fs.access(cachedPath)
      return cachedPath
    } catch {
      // not cached — download
    }

    if (instance.sourceType === 'upload') {
      const [release] = await db
        .select()
        .from(releases)
        .where(and(eq(releases.appId, instance.appId), eq(releases.version, version)))

      if (!release?.uploadPath) {
        throw new Error('Upload artifact path not found')
      }
      await fs.mkdir(path.dirname(cachedPath), { recursive: true })
      await fs.copyFile(release.uploadPath, cachedPath)
    } else {
      const vcs = createVcsProvider(instance)
      const { namespace, repo } = getVcsRepoPath(instance)
      const remote = await vcs.getRelease(namespace, repo, version)
      if (!remote) {
        throw new Error(`Release ${version} not found in VCS`)
      }
      await fs.mkdir(path.dirname(cachedPath), { recursive: true })
      await vcs.downloadRelease(remote, cachedPath)
    }

    const stat = await fs.stat(cachedPath)
    const now = new Date().toISOString()

    const [existing] = await db
      .select({ id: releases.id })
      .from(releases)
      .where(and(eq(releases.appId, instance.appId), eq(releases.version, version)))

    if (existing) {
      await db
        .update(releases)
        .set({ cachedPath, cachedAt: now, artifactSize: stat.size })
        .where(eq(releases.id, existing.id))
    } else {
      await db.insert(releases).values({
        appId: instance.appId,
        version,
        githubTag: version.startsWith('v') ? version : `v${version}`,
        downloadUrl: this.getArtifactUrl(instance.appId, version),
        artifactSize: stat.size,
        cachedPath,
        cachedAt: now,
        publishedAt: now,
        source: instance.sourceType,
      })
    }

    return cachedPath
  }

  private getArtifactUrl(appId: string, version: string): string {
    const port = process.env.PLATFORM_PORT ?? '58291'
    const urlKey = process.env.PLATFORM_URL_KEY ?? ''
    return `http://127.0.0.1:${port}/${urlKey}/api/artifacts/${appId}/${version}`
  }

  private async loadInstance(instanceId: string): Promise<InstanceWithApp> {
    const [row] = await db
      .select({
        id: instances.id,
        appId: instances.appId,
        serverId: instances.serverId,
        appPath: instances.appPath,
        uploadsPath: instances.uploadsPath,
        port: instances.port,
        healthCheckGraceSeconds: instances.healthCheckGraceSeconds,
        sourceType: apps.sourceType,
        vcsProvider: apps.vcsProvider,
        vcsNamespace: apps.vcsNamespace,
        vcsRepo: apps.vcsRepo,
        vcsTokenEnc: apps.vcsTokenEnc,
        artifactName: apps.artifactName,
      })
      .from(instances)
      .innerJoin(apps, eq(apps.id, instances.appId))
      .where(eq(instances.id, instanceId))

    if (!row) {
      throw new Error('Instance not found')
    }
    return row
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size),
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
