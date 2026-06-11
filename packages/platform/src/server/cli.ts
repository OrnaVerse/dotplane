import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import argon2 from 'argon2'
import { execa } from 'execa'
import { and, desc, eq } from 'drizzle-orm'
import { DeployService } from './services/deploy.service.js'
import { AgentService, getAgentForInstance } from './services/agent.service.js'
import { createBackup } from './services/backup.service.js'
import { db } from './db/index.js'
import { deployments, instances, servers, settings, userBackupCodes, users } from './db/schema.js'
import { decrypt, encrypt } from './utils/crypto.js'
import { anonymizeIp, safeFetch } from '@dotplane/shared'
import { logger } from './logger.js'

const [, , command, ...args] = process.argv

const ENV_PATH = process.env.DOTPLANE_ENV_PATH ?? '.env'

async function readEnvFile(): Promise<Record<string, string>> {
  try {
    const content = await fs.readFile(ENV_PATH, 'utf8')
    const env: Record<string, string> = {}

    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx === -1) continue
      env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1)
    }

    return env
  } catch {
    return {}
  }
}

async function writeEnvFile(env: Record<string, string>): Promise<void> {
  const lines = Object.entries(env).map(([key, value]) => `${key}=${value}`)
  await fs.writeFile(ENV_PATH, `${lines.join('\n')}\n`)
}

async function updateEnvKey(key: string, value: string): Promise<void> {
  const env = await readEnvFile()
  env[key] = value
  await writeEnvFile(env)
  process.env[key] = value
}

async function getPublicIp(): Promise<string> {
  try {
    const res = await safeFetch(
      'https://api.ipify.org?format=json',
      { signal: AbortSignal.timeout(5000) },
      { allowedHostnames: ['api.ipify.org'], requireAllowlist: true },
    )
    const data = (await res.json()) as { ip: string }
    return data.ip
  } catch {
    return '127.0.0.1'
  }
}

function requireArg(index: number, name: string): string {
  const value = args[index]
  if (!value) {
    console.error(`Missing argument: ${name}`)
    process.exit(1)
  }
  return value
}

const commands: Record<string, () => Promise<void>> = {
  'set-password': async () => {
    const username = requireArg(0, 'username')
    const password = requireArg(1, 'password')
    const hash = await argon2.hash(password, { type: argon2.argon2id })

    const existing = db.select().from(users).where(eq(users.username, username)).get()
    if (existing) {
      db.update(users).set({ passwordHash: hash }).where(eq(users.id, existing.id)).run()
    } else {
      db.insert(users)
        .values({ username, passwordHash: hash, role: 'superadmin' })
        .run()
    }

    console.log(`Credentials updated for user ${username}`)
  },

  'rotate-url-key': async () => {
    const newKey = crypto.randomBytes(4).toString('hex')
    await updateEnvKey('PLATFORM_URL_KEY', newKey)
    console.log(`New URL key: ${newKey}`)
    console.log('Restart Platform for changes to take effect')
  },

  'show-access': async () => {
    const env = await readEnvFile()
    const urlKey = process.env.PLATFORM_URL_KEY ?? env.PLATFORM_URL_KEY ?? ''
    const port = process.env.PLATFORM_PORT ?? env.PLATFORM_PORT ?? '58291'
    const username = process.env.PLATFORM_ADMIN_USERNAME ?? env.PLATFORM_ADMIN_USERNAME ?? 'admin'
    const ip = await getPublicIp()
    console.log(`Panel URL: http://${anonymizeIp(ip)}:${port}/${urlKey}`)
    console.log(`HTTPS URL: https://${anonymizeIp(ip)}/${urlKey} (Caddy, port 443)`)
    console.log(`Port: ${port}`)
    console.log(`URL key: ${urlKey}`)
    console.log(`Username: ${username}`)
    console.log('Password: (see /opt/dotplane/access.txt or set a new one via set-password)')
  },

  backup: async () => {
    const dest = await createBackup()
    console.log(`Backup saved to ${dest}`)
  },

  'install-local-agent': async () => {
    const serverId = 'local'
    const existing = db.select().from(servers).where(eq(servers.id, serverId)).get()

    if (!existing) {
      db.insert(servers)
        .values({
          id: serverId,
          displayName: 'Localhost',
          hostname: '127.0.0.1',
          agentPort: 7823,
          status: 'pending',
        })
        .run()
    }

    console.log(`Registered local server (${serverId})`)
    console.log('Run install-agent.sh on this host with SERVER_ID=local')
  },

  status: async () => {
    const allServers = db.select().from(servers).all()
    const allInstances = db.select().from(instances).all()

    console.log('Servers:')
    for (const server of allServers) {
      console.log(`  ${server.displayName} (${server.id}) — ${server.status}`)
    }

    console.log('\nInstances:')
    for (const instance of allInstances) {
      console.log(
        `  ${instance.displayName} (${instance.id}) — ${instance.healthStatus} — v${instance.currentVersion ?? 'none'}`,
      )
    }
  },

  logs: async () => {
    const instanceId = requireArg(0, 'instanceId')
    const lines = Number.parseInt(args[1] ?? '100', 10)
    const agent = await getAgentForInstance(instanceId)

    await agent.streamLogs(instanceId, lines, (line) => {
      console.log(line)
    })
  },

  restart: async () => {
    const instanceId = requireArg(0, 'instanceId')
    const instance = db.select().from(instances).where(eq(instances.id, instanceId)).get()
    if (!instance) {
      console.error('Instance not found')
      process.exit(1)
    }

    const agent = new AgentService(instance.serverId)
    await agent.stopInstance(instanceId)
    await agent.startInstance(instanceId)
    console.log(`Restarted ${instanceId}`)
  },

  deploy: async () => {
    const instanceId = requireArg(0, 'instanceId')
    const version = requireArg(1, 'version')
    const deploy = new DeployService()

    await deploy.deployInstanceSSE(instanceId, version, 0, (event) => {
      console.log(JSON.stringify(event))
    })
  },

  'env-set': async () => {
    const instanceId = requireArg(0, 'instanceId')
    const key = requireArg(1, 'key')
    const value = requireArg(2, 'value')

    const instance = db.select().from(instances).where(eq(instances.id, instanceId)).get()
    if (!instance) {
      console.error('Instance not found')
      process.exit(1)
    }

    const envVars = { ...instance.envVars, [key]: value }
    db.update(instances).set({ envVars }).where(eq(instances.id, instanceId)).run()

    const agent = new AgentService(instance.serverId)
    await agent.stopInstance(instanceId)
    await agent.createInstance({
      instanceId,
      appPath: instance.appPath,
      uploadsPath: instance.uploadsPath,
      port: instance.port,
      memoryTier: instance.memoryTier,
      envVars,
      runtimeVersion: instance.runtimeVersion,
    })
    await agent.startInstance(instanceId)

    console.log(`Set ${key} on ${instanceId}`)
  },

  rollback: async () => {
    const instanceId = requireArg(0, 'instanceId')
    const instance = db.select().from(instances).where(eq(instances.id, instanceId)).get()
    if (!instance?.currentVersion) {
      console.error('Instance not found or has no current version')
      process.exit(1)
    }

    const previous = db
      .select()
      .from(deployments)
      .where(and(eq(deployments.instanceId, instanceId), eq(deployments.status, 'success')))
      .orderBy(desc(deployments.startedAt))
      .all()

    const target = previous.find((d) => d.version !== instance.currentVersion)
    if (!target) {
      console.error('No rollback target found')
      process.exit(1)
    }

    const deploy = new DeployService()
    await deploy.deployInstanceSSE(instanceId, target.version, 0, (event) => {
      console.log(JSON.stringify(event))
    })
  },

  '2fa-reset': async () => {
    const username = requireArg(0, 'username')
    const user = db.select().from(users).where(eq(users.username, username)).get()
    if (!user) {
      console.error('User not found')
      process.exit(1)
    }

    db.update(users)
      .set({ totpSecretEnc: null, totpEnabled: false })
      .where(eq(users.id, user.id))
      .run()

    db.delete(userBackupCodes).where(eq(userBackupCodes.userId, user.id)).run()
    console.log(`2FA reset for ${username}`)
  },

  'waf-mode': async () => {
    const mode = requireArg(0, 'mode')
    if (!['off', 'detect', 'block'].includes(mode)) {
      console.error('Mode must be off, detect, or block')
      process.exit(1)
    }

    db.insert(settings)
      .values({ key: 'waf_mode', value: mode, isSensitive: false })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: mode, updatedAt: new Date().toISOString() },
      })
      .run()

    console.log(`WAF mode set to ${mode}`)
  },

  'firewall-status': async () => {
    const serverId = args[0] ?? 'local'
    const agent = new AgentService(serverId)
    const status = await agent.getFirewallStatus()
    console.log(JSON.stringify(status, null, 2))
  },

  'fail2ban-status': async () => {
    const serverId = args[0] ?? 'local'
    const agent = new AgentService(serverId)
    const status = await agent.getFail2banStatus()
    console.log(JSON.stringify(status, null, 2))
  },

  'fail2ban-unban': async () => {
    const jail = requireArg(0, 'jail')
    const ip = requireArg(1, 'ip')
    const serverId = args[2] ?? 'local'
    const agent = new AgentService(serverId)
    await agent.unbanIp(jail, ip)
    console.log(`Unbanned ${anonymizeIp(ip)} from ${jail}`)
  },

  update: async () => {
    const installRoot = process.env.DOTPLANE_INSTALL_ROOT ?? '/opt/dotplane'
    console.log(`Updating Dotplane in ${installRoot}...`)
    await execa('npm', ['run', 'build'], { cwd: path.join(installRoot, 'packages/platform'), stdio: 'inherit' })
    await execa('systemctl', ['restart', 'dotplane-platform'], { stdio: 'inherit' })
    console.log('Update complete')
  },

  'rotate-jwt-secret': async () => {
    const newSecret = crypto.randomBytes(64).toString('hex')
    await updateEnvKey('JWT_SECRET', newSecret)
    console.log('JWT secret rotated — all sessions invalidated on restart')
  },

  'rotate-encryption-key': async () => {
    const newKey = crypto.randomBytes(32).toString('hex')
    const rows = db.select().from(settings).where(eq(settings.isSensitive, true)).all()
    const reencrypted: Array<{ key: string; value: string }> = []

    for (const row of rows) {
      try {
        const plaintext = decrypt(row.value)
        reencrypted.push({ key: row.key, value: plaintext })
      } catch {
        logger.warn({ key: row.key }, 'Skipped setting during encryption key rotation')
      }
    }

    await updateEnvKey('ENCRYPTION_KEY', newKey)

    for (const item of reencrypted) {
      db.update(settings)
        .set({ value: encrypt(item.value) })
        .where(eq(settings.key, item.key))
        .run()
    }
    console.log('Encryption key rotated and sensitive settings re-encrypted')
  },
}

async function main(): Promise<void> {
  if (!command || !commands[command]) {
    console.error(`Unknown command: ${command ?? '(none)'}`)
    console.error('Available:', Object.keys(commands).sort().join(', '))
    process.exit(1)
  }

  await commands[command]()
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(msg)
  process.exit(1)
})
