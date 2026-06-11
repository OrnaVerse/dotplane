import fs from 'fs/promises'
import path from 'path'
import { pipeline } from 'stream/promises'
import { createWriteStream } from 'fs'
import type { VcsProvider, VcsRelease } from './interface.js'
import { vcsFetch } from './http.js'

interface GitlabReleaseLink {
  name: string
  url: string
}

interface GitlabRelease {
  tag_name: string
  name: string
  description: string | null
  released_at: string
  assets: { links: GitlabReleaseLink[] }
}

export class GitlabVcsProvider implements VcsProvider {
  readonly name = 'gitlab'

  constructor(
    private readonly token: string,
    private readonly baseUrl = 'https://gitlab.com',
  ) {}

  async listReleases(namespace: string, repo: string, limit = 20): Promise<VcsRelease[]> {
    const projectId = encodeURIComponent(`${namespace}/${repo}`)
    const url = `${this.apiBase()}/projects/${projectId}/releases?per_page=${limit}`
    const releases = await this.fetchJson<GitlabRelease[]>(url)
    return releases.map((release) => this.toVcsRelease(release)).filter((r): r is VcsRelease => r !== null)
  }

  async getRelease(namespace: string, repo: string, version: string): Promise<VcsRelease | null> {
    const projectId = encodeURIComponent(`${namespace}/${repo}`)
    const tag = version.startsWith('v') ? version : `v${version}`
    const url = `${this.apiBase()}/projects/${projectId}/releases/${encodeURIComponent(tag)}`
    try {
      const release = await this.fetchJson<GitlabRelease>(url)
      return this.toVcsRelease(release)
    } catch {
      return null
    }
  }

  async downloadRelease(release: VcsRelease, destPath: string): Promise<string> {
    await fs.mkdir(path.dirname(destPath), { recursive: true })
    const res = await vcsFetch('gitlab', release.downloadUrl, {
      headers: { 'PRIVATE-TOKEN': this.token },
    }, this.baseUrl)
    if (!res.ok || !res.body) {
      throw new Error(`GitLab download failed: ${res.status}`)
    }
    await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(destPath))
    return destPath
  }

  private apiBase(): string {
    return `${this.baseUrl.replace(/\/$/, '')}/api/v4`
  }

  private toVcsRelease(release: GitlabRelease): VcsRelease | null {
    const link = release.assets.links[0]
    if (!link) return null
    return {
      version: release.tag_name.replace(/^v/, ''),
      tag: release.tag_name,
      downloadUrl: link.url,
      publishedAt: release.released_at,
      releaseNotes: release.description ?? undefined,
    }
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const res = await vcsFetch('gitlab', url, {
      headers: { 'PRIVATE-TOKEN': this.token },
    }, this.baseUrl)
    if (!res.ok) {
      throw new Error(`GitLab API error ${res.status}: ${await res.text()}`)
    }
    return res.json() as Promise<T>
  }
}
