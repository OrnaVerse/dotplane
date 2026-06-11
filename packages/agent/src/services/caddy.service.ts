import { agentConfig } from '../config.js'

const CONFIG_SAVE_PATH = '/etc/caddy/dotplane-routes.json'

function adminHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (agentConfig.caddyAdminToken) {
    headers.Authorization = `Bearer ${agentConfig.caddyAdminToken}`
  }
  return headers
}

export async function addRoute(domain: string, port: number, instanceId: string): Promise<void> {
  const route = {
    '@id': `dotplane-${instanceId}`,
    match: [{ host: [domain] }],
    handle: [
      {
        handler: 'subroute',
        routes: [{
          match: [{ path: ['/uploads/*'] }],
          handle: [{
            handler: 'file_server',
            root: `/var/dotplane/instances/${instanceId}/uploads`,
            strip_prefix: '/uploads',
          }],
        }],
      },
      {
        handler: 'reverse_proxy',
        upstreams: [{ dial: `localhost:${port}` }],
        health_checks: {
          active: {
            path: '/health',
            interval: '30s',
            timeout: '5s',
          },
        },
        headers: {
          request: {
            set: {
              'X-Forwarded-Proto': ['{http.request.scheme}'],
              'X-Forwarded-For': ['{http.request.remote.host}'],
            },
          },
        },
      },
    ],
    terminal: true,
  }

  await caddyApiCall('POST', '/config/apps/http/servers/main/routes', route)
  await persistConfig()
}

export async function removeRoute(instanceId: string): Promise<void> {
  await caddyApiCall('DELETE', `/id/dotplane-${instanceId}`)
  await persistConfig()
}

export async function getRoutes(): Promise<unknown[]> {
  const routes = await caddyApiCall('GET', '/config/apps/http/servers/main/routes')
  return Array.isArray(routes) ? routes : []
}

async function caddyApiCall(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${agentConfig.caddyAdmin}${path}`, {
    method,
    headers: adminHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Caddy API error ${res.status}: ${text}`)
  }
  if (res.status === 204) return null
  return res.json()
}

async function persistConfig(): Promise<void> {
  const config = await caddyApiCall('GET', '/config/')
  const { writeFile } = await import('fs/promises')
  await writeFile(CONFIG_SAVE_PATH, JSON.stringify(config, null, 2), 'utf8')
}
