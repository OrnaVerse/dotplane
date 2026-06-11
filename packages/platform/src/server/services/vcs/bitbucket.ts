import fs from 'fs/promises'
import path from 'path'
import { pipeline } from 'stream/promises'
import { createWriteStream } from 'fs'
import type { VcsProvider, VcsRelease } from './interface.js'
import { vcsFetch } from './http.js'

interface BitbucketDownloadLink {
  name: string
  href: string
}

interface BitbucketRelease {
  name: string
  tag_name: string
  description: string | null
  created_on: string
  links: { downloads: BitbucketDownloadLink[] }
}

export class BitbucketVcsProvider implements VcsProvider {
  readonly name = 'bitbucket'

  constructor(private readonly token: string) {}

  async listReleases(namespace: string, repo: string, limit = 20): Promise<VcsRelease[]> {
    const url = `https://api.bitbucket.org/2.0/repositories/${namespace}/${repo}/downloads?pagelen=${limit}`
    const data = await this.fetchJson<{ values: BitbucketRelease[] }>(url)
    return data.values.map((release) => this.toVcsRelease(release)).filter((r): r is VcsRelease => r !== null)
  }

  async getRelease(namespace: string, repo: string, version: string): Promise<VcsRelease | null> {
    const tag = version.startsWith('v') ? version : `v${version}`
    const releases = await this.listReleases(namespace, repo, 100)
    return releases.find((r) => r.tag === tag || r.version === version) ?? null
  }

  async downloadRelease(release: VcsRelease, destPath: string): Promise<string> {
    await fs.mkdir(path.dirname(destPath), { recursive: true })
    const res = await vcsFetch('bitbucket', release.downloadUrl, {
      headers: { Authorization: `Bearer ${this.token}` },
    })
    if (!res.ok || !res.body) {
      throw new Error(`Bitbucket download failed: ${res.status}`)
    }
    await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(destPath))
    return destPath
  }

  private toVcsRelease(release: BitbucketRelease): VcsRelease | null {
    const download = release.links.downloads[0]
    if (!download) return null
    return {
      version: release.tag_name.replace(/^v/, ''),
      tag: release.tag_name,
      downloadUrl: download.href,
      publishedAt: release.created_on,
      releaseNotes: release.description ?? undefined,
    }
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const res = await vcsFetch('bitbucket', url, {
      headers: { Authorization: `Bearer ${this.token}` },
    })
    if (!res.ok) {
      throw new Error(`Bitbucket API error ${res.status}: ${await res.text()}`)
    }
    return res.json() as Promise<T>
  }
}
