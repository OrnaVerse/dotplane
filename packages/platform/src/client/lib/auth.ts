import { apiFetch, clearAccessToken, setAccessToken } from './api'
import type { AuthUser } from './types'

const USER_KEY = 'dotplane_user'

export interface LoginResult {
  accessToken?: string
  user?: AuthUser
  mfaRequired?: boolean
  mfaToken?: string
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AuthUser
  } catch {
    return null
  }
}

function storeUser(user: AuthUser): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function isAuthenticated(): boolean {
  return Boolean(localStorage.getItem('dotplane_access_token'))
}

export async function login(username: string, password: string): Promise<LoginResult> {
  const result = await apiFetch<LoginResult>('/auth/login', {
    method: 'POST',
    body: { username, password },
    skipAuth: true,
  })

  if (result.mfaRequired) {
    return result
  }

  if (result.accessToken && result.user) {
    setAccessToken(result.accessToken)
    storeUser(result.user)
  }

  return result
}

export async function verify2fa(
  mfaToken: string,
  code: string,
  useBackup = false,
): Promise<LoginResult> {
  const body = useBackup
    ? { mfaToken, backupCode: code }
    : { mfaToken, totpCode: code }

  const result = await apiFetch<LoginResult>('/auth/2fa/challenge', {
    method: 'POST',
    body,
    skipAuth: true,
  })

  if (result.accessToken && result.user) {
    setAccessToken(result.accessToken)
    storeUser(result.user)
  }

  return result
}

export async function logout(): Promise<void> {
  try {
    await apiFetch('/auth/logout', { method: 'POST' })
  } finally {
    clearAccessToken()
  }
}

export function hasRole(user: AuthUser | null, ...roles: AuthUser['role'][]): boolean {
  if (!user) return false
  return roles.includes(user.role)
}

export function canAccessNav(user: AuthUser | null, roles?: AuthUser['role'][]): boolean {
  if (!roles || roles.length === 0) return true
  return hasRole(user, ...roles)
}
