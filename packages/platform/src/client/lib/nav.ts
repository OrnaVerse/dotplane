import type { AuthUser } from './types'

export interface NavItem {
  id: string
  label: string
  path: string
  roles?: AuthUser['role'][]
  mobile?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', path: '/', mobile: true },
  { id: 'instances', label: 'Instances', path: '/instances', mobile: true },
  { id: 'servers', label: 'Servers', path: '/servers', mobile: true },
  { id: 'releases', label: 'Releases', path: '/releases', mobile: true },
  { id: 'apps', label: 'Apps', path: '/apps' },
  { id: 'sdk', label: 'SDK', path: '/sdk' },
  { id: 'logs', label: 'Logs', path: '/logs' },
  { id: 'postgres', label: 'Postgres', path: '/postgres' },
  { id: 'webhooks', label: 'Webhooks', path: '/webhooks', roles: ['superadmin'] },
  { id: 'api-access', label: 'API Access', path: '/api-access', roles: ['superadmin'] },
  { id: 'audit', label: 'Audit', path: '/audit', roles: ['superadmin'] },
  { id: 'users', label: 'Users', path: '/users', roles: ['superadmin'] },
  { id: 'settings', label: 'Settings', path: '/settings', roles: ['superadmin'] },
]

export const MOBILE_NAV_ITEMS = NAV_ITEMS.filter((item) => item.mobile)
