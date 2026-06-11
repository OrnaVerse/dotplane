import { Router } from 'express'
import { requireEnv } from '../config.js'

const router = Router()

router.get('/', (_req, res) => {
  const urlKey = requireEnv('PLATFORM_URL_KEY')

  res.json({
    openapi: '3.0.3',
    info: {
      title: 'Dotplane Platform API',
      version: '0.1.0',
      description: 'Self-hosted .NET hosting platform API',
    },
    servers: [{ url: `/${urlKey}/api` }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
        deployToken: {
          type: 'http',
          scheme: 'bearer',
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      '/auth/login': { post: { summary: 'Login', security: [] } },
      '/auth/refresh': { post: { summary: 'Refresh access token', security: [] } },
      '/auth/logout': { post: { summary: 'Logout', security: [] } },
      '/servers': { get: { summary: 'List servers' }, post: { summary: 'Create server' } },
      '/servers/health': { get: { summary: 'Aggregated server health' } },
      '/servers/{id}': {
        get: { summary: 'Get server' },
        patch: { summary: 'Update server' },
        delete: { summary: 'Delete server' },
      },
      '/servers/{id}/agent-install-token': { post: { summary: 'Generate agent install token' } },
      '/servers/{id}/rotate-cert': { post: { summary: 'Rotate agent certificate' } },
      '/apps': { get: { summary: 'List apps' }, post: { summary: 'Create app' } },
      '/apps/{id}': {
        get: { summary: 'Get app' },
        patch: { summary: 'Update app' },
        delete: { summary: 'Delete app' },
      },
      '/releases': { get: { summary: 'List releases' } },
      '/releases/sync': { post: { summary: 'Sync releases from VCS' } },
      '/releases/upload': { post: { summary: 'Upload release artifact' } },
      '/releases/{appId}/{version}/download': { post: { summary: 'Download/cache artifact' } },
      '/artifacts/{appId}/{version}': { get: { summary: 'Serve cached artifact', security: [] } },
      '/instances': { get: { summary: 'List instances' }, post: { summary: 'Create instance' } },
      '/instances/{id}': { get: { summary: 'Get instance' }, delete: { summary: 'Delete instance' } },
      '/instances/{id}/deploy': { post: { summary: 'Deploy instance (SSE)' } },
      '/instances/deploy-all': { post: { summary: 'Rolling deploy (SSE)' } },
      '/instances/{id}/rollback': { post: { summary: 'Rollback instance (SSE)' } },
      '/instances/{id}/env': { patch: { summary: 'Update env vars (SSE)' } },
      '/instances/{id}/logs': { get: { summary: 'Stream logs (SSE)' } },
      '/instances/{id}/metrics': { get: { summary: 'Metrics history' } },
      '/instances/{id}/deployments': { get: { summary: 'Deployment history' } },
      '/sdk/runtimes': { get: { summary: 'Runtime matrix' } },
      '/sdk/install': { post: { summary: 'Install runtime (SSE)' } },
      '/users': { get: { summary: 'List users' }, post: { summary: 'Create user' } },
      '/users/invites': { post: { summary: 'Create invite' } },
      '/users/invites/accept': { post: { summary: 'Accept invite', security: [] } },
      '/audit': { get: { summary: 'Paginated audit log' } },
      '/settings': { get: { summary: 'List settings' }, put: { summary: 'Bulk update settings' } },
      '/provision': {
        post: { summary: 'Create provision job', security: [{ deployToken: [] }] },
      },
      '/provision/{id}': {
        get: { summary: 'Poll provision job', security: [{ deployToken: [] }] },
        delete: { summary: 'Delete provision job', security: [{ deployToken: [] }] },
      },
      '/webhooks': { get: { summary: 'List webhooks' }, post: { summary: 'Create webhook' } },
      '/webhooks/{id}/test': { post: { summary: 'Test fire webhook' } },
      '/pg': { get: { summary: 'List PostgreSQL servers' }, post: { summary: 'Create PG server' } },
      '/pg/{id}/metrics': { get: { summary: 'Latest PG metrics' } },
      '/pg/{id}/alerts': { get: { summary: 'PG alerts' } },
      '/pg/{id}/alert-rules': { get: { summary: 'List alert rules' }, post: { summary: 'Create alert rule' } },
    },
  })
})

export default router
