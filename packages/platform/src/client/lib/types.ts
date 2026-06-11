export type UserRole = 'superadmin' | 'manager' | 'viewer'

export interface AuthUser {
  username: string
  role: UserRole
}

export interface ServerRecord {
  id: string
  displayName: string
  hostname: string
  agentPort: number
  status: 'pending' | 'online' | 'offline' | 'degraded'
  lastSeen: string | null
  totalMemory: number | null
  totalCpu: number | null
  diskTotal: number | null
  diskUsed: number | null
  instanceCount?: number
  memoryUsedBytes?: number
  cpuPercent?: number
}

export interface ServerHealthSummary {
  totalMemoryBytes: number
  usedMemoryBytes: number
  cpuPercent: number
  healthy: number
  warning: number
  down: number
  servers: ServerRecord[]
}

export interface AppRecord {
  id: string
  displayName: string
  description: string | null
  sourceType: 'vcs' | 'upload'
  vcsProvider: 'github' | 'gitlab' | 'azure' | 'bitbucket' | null
  vcsNamespace: string | null
  vcsRepo: string | null
  artifactName: string
  targetFramework: string
  runtime: 'dotnet' | 'node'
  instanceCount?: number
}

export interface InstanceRecord {
  id: string
  displayName: string
  appId: string
  serverId: string
  domain: string
  port: number
  memoryTier: 'minimal' | 'standard' | 'professional' | 'enterprise'
  envVars: Record<string, string>
  currentVersion: string | null
  healthStatus: 'healthy' | 'degraded' | 'down' | 'unknown'
  lastDeployed: string | null
  serverName?: string
  appName?: string
  memoryBytes?: number
  memoryMax?: number
  cpuPercent?: number
  restartCount?: number
}

export interface ReleaseRecord {
  id: number
  appId: string
  version: string
  githubTag: string
  artifactSize: number | null
  cachedPath: string | null
  cachedAt: string | null
  releaseNotes: string | null
  publishedAt: string
  isCached?: boolean
}

export interface DownloadProgress {
  version: string
  status: 'idle' | 'downloading' | 'done' | 'error'
  bytesDownloaded: number
  totalBytes: number
  percent: number
}

export interface SdkMatrixCell {
  serverId: string
  sdkVersion: string
  installed: boolean
  runtimeVersion?: string
}

export interface SdkMatrix {
  servers: Array<{ id: string; displayName: string }>
  versions: string[]
  cells: SdkMatrixCell[]
}

export interface UserRecord {
  id: number
  username: string
  role: UserRole
  isActive: boolean
  lastLogin: string | null
  instanceCount?: number
}

export interface UserSession {
  sessionId: string
  ip: string | null
  userAgent: string | null
  createdAt: string
  expiresAt: string
}

export interface AuditEntry {
  id: number
  action: string
  actorId: number | null
  actorUsername: string | null
  targetType: string | null
  targetId: string | null
  detail: Record<string, unknown> | null
  ip: string | null
  createdAt: string
  success?: boolean
}

export interface SettingRecord {
  key: string
  value: string
  isSensitive: boolean
}

export interface DeployTokenRecord {
  id: number
  name: string
  appId: string | null
  isActive: boolean
  lastUsed: string | null
  createdAt: string
  token?: string
}

export interface WebhookRecord {
  id: number
  name: string
  url: string
  events: string[]
  isActive: boolean
  lastCalledAt: string | null
  lastStatus: number | null
  createdAt: string
}

export interface PgServerRecord {
  id: string
  serverId: string
  displayName: string
  pgHost: string
  pgPort: number
  pgDatabase: string
  status: 'online' | 'offline' | 'unknown'
  lastChecked: string | null
  serverName?: string
}

export interface PgMetrics {
  connectionsTotal: number | null
  connectionsActive: number | null
  connectionsIdle: number | null
  dbSizeBytes: number | null
  cacheHitRatio: number | null
  tpsCommit: number | null
  collectedAt: string
}

export type DeployStepStatus = 'running' | 'done' | 'error' | 'waiting'

export interface DeployStep {
  step: string
  status: DeployStepStatus
  message?: string
}

export interface DeployEvent {
  type: 'step' | 'health' | 'done' | 'batch_start' | 'aborted' | 'complete'
  step?: string
  status?: DeployStepStatus | 'healthy' | 'degraded' | 'down'
  message?: string
  success?: boolean
  deploymentId?: number
  instanceId?: string
  reason?: string
  results?: Record<string, boolean>
}

export interface ApiErrorBody {
  error: string | Record<string, unknown>
}
