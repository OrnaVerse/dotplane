import pg from 'pg'
import { agentConfig } from '../config.js'

const { Client } = pg

export interface PgConnectionConfig {
  host: string
  port: number
  user: string
  password?: string
  database: string
}

export interface PgMetrics {
  connectionsTotal: number
  connectionsActive: number
  connectionsIdle: number
  connectionsWaiting: number
  dbSizeBytes: number
  cacheHitRatio: number | null
  tpsCommit: number | null
  tpsRollback: number | null
  longQueries: Array<{ pid: number; durationMs: number; state: string; queryTruncated: string }>
  replicationLagBytes: number | null
  bloatEstimate: Array<{ schema: string; table: string; bloatRatio: number }>
  autovacuumRunning: boolean
  collectedAt: string
}

export async function collectMetrics(config: PgConnectionConfig): Promise<PgMetrics> {
  const client = new Client({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionTimeoutMillis: 5000,
  })

  await client.connect()

  try {
    const [
      connections,
      dbSize,
      cacheHit,
      tps,
      longQueries,
      replicationLag,
      autovacuum,
    ] = await Promise.all([
      client.query<{ total: string; active: string; idle: string; waiting: string }>(`
        SELECT
          count(*)::text AS total,
          count(*) FILTER (WHERE state = 'active')::text AS active,
          count(*) FILTER (WHERE state = 'idle')::text AS idle,
          count(*) FILTER (WHERE wait_event_type IS NOT NULL)::text AS waiting
        FROM pg_stat_activity
        WHERE datname = current_database()
      `),
      client.query<{ size: string }>(`
        SELECT pg_database_size(current_database())::text AS size
      `),
      client.query<{ ratio: string | null }>(`
        SELECT
          CASE
            WHEN sum(blks_hit + blks_read) = 0 THEN NULL
            ELSE round(sum(blks_hit)::numeric / nullif(sum(blks_hit + blks_read), 0), 4)
          END::text AS ratio
        FROM pg_stat_database
        WHERE datname = current_database()
      `),
      client.query<{ commit: string | null; rollback: string | null }>(`
        SELECT xact_commit::text AS commit, xact_rollback::text AS rollback
        FROM pg_stat_database
        WHERE datname = current_database()
      `),
      client.query<{ pid: number; duration_ms: string; state: string; query: string }>(`
        SELECT
          pid,
          extract(epoch FROM (now() - query_start)) * 1000 AS duration_ms,
          state,
          left(query, 200) AS query
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND state = 'active'
          AND pid <> pg_backend_pid()
          AND query_start < now() - interval '30 seconds'
        ORDER BY query_start
        LIMIT 10
      `),
      client.query<{ lag: string | null }>(`
        SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)::text AS lag
        FROM pg_stat_replication
        LIMIT 1
      `).catch(() => ({ rows: [{ lag: null }] })),
      client.query<{ running: boolean }>(`
        SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity
          WHERE query ILIKE 'autovacuum:%'
        ) AS running
      `),
    ])

    const conn = connections.rows[0]
    const sizeRow = dbSize.rows[0]
    const cacheRow = cacheHit.rows[0]
    const tpsRow = tps.rows[0]

    return {
      connectionsTotal: parseInt(conn?.total ?? '0', 10),
      connectionsActive: parseInt(conn?.active ?? '0', 10),
      connectionsIdle: parseInt(conn?.idle ?? '0', 10),
      connectionsWaiting: parseInt(conn?.waiting ?? '0', 10),
      dbSizeBytes: parseInt(sizeRow?.size ?? '0', 10),
      cacheHitRatio: cacheRow?.ratio != null ? parseFloat(cacheRow.ratio) : null,
      tpsCommit: tpsRow?.commit != null ? parseFloat(tpsRow.commit) : null,
      tpsRollback: tpsRow?.rollback != null ? parseFloat(tpsRow.rollback) : null,
      longQueries: longQueries.rows.map((row) => ({
        pid: row.pid,
        durationMs: parseFloat(row.duration_ms),
        state: row.state,
        queryTruncated: row.query,
      })),
      replicationLagBytes: replicationLag.rows[0]?.lag != null
        ? parseInt(replicationLag.rows[0].lag, 10)
        : null,
      bloatEstimate: [],
      autovacuumRunning: autovacuum.rows[0]?.running ?? false,
      collectedAt: new Date().toISOString(),
    }
  } finally {
    await client.end()
  }
}

export function resolvePgConfig(query: Record<string, unknown>): PgConnectionConfig {
  return {
    host: typeof query.host === 'string' ? query.host : agentConfig.pgHost,
    port: typeof query.port === 'string' ? parseInt(query.port, 10) : agentConfig.pgPort,
    user: typeof query.user === 'string' ? query.user : (agentConfig.pgUser ?? ''),
    password: typeof query.password === 'string' ? query.password : agentConfig.pgPassword,
    database: typeof query.database === 'string' ? query.database : agentConfig.pgDatabase,
  }
}
