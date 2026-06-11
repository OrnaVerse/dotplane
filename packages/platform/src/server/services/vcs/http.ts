import { safeFetch, vcsAllowedHosts, type ValidateUrlOptions } from '@dotplane/shared'

export async function vcsFetch(
  provider: string,
  url: string,
  init?: RequestInit,
  customBaseUrl?: string,
): Promise<Response> {
  const options: ValidateUrlOptions = {
    allowedHostnames: vcsAllowedHosts(provider, customBaseUrl),
    requireHttps: true,
    requireAllowlist: true,
  }

  return safeFetch(url, init, options)
}
