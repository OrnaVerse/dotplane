import { and, eq } from 'drizzle-orm'
import { AgentService } from './agent.service.js'
import { decrypt } from '../utils/crypto.js'
import { db } from '../db/index.js'
import {
  pgAlertRules,
  pgAlerts,
  pgMetricsLatest,
  pgServers,
} from '../db/schema.js'
import { logger } from '../logger.js'

const POLL_INTERVAL_MS = 60_000

let pollerTimer: ReturnType<typeof setInterval> | null = null

export function startPgHealthPoller(): void {
  if (pollerTimer) return

  void pollPgMetrics()
  pollerTimer = setInterval(() => {
    void pollPgMetrics()
  }, POLL_INTERVAL_MS)

  logger.info('PostgreSQL health poller started')
}

export function stopPgHealthPoller(): void {
  if (pollerTimer) {
    clearInterval(pollerTimer)
    pollerTimer = null
  }
}

async function pollPgMetrics(): Promise<void> {
  const pgServerRows = await db.select().from(pgServers)

  for (const pgServer of pgServerRows) {
    try {
      const agent = new AgentService(pgServer.serverId)
      const pgUser = decrypt(pgServer.pgUserEnc)
      const pgPass = pgServer.pgPassEnc ? decrypt(pgServer.pgPassEnc) : ''

      const metrics = await agent.getPgMetrics(
        pgServer.pgHost,
        pgServer.pgPort,
        pgUser,
        pgPass,
        pgServer.pgDatabase,
      )

      const now = new Date().toISOString()

      await db
        .insert(pgMetricsLatest)
        .values({
          pgServerId: pgServer.id,
          connectionsTotal: metrics.connectionsTotal,
          connectionsActive: metrics.connectionsActive,
          connectionsIdle: metrics.connectionsIdle,
          connectionsWaiting: metrics.connectionsWaiting,
          dbSizeBytes: metrics.dbSizeBytes,
          cacheHitRatio: metrics.cacheHitRatio,
          tpsCommit: metrics.tpsCommit,
          tpsRollback: metrics.tpsRollback,
          longQueries: metrics.longQueries,
          replicationLagBytes: metrics.replicationLagBytes,
          bloatEstimate: metrics.bloatEstimate,
          autovacuumRunning: metrics.autovacuumRunning,
          collectedAt: now,
        })
        .onConflictDoUpdate({
          target: pgMetricsLatest.pgServerId,
          set: {
            connectionsTotal: metrics.connectionsTotal,
            connectionsActive: metrics.connectionsActive,
            connectionsIdle: metrics.connectionsIdle,
            connectionsWaiting: metrics.connectionsWaiting,
            dbSizeBytes: metrics.dbSizeBytes,
            cacheHitRatio: metrics.cacheHitRatio,
            tpsCommit: metrics.tpsCommit,
            tpsRollback: metrics.tpsRollback,
            longQueries: metrics.longQueries,
            replicationLagBytes: metrics.replicationLagBytes,
            bloatEstimate: metrics.bloatEstimate,
            autovacuumRunning: metrics.autovacuumRunning,
            collectedAt: now,
          },
        })

      await db
        .update(pgServers)
        .set({ status: 'online', lastChecked: now })
        .where(eq(pgServers.id, pgServer.id))

      await evaluateAlertRules(pgServer.id, metrics)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      await db
        .update(pgServers)
        .set({ status: 'offline', lastChecked: new Date().toISOString() })
        .where(eq(pgServers.id, pgServer.id))
      logger.warn({ pgServerId: pgServer.id, err: msg }, 'PG metrics poll failed')
    }
  }
}

interface MetricsSnapshot {
  connectionsTotal: number
  connectionsActive: number
  connectionsIdle: number
  connectionsWaiting: number
  dbSizeBytes: number
  cacheHitRatio: number
  tpsCommit: number
  tpsRollback: number
  replicationLagBytes: number | null
  autovacuumRunning: boolean
}

async function evaluateAlertRules(pgServerId: string, metrics: MetricsSnapshot): Promise<void> {
  const rules = await db
    .select()
    .from(pgAlertRules)
    .where(and(eq(pgAlertRules.pgServerId, pgServerId), eq(pgAlertRules.isActive, true)))

  const metricValues: Record<string, number> = {
    connections_total: metrics.connectionsTotal,
    connections_active: metrics.connectionsActive,
    connections_idle: metrics.connectionsIdle,
    connections_waiting: metrics.connectionsWaiting,
    db_size_bytes: metrics.dbSizeBytes,
    cache_hit_ratio: metrics.cacheHitRatio,
    tps_commit: metrics.tpsCommit,
    tps_rollback: metrics.tpsRollback,
    replication_lag_bytes: metrics.replicationLagBytes ?? 0,
    autovacuum_running: metrics.autovacuumRunning ? 1 : 0,
  }

  for (const rule of rules) {
    const value = metricValues[rule.metric]
    if (value === undefined) continue

    const firing = evaluateOperator(value, rule.operator, rule.threshold)

    const [existing] = await db
      .select()
      .from(pgAlerts)
      .where(and(eq(pgAlerts.ruleId, rule.id), eq(pgAlerts.status, 'firing')))

    if (firing && !existing) {
      await db.insert(pgAlerts).values({
        pgServerId,
        ruleId: rule.id,
        metric: rule.metric,
        value,
        threshold: rule.threshold,
        status: 'firing',
      })
    } else if (!firing && existing) {
      await db
        .update(pgAlerts)
        .set({ status: 'resolved', resolvedAt: new Date().toISOString() })
        .where(eq(pgAlerts.id, existing.id))
    } else if (firing && existing) {
      await db
        .update(pgAlerts)
        .set({ value })
        .where(eq(pgAlerts.id, existing.id))
    }
  }
}

function evaluateOperator(value: number, operator: '>' | '<' | '>=' | '<=', threshold: number): boolean {
  switch (operator) {
    case '>':
      return value > threshold
    case '<':
      return value < threshold
    case '>=':
      return value >= threshold
    case '<=':
      return value <= threshold
  }
}
