/** Link-local IPv4 used by AWS, GCP, Azure, and Oracle metadata services. */
const CLOUD_METADATA_IPV4 = '169.254.169.254'

const BLOCKED_HOSTNAMES = new Set(['localhost', '0.0.0.0', '[::]', '::1'])

export interface ValidateUrlOptions {
  /** Exact hostnames or wildcard suffixes (e.g. "*.githubusercontent.com"). */
  allowedHostnames?: string[]
  allowHttp?: boolean
  /** Permit loopback/private addresses — never applies to cloud metadata endpoints. */
  allowPrivateHosts?: boolean
  requireHttps?: boolean
  /** Reject URLs when no hostname allowlist is provided. */
  requireAllowlist?: boolean
}

function isPrivateIPv4(host: string): boolean {
  const parts = host.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return false
  }

  const a = parts[0]!
  const b = parts[1]!
  if (a === 10 || a === 127 || a === 0) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a >= 224) return true
  return false
}

function isPrivateIPv6(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (normalized === '::1' || normalized === '::') return true
  if (normalized.startsWith('fe80:')) return true
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true
  return false
}

/** Cloud provider instance metadata endpoints — always blocked, even with allowPrivateHosts. */
export function isCloudMetadataHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')

  if (host === CLOUD_METADATA_IPV4) return true

  // GCP, partial Azure, and other metadata.* hostnames
  if (host === 'metadata' || host.startsWith('metadata.')) return true

  // Oracle Cloud
  if (host === 'instance-data' || host.endsWith('.instance-data')) return true

  return false
}

export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')

  if (isCloudMetadataHost(host)) return true
  if (BLOCKED_HOSTNAMES.has(host)) return true
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    return true
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return isPrivateIPv4(host)
  }

  if (host.includes(':')) {
    return isPrivateIPv6(host)
  }

  return false
}

function hostnameMatchesAllowlist(hostname: string, allowed: string[]): boolean {
  const host = hostname.toLowerCase()

  return allowed.some((pattern) => {
    const normalized = pattern.toLowerCase()
    if (normalized.startsWith('*.')) {
      const suffix = normalized.slice(1)
      const bare = normalized.slice(2)
      return host.endsWith(suffix) || host === bare
    }
    return host === normalized
  })
}

function assertNoCredentials(url: URL): void {
  if (url.username || url.password) {
    throw new Error('URL credentials are not allowed')
  }
}

export function validateUrl(input: string, options: ValidateUrlOptions = {}): URL {
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    throw new Error('Invalid URL')
  }

  assertNoCredentials(parsed)

  const requireHttps = options.requireHttps ?? !options.allowHttp

  if (parsed.protocol !== 'https:' && !(options.allowHttp && parsed.protocol === 'http:')) {
    throw new Error(`URL protocol not allowed: ${parsed.protocol}`)
  }

  if (requireHttps && parsed.protocol !== 'https:') {
    throw new Error('HTTPS is required for outbound requests')
  }

  if (isCloudMetadataHost(parsed.hostname)) {
    throw new Error(`Cloud metadata endpoints are not allowed: ${parsed.hostname}`)
  }

  if (!options.allowPrivateHosts && isPrivateHost(parsed.hostname)) {
    throw new Error(`URL hostname not allowed: ${parsed.hostname}`)
  }

  if (options.requireAllowlist && (!options.allowedHostnames || options.allowedHostnames.length === 0)) {
    throw new Error('URL hostname allowlist is required')
  }

  if (options.allowedHostnames?.length) {
    if (!hostnameMatchesAllowlist(parsed.hostname, options.allowedHostnames)) {
      throw new Error(`URL hostname not in allowlist: ${parsed.hostname}`)
    }
  }

  return parsed
}

const MAX_REDIRECTS = 5

export async function safeFetch(
  input: string,
  init?: RequestInit,
  options: ValidateUrlOptions = {},
): Promise<Response> {
  let current = validateUrl(input, options).toString()

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(current, {
      ...init,
      redirect: 'manual',
    })

    if (response.status < 300 || response.status >= 400) {
      return response
    }

    const location = response.headers.get('location')
    if (!location) {
      throw new Error('Redirect response missing Location header')
    }

    if (hop === MAX_REDIRECTS) {
      throw new Error('Too many redirects')
    }

    current = validateUrl(new URL(location, current).toString(), options).toString()
  }

  throw new Error('Redirect loop detected')
}

export const VCS_ALLOWED_HOSTS: Record<string, string[]> = {
  github: [
    'api.github.com',
    'github.com',
    'objects.githubusercontent.com',
    '*.githubusercontent.com',
  ],
  gitlab: ['gitlab.com', '*.gitlab.io'],
  azure: [
    'dev.azure.com',
    '*.dev.azure.com',
    '*.blob.core.windows.net',
    'vsblob.visualstudio.com',
  ],
  bitbucket: ['api.bitbucket.org', 'bitbucket.org', '*.bitbucket.io'],
}

export function vcsAllowedHosts(provider: string, customBaseUrl?: string): string[] {
  const hosts = [...(VCS_ALLOWED_HOSTS[provider] ?? [])]

  if (customBaseUrl) {
    try {
      hosts.push(new URL(customBaseUrl).hostname)
    } catch {
      // ignore invalid custom base URL
    }
  }

  return hosts
}

export function platformAllowsPrivateFetch(platformUrl?: string): boolean {
  if (!platformUrl) return false

  try {
    const host = new URL(platformUrl).hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || isPrivateHost(host)
  } catch {
    return false
  }
}

export function platformArtifactHosts(platformUrl?: string): string[] {
  const hosts: string[] = []

  if (platformUrl) {
    try {
      hosts.push(new URL(platformUrl).hostname)
    } catch {
      // ignore
    }
  }

  return hosts
}

export function artifactDownloadHosts(platformUrl?: string): string[] {
  return [
    ...platformArtifactHosts(platformUrl),
    ...Object.values(VCS_ALLOWED_HOSTS).flat(),
  ]
}

export function webhookUrlOptions(): ValidateUrlOptions {
  return {
    requireHttps: true,
    allowPrivateHosts: false,
  }
}

export function anonymizeIp(ip: string): string {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split('.')
    if (parts.length >= 4) parts[3] = 'xxx'
    return parts.join('.')
  }

  if (ip.includes(':')) {
    const segments = ip.split(':')
    if (segments.length > 1) {
      segments[segments.length - 1] = 'xxxx'
    }
    return segments.join(':')
  }

  return 'xxx.xxx.xxx.xxx'
}
