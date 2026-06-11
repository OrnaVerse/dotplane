#!/usr/bin/env node

import { Command } from 'commander'
import inquirer from 'inquirer'
import ora from 'ora'
import chalk from 'chalk'
import { fetch } from 'undici'
import { apiRequest, apiStream, login, uploadRelease, ApiError } from './client.js'
import { loadConfig, requireConfig, saveConfig } from './config.js'

const program = new Command()

program
  .name('dotplane-remote')
  .description('Dotplane remote CLI — deploy and manage instances from CI or your terminal')
  .version('0.1.0')

program
  .command('login')
  .description('Authenticate and save credentials to ~/.dotplane/config.json')
  .option('--url <url>', 'Platform base URL (e.g. https://platform.example.com)')
  .option('--url-key <key>', 'URL key (e.g. ov_k9x2mq)')
  .option('--username <user>', 'Username')
  .option('--password <pass>', 'Password (prefer interactive prompt)')
  .action(async (opts: { url?: string; urlKey?: string; username?: string; password?: string }) => {
    const existing = loadConfig()
    const answers = await inquirer.prompt<{ url: string; urlKey: string; username: string; password: string }>([
      {
        type: 'input',
        name: 'url',
        message: 'Platform URL',
        default: opts.url ?? existing?.url,
        when: !opts.url,
      },
      {
        type: 'input',
        name: 'urlKey',
        message: 'URL key',
        default: opts.urlKey ?? existing?.urlKey,
        when: !opts.urlKey,
      },
      {
        type: 'input',
        name: 'username',
        message: 'Username',
        default: opts.username ?? existing?.username ?? 'admin',
        when: !opts.username,
      },
      {
        type: 'password',
        name: 'password',
        message: 'Password',
        when: !opts.password,
      },
    ])

    const url = opts.url ?? answers.url
    const urlKey = opts.urlKey ?? answers.urlKey
    const username = opts.username ?? answers.username
    const password = opts.password ?? answers.password

    const spinner = ora('Signing in…').start()
    try {
      const result = await login(url, urlKey, username, password)
      saveConfig({ url, urlKey, username, token: result.accessToken })
      spinner.succeed(`Logged in as ${result.user.username} (${result.user.role})`)
    } catch (err) {
      spinner.fail(err instanceof ApiError ? err.message : 'Login failed')
      process.exit(1)
    }
  })

const instances = program.command('instances').description('Manage instances')

instances
  .command('list')
  .description('List all instances')
  .option('--json', 'Output raw JSON')
  .action(async (opts: { json?: boolean }) => {
    const config = requireConfig()
    const data = await apiRequest<unknown[]>(config, 'GET', '/instances')
    if (opts.json) {
      console.log(JSON.stringify(data, null, 2))
      return
    }
    if (!Array.isArray(data) || data.length === 0) {
      console.log(chalk.dim('No instances found.'))
      return
    }
    for (const row of data as Array<Record<string, unknown>>) {
      const status = String(row.healthStatus ?? row.health_status ?? 'unknown')
      const color =
        status === 'healthy' ? chalk.green : status === 'down' ? chalk.red : chalk.yellow
      console.log(
        `${color('●')} ${row.displayName ?? row.display_name} ${chalk.dim(`(${row.id})`)}`,
        `→ ${row.domain}`,
        `[${row.currentVersion ?? row.current_version ?? '—'}]`,
        color(status),
      )
    }
  })

program
  .command('deploy <instanceId>')
  .description('Deploy a release version to one instance')
  .requiredOption('-v, --version <version>', 'Release version (e.g. v1.4.3)')
  .action(async (instanceId: string, opts: { version: string }) => {
    const config = requireConfig()
    const spinner = ora(`Deploying ${opts.version} to ${instanceId}…`).start()
    try {
      await apiStream(config, `/instances/${instanceId}/deploy`, { version: opts.version }, (event) => {
        if (typeof event === 'object' && event !== null && 'type' in event) {
          const e = event as { type: string; step?: string; status?: string; success?: boolean }
          if (e.type === 'step') {
            spinner.text = `${e.step}: ${e.status}`
          }
          if (e.type === 'done') {
            if (e.success) spinner.succeed(`Deploy complete: ${instanceId} → ${opts.version}`)
            else spinner.fail(`Deploy failed: ${instanceId}`)
          }
        }
      })
    } catch (err) {
      spinner.fail(err instanceof ApiError ? err.message : 'Deploy failed')
      process.exit(1)
    }
  })

program
  .command('deploy-all')
  .description('Rolling deploy to all instances of an app')
  .requiredOption('-a, --app <appId>', 'App ID')
  .requiredOption('-v, --version <version>', 'Release version')
  .option('-b, --batch-size <n>', 'Instances per batch', '3')
  .option('-d, --delay <seconds>', 'Delay between batches', '30')
  .option('-i, --instances <ids>', 'Comma-separated instance IDs (default: all)')
  .action(async (opts: { app: string; version: string; batchSize: string; delay: string; instances?: string }) => {
    const config = requireConfig()
    const body = {
      appId: opts.app,
      version: opts.version,
      batchSize: parseInt(opts.batchSize, 10),
      delaySeconds: parseInt(opts.delay, 10),
      instanceIds: opts.instances ? opts.instances.split(',').map((s) => s.trim()) : undefined,
    }

    console.log(chalk.blue(`Deploy-all ${opts.app} → ${opts.version}`))
    try {
      await apiStream(config, '/instances/deploy-all', body, (event) => {
        console.log(JSON.stringify(event))
      })
    } catch (err) {
      console.error(chalk.red(err instanceof ApiError ? err.message : 'Deploy-all failed'))
      process.exit(1)
    }
  })

program
  .command('rollback <instanceId>')
  .description('Rollback instance to previous successful deployment')
  .option('-v, --version <version>', 'Target version (default: previous deployment)')
  .action(async (instanceId: string, opts: { version?: string }) => {
    const config = requireConfig()
    const spinner = ora(`Rolling back ${instanceId}…`).start()
    try {
      const result = await apiRequest<{ version: string }>(config, 'POST', `/instances/${instanceId}/rollback`, {
        version: opts.version,
      })
      spinner.succeed(`Rolled back ${instanceId} → ${result.version}`)
    } catch (err) {
      spinner.fail(err instanceof ApiError ? err.message : 'Rollback failed')
      process.exit(1)
    }
  })

program
  .command('provision')
  .description('Provision a new instance')
  .requiredOption('-i, --id <id>', 'Instance ID (slug)')
  .requiredOption('-n, --name <name>', 'Display name')
  .requiredOption('-a, --app <appId>', 'App ID')
  .requiredOption('-d, --domain <domain>', 'Domain name')
  .option('-s, --server <serverId>', 'Target server ID (default: auto-select)')
  .option('-t, --tier <tier>', 'Memory tier', 'standard')
  .option('-v, --version <version>', 'Initial version to deploy')
  .option('--env <pair>', 'Environment variable KEY=VALUE (repeatable)', collect, [])
  .action(async (opts: {
    id: string
    name: string
    app: string
    domain: string
    server?: string
    tier: string
    version?: string
    env: string[]
  }) => {
    const config = requireConfig()
    const envVars: Record<string, string> = {}
    for (const pair of opts.env) {
      const eq = pair.indexOf('=')
      if (eq > 0) envVars[pair.slice(0, eq)] = pair.slice(eq + 1)
    }

    const body = {
      id: opts.id,
      displayName: opts.name,
      appId: opts.app,
      serverId: opts.server,
      domain: opts.domain,
      memoryTier: opts.tier,
      envVars,
      initialVersion: opts.version,
    }

    const spinner = ora(`Provisioning ${opts.id}…`).start()
    try {
      const result = await apiRequest<{ id: string; port: number; domain: string }>(
        config,
        'POST',
        '/instances',
        body,
      )
      spinner.succeed(`Provisioned ${result.id} on port ${result.port} (${result.domain})`)
    } catch (err) {
      spinner.fail(err instanceof ApiError ? err.message : 'Provision failed')
      process.exit(1)
    }
  })

program
  .command('deprovision <instanceId>')
  .description('Remove an instance')
  .option('--delete-data', 'Delete instance data directories on the server')
  .action(async (instanceId: string, opts: { deleteData?: boolean }) => {
    const config = requireConfig()
    const spinner = ora(`Deprovisioning ${instanceId}…`).start()
    try {
      await apiRequest(config, 'DELETE', `/instances/${instanceId}`, { deleteData: !!opts.deleteData })
      spinner.succeed(`Deprovisioned ${instanceId}`)
    } catch (err) {
      spinner.fail(err instanceof ApiError ? err.message : 'Deprovision failed')
      process.exit(1)
    }
  })

program
  .command('status [instanceId]')
  .description('Show instance status (one instance or all)')
  .option('--json', 'Output raw JSON')
  .action(async (instanceId: string | undefined, opts: { json?: boolean }) => {
    const config = requireConfig()
    if (instanceId) {
      const data = await apiRequest<Record<string, unknown>>(config, 'GET', `/instances/${instanceId}`)
      if (opts.json) {
        console.log(JSON.stringify(data, null, 2))
      } else {
        printStatus(instanceId, data)
      }
      return
    }

    const list = await apiRequest<Array<Record<string, unknown>>>(config, 'GET', '/instances')
    if (opts.json) {
      console.log(JSON.stringify(list, null, 2))
      return
    }
    for (const row of list) {
      printStatus(String(row.id), row)
    }
  })

program
  .command('logs <instanceId>')
  .description('Stream recent logs for an instance')
  .option('-n, --lines <n>', 'Number of log lines', '100')
  .action(async (instanceId: string, opts: { lines: string }) => {
    const config = requireConfig()
    const res = await fetch(
      `${config.url.replace(/\/$/, '')}/${config.urlKey}/api/instances/${instanceId}/logs?lines=${opts.lines}`,
      {
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: 'text/event-stream',
        },
      },
    )

    if (!res.ok || !res.body) {
      console.error(chalk.red(`Failed to fetch logs: HTTP ${res.status}`))
      process.exit(1)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? ''
      for (const part of parts) {
        for (const line of part.split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const parsed = JSON.parse(line.slice(6)) as { line?: string }
            if (parsed.line) {
              try {
                const entry = JSON.parse(parsed.line) as Record<string, unknown>
                console.log(
                  [entry.__REALTIME_TIMESTAMP ?? entry.timestamp, entry.PRIORITY ?? entry.level, entry.MESSAGE ?? entry.message]
                    .filter(Boolean)
                    .join(' '),
                )
              } catch {
                console.log(parsed.line)
              }
            }
          } catch {
            console.log(line.slice(6))
          }
        }
      }
    }
  })

const releases = program.command('releases').description('Manage releases')

releases
  .command('list')
  .description('List releases for an app')
  .requiredOption('-a, --app <appId>', 'App ID')
  .option('--json', 'Output raw JSON')
  .action(async (opts: { app: string; json?: boolean }) => {
    const config = requireConfig()
    const data = await apiRequest<unknown[]>(config, 'GET', `/releases?appId=${encodeURIComponent(opts.app)}`)
    if (opts.json) {
      console.log(JSON.stringify(data, null, 2))
      return
    }
    for (const row of data as Array<Record<string, unknown>>) {
      const cached = row.cachedPath ?? row.cached_path ? chalk.green('cached') : chalk.dim('not cached')
      console.log(`${row.version}  ${cached}  ${row.releaseNotes ?? row.release_notes ?? ''}`)
    }
  })

releases
  .command('upload')
  .description('Upload a release artifact (.zip)')
  .requiredOption('-a, --app <appId>', 'App ID')
  .requiredOption('-v, --version <version>', 'Release version tag')
  .requiredOption('-f, --file <path>', 'Path to app.zip')
  .option('--notes <text>', 'Release notes')
  .action(async (opts: { app: string; version: string; file: string; notes?: string }) => {
    const config = requireConfig()
    const spinner = ora(`Uploading ${opts.file}…`).start()
    try {
      await uploadRelease(config, opts.app, opts.version, opts.file, opts.notes)
      spinner.succeed(`Uploaded ${opts.version} for ${opts.app}`)
    } catch (err) {
      spinner.fail(err instanceof ApiError ? err.message : 'Upload failed')
      process.exit(1)
    }
  })

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value])
}

function printStatus(id: string, row: Record<string, unknown>): void {
  const status = String(row.healthStatus ?? row.health_status ?? 'unknown')
  const version = row.currentVersion ?? row.current_version ?? '—'
  const domain = row.domain ?? '—'
  const color = status === 'healthy' ? chalk.green : status === 'down' ? chalk.red : chalk.yellow
  console.log(`${id.padEnd(24)} ${color(status.padEnd(10))} ${String(version).padEnd(12)} ${domain}`)
}

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(chalk.red(err instanceof Error ? err.message : String(err)))
  process.exit(1)
})
