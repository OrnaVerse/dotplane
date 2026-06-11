import { readFileSync } from 'fs'
import { basename } from 'path'
import { FormData, fetch } from 'undici'
import type { DotplaneConfig } from './config.js'
import { apiBase } from './config.js'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function apiRequest<T = unknown>(
  config: DotplaneConfig,
  method: string,
  path: string,
  body?: unknown,
  options: { token?: string; deployToken?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  }

  const token = options.deployToken ?? options.token ?? config.token
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  let payload: string | undefined
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }

  const res = await fetch(`${apiBase(config)}${path}`, {
    method,
    headers,
    body: payload,
  })

  const text = await res.text()
  let parsed: unknown = text
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
  }

  if (!res.ok) {
    const message =
      typeof parsed === 'object' && parsed !== null && 'error' in parsed
        ? String((parsed as { error: unknown }).error)
        : `HTTP ${res.status}`
    throw new ApiError(message, res.status, parsed)
  }

  return parsed as T
}

export async function apiStream(
  config: DotplaneConfig,
  path: string,
  body: unknown,
  onEvent: (event: unknown) => void,
): Promise<void> {
  const res = await fetch(`${apiBase(config)}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok || !res.body) {
    const text = await res.text()
    throw new ApiError(text || `HTTP ${res.status}`, res.status)
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
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          try {
            onEvent(JSON.parse(data))
          } catch {
            onEvent({ raw: data })
          }
        }
      }
    }
  }
}

export async function uploadRelease(
  config: DotplaneConfig,
  appId: string,
  version: string,
  filePath: string,
  notes?: string,
): Promise<unknown> {
  const form = new FormData()
  form.append('appId', appId)
  form.append('version', version)
  if (notes) form.append('releaseNotes', notes)

  const fileBuffer = readFileSync(filePath)
  const blob = new Blob([fileBuffer], { type: 'application/zip' })
  form.append('artifact', blob, basename(filePath))

  const res = await fetch(`${apiBase(config)}/releases/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
    },
    body: form,
  })

  const text = await res.text()
  let parsed: unknown = text
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
  }

  if (!res.ok) {
    throw new ApiError(`Upload failed: HTTP ${res.status}`, res.status, parsed)
  }

  return parsed
}

export async function login(
  url: string,
  urlKey: string,
  username: string,
  password: string,
): Promise<{ accessToken: string; user: { username: string; role: string } }> {
  const res = await fetch(`${url.replace(/\/$/, '')}/${urlKey}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })

  const body = (await res.json()) as { accessToken?: string; user?: { username: string; role: string }; error?: string }
  if (!res.ok || !body.accessToken) {
    throw new ApiError(body.error ?? 'Login failed', res.status, body)
  }

  return { accessToken: body.accessToken, user: body.user! }
}
