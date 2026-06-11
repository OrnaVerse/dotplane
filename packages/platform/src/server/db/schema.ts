import { sqliteTable, text, integer, real, primaryKey } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['superadmin', 'manager', 'viewer'] }).notNull().default('viewer'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdBy: integer('created_by'),
  lastLogin: text('last_login'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  totpSecretEnc: text('totp_secret_enc'),
  totpEnabled: integer('totp_enabled', { mode: 'boolean' }).notNull().default(false),
})

export const sessions = sqliteTable('sessions', {
  sessionId: text('session_id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  refreshToken: text('refresh_token').notNull().unique(),
  expiresAt: text('expires_at').notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  revoked: integer('revoked', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

export const invites = sqliteTable('invites', {
  token: text('token').primaryKey(),
  email: text('email'),
  role: text('role', { enum: ['manager', 'viewer'] }).notNull().default('viewer'),
  createdBy: integer('created_by'),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'),
  usedBy: integer('used_by'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

export const servers = sqliteTable('servers', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  hostname: text('hostname').notNull(),
  agentPort: integer('agent_port').notNull().default(7823),
  agentCertPem: text('agent_cert_pem'),
  status: text('status', { enum: ['pending', 'online', 'offline', 'degraded'] }).notNull().default('pending'),
  lastSeen: text('last_seen'),
  totalMemory: integer('total_memory'),
  totalCpu: integer('total_cpu'),
  diskTotal: integer('disk_total'),
  diskUsed: integer('disk_used'),
  osInfo: text('os_info', { mode: 'json' }).$type<Record<string, string>>(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

export const serverSdks = sqliteTable('server_sdks', {
  serverId: text('server_id').notNull().references(() => servers.id, { onDelete: 'cascade' }),
  sdkVersion: text('sdk_version').notNull(),
  runtimeVersion: text('runtime_version').notNull(),
  installPath: text('install_path'),
  installedAt: text('installed_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => [primaryKey({ columns: [t.serverId, t.sdkVersion] })])

export const serverRuntimes = sqliteTable('server_runtimes', {
  serverId: text('server_id').notNull().references(() => servers.id, { onDelete: 'cascade' }),
  runtime: text('runtime').notNull(),
  version: text('version').notNull(),
  installedAt: text('installed_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (t) => [primaryKey({ columns: [t.serverId, t.runtime, t.version] })])

export const apps = sqliteTable('apps', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  description: text('description'),
  sourceType: text('source_type', { enum: ['vcs', 'upload'] }).notNull().default('vcs'),
  vcsProvider: text('vcs_provider', { enum: ['github', 'gitlab', 'azure', 'bitbucket'] }),
  vcsNamespace: text('vcs_namespace'),
  vcsRepo: text('vcs_repo'),
  vcsTokenEnc: text('vcs_token_enc'),
  artifactName: text('artifact_name').notNull().default('app.zip'),
  targetFramework: text('target_framework').notNull().default('net8.0'),
  runtime: text('runtime', { enum: ['dotnet', 'node'] }).notNull().default('dotnet'),
  defaultEnv: text('default_env', { mode: 'json' }).notNull().$type<Record<string, string>>().default({}),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

export const releases = sqliteTable('releases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  appId: text('app_id').notNull().references(() => apps.id, { onDelete: 'cascade' }),
  version: text('version').notNull(),
  githubTag: text('github_tag').notNull(),
  downloadUrl: text('download_url').notNull(),
  artifactSize: integer('artifact_size'),
  cachedPath: text('cached_path'),
  cachedAt: text('cached_at'),
  releaseNotes: text('release_notes'),
  publishedAt: text('published_at').notNull(),
  source: text('source', { enum: ['vcs', 'upload'] }).notNull().default('vcs'),
  uploadPath: text('upload_path'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

export const instances = sqliteTable('instances', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  appId: text('app_id').notNull().references(() => apps.id),
  serverId: text('server_id').notNull().references(() => servers.id),
  domain: text('domain').notNull().unique(),
  port: integer('port').notNull(),
  memoryTier: text('memory_tier', { enum: ['minimal', 'standard', 'professional', 'enterprise'] }).notNull().default('standard'),
  envVars: text('env_vars', { mode: 'json' }).notNull().$type<Record<string, string>>().default({}),
  appPath: text('app_path').notNull(),
  uploadsPath: text('uploads_path').notNull(),
  currentVersion: text('current_version'),
  healthStatus: text('health_status', { enum: ['healthy', 'degraded', 'down', 'unknown'] }).notNull().default('unknown'),
  runtimeVersion: text('runtime_version').notNull().default('8.0'),
  healthCheckPath: text('health_check_path').notNull().default('/health'),
  healthCheckGraceSeconds: integer('health_check_grace_seconds').notNull().default(10),
  lastDeployed: text('last_deployed'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

export const deployments = sqliteTable('deployments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  instanceId: text('instance_id').notNull().references(() => instances.id, { onDelete: 'cascade' }),
  releaseId: integer('release_id').notNull().references(() => releases.id),
  version: text('version').notNull(),
  status: text('status', { enum: ['pending', 'running', 'success', 'failed', 'rolled_back'] }).notNull().default('pending'),
  triggeredBy: integer('triggered_by'),
  startedAt: text('started_at').notNull().$defaultFn(() => new Date().toISOString()),
  finishedAt: text('finished_at'),
  log: text('log'),
  healthAfter: text('health_after'),
})

export const userInstanceAccess = sqliteTable('user_instance_access', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  instanceId: text('instance_id').notNull().references(() => instances.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.userId, t.instanceId] })])

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  isSensitive: integer('is_sensitive', { mode: 'boolean' }).notNull().default(false),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
})

export const deployTokens = sqliteTable('deploy_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  appId: text('app_id').references(() => apps.id),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  lastUsed: text('last_used'),
  createdBy: integer('created_by'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  action: text('action').notNull(),
  actorId: integer('actor_id'),
  actorUsername: text('actor_username'),
  targetType: text('target_type'),
  targetId: text('target_id'),
  detail: text('detail', { mode: 'json' }).$type<Record<string, unknown>>(),
  ip: text('ip'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

export const userBackupCodes = sqliteTable('user_backup_codes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  codeHash: text('code_hash').notNull(),
  usedAt: text('used_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

export const instanceMetricsHistory = sqliteTable('instance_metrics_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  instanceId: text('instance_id').notNull().references(() => instances.id, { onDelete: 'cascade' }),
  memoryBytes: integer('memory_bytes'),
  cpuPercent: real('cpu_percent'),
  restartCount: integer('restart_count'),
  collectedAt: text('collected_at').notNull().$defaultFn(() => new Date().toISOString()),
})

export const provisionJobs = sqliteTable('provision_jobs', {
  id: text('id').primaryKey(),
  status: text('status', { enum: ['pending', 'running', 'done', 'failed'] }).notNull().default('pending'),
  appId: text('app_id').notNull(),
  serverId: text('server_id'),
  instanceId: text('instance_id'),
  requestBody: text('request_body', { mode: 'json' }).$type<Record<string, unknown>>(),
  errorMessage: text('error_message'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  completedAt: text('completed_at'),
  triggeredBy: integer('triggered_by'),
})

export const outboundWebhooks = sqliteTable('outbound_webhooks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  url: text('url').notNull(),
  secret: text('secret').notNull(),
  events: text('events', { mode: 'json' }).notNull().$type<string[]>(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  lastCalledAt: text('last_called_at'),
  lastStatus: integer('last_status'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

export const pgServers = sqliteTable('pg_servers', {
  id: text('id').primaryKey(),
  serverId: text('server_id').notNull().references(() => servers.id, { onDelete: 'cascade' }),
  displayName: text('display_name').notNull(),
  pgHost: text('pg_host').notNull().default('localhost'),
  pgPort: integer('pg_port').notNull().default(5432),
  pgUserEnc: text('pg_user_enc').notNull(),
  pgPassEnc: text('pg_pass_enc'),
  pgDatabase: text('pg_database').notNull().default('postgres'),
  status: text('status', { enum: ['online', 'offline', 'unknown'] }).notNull().default('unknown'),
  lastChecked: text('last_checked'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

export const pgMetricsLatest = sqliteTable('pg_metrics_latest', {
  pgServerId: text('pg_server_id').primaryKey().references(() => pgServers.id),
  connectionsTotal: integer('connections_total'),
  connectionsActive: integer('connections_active'),
  connectionsIdle: integer('connections_idle'),
  connectionsWaiting: integer('connections_waiting'),
  dbSizeBytes: integer('db_size_bytes'),
  cacheHitRatio: real('cache_hit_ratio'),
  tpsCommit: real('tps_commit'),
  tpsRollback: real('tps_rollback'),
  longQueries: text('long_queries', { mode: 'json' }).$type<Array<{ pid: number; durationMs: number; state: string; queryTruncated: string }>>(),
  replicationLagBytes: integer('replication_lag_bytes'),
  bloatEstimate: text('bloat_estimate', { mode: 'json' }).$type<Array<{ schema: string; table: string; bloatRatio: number }>>(),
  autovacuumRunning: integer('autovacuum_running', { mode: 'boolean' }),
  collectedAt: text('collected_at').notNull().$defaultFn(() => new Date().toISOString()),
})

export const pgAlertRules = sqliteTable('pg_alert_rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pgServerId: text('pg_server_id').notNull().references(() => pgServers.id, { onDelete: 'cascade' }),
  metric: text('metric').notNull(),
  operator: text('operator', { enum: ['>', '<', '>=', '<='] }).notNull(),
  threshold: real('threshold').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

export const pgAlerts = sqliteTable('pg_alerts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pgServerId: text('pg_server_id').references(() => pgServers.id),
  ruleId: integer('rule_id').references(() => pgAlertRules.id),
  metric: text('metric').notNull(),
  value: real('value').notNull(),
  threshold: real('threshold').notNull(),
  status: text('status', { enum: ['firing', 'resolved'] }),
  firedAt: text('fired_at').notNull().$defaultFn(() => new Date().toISOString()),
  resolvedAt: text('resolved_at'),
})

export const rateLimitStore = sqliteTable('rate_limit_store', {
  key: text('key').primaryKey(),
  hits: integer('hits').notNull().default(0),
  resetAt: text('reset_at').notNull(),
})
