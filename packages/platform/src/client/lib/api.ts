import type { ApiErrorBody } from './types'

const TOKEN_KEY = 'dotplane_access_token'
const USER_KEY = 'dotplane_user'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: ApiErrorBody,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function readUrlKeyFromLocation(): string {
  const segment = window.location.pathname.split('/').filter(Boolean)[0]
  return segment ?? import.meta.env.VITE_PLATFORM_URL_KEY ?? 'dev'
}

let cachedUrlKey: string | null = null

export function getUrlKey(): string {
  if (cachedUrlKey) return cachedUrlKey
  cachedUrlKey = import.meta.env.VITE_PLATFORM_URL_KEY || readUrlKeyFromLocation()
  return cachedUrlKey
}

export function getBasePath(): string {
  return `/${getUrlKey()}`
}

export function apiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${getBasePath()}/api${normalized}`
}

function getAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setAccessToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearAccessToken(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

export async function refreshAccessToken(): Promise<string | null> {
  try {
    const res = await fetch(apiUrl('/auth/refresh'), {
      method: 'POST',
      credentials: 'include',
    })

    if (!res.ok) {
      clearAccessToken()
      return null
    }

    const data = (await res.json()) as { accessToken: string }
    setAccessToken(data.accessToken)
    return data.accessToken
  } catch {
    clearAccessToken()
    return null
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let body: ApiErrorBody | undefined
  try {
    body = (await res.json()) as ApiErrorBody
  } catch {
    body = undefined
  }

  const message =
    typeof body?.error === 'string'
      ? body.error
      : `Request failed (${res.status})`

  return new ApiError(message, res.status, body)
}

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  skipAuth?: boolean
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { body, skipAuth, headers, ...rest } = options

  const requestHeaders = new Headers(headers)
  if (body !== undefined && !requestHeaders.has('Content-Type')) {
    requestHeaders.set('Content-Type', 'application/json')
  }

  if (!skipAuth) {
    const token = getAccessToken()
    if (token) {
      requestHeaders.set('Authorization', `Bearer ${token}`)
    }
  }

  let res = await fetch(apiUrl(path), {
    ...rest,
    headers: requestHeaders,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (res.status === 401 && !skipAuth) {
    const refreshed = await refreshAccessToken()
    if (refreshed) {
      requestHeaders.set('Authorization', `Bearer ${refreshed}`)
      res = await fetch(apiUrl(path), {
        ...rest,
        headers: requestHeaders,
        credentials: 'include',
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
    }
  }

  if (!res.ok) {
    throw await parseError(res)
  }

  if (res.status === 204) {
    return undefined as T
  }

  const contentType = res.headers.get('Content-Type') ?? ''
  if (contentType.includes('application/json')) {
    return (await res.json()) as T
  }

  return (await res.text()) as T
}

export function getSseUrl(path: string): string {
  return apiUrl(path)
}

export async function apiPostSse(
  path: string,
  body: unknown,
  onEvent: (data: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = getAccessToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(body),
    signal,
  })

  if (!res.ok) {
    throw await parseError(res)
  }

  if (!res.body) {
    throw new ApiError('No response body for SSE stream', res.status)
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
      const line = part
        .split('\n')
        .find((l) => l.startsWith('data: '))
      if (!line) continue
      try {
        onEvent(JSON.parse(line.slice(6)))
      } catch {
        // ignore malformed events
      }
    }
  }
}
