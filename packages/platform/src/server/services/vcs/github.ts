import fs from 'fs/promises'
import path from 'path'
import { pipeline } from 'stream/promises'
import { createWriteStream } from 'fs'
import type { VcsProvider, VcsRelease } from './interface.js'

interface GithubReleaseAsset {
  name: string
  browser_download_url: string
  size: number
}

interface GithubRelease {
  tag_name: string
  name: string
  body: string | null
  published_at: string
  assets: GithubReleaseAsset[]
}

export class GithubVcsProvider implements VcsProvider {
  readonly name = 'github'

  constructor(private readonly token: string) {}

  async listReleases(namespace: string, repo: string, limit = 20): Promise<VcsRelease[]> {
    const url = `https://api.github.com/repos/${namespace}/${repo}/releases?per_page=${limit}`
    const releases = await this.fetchJson<GithubRelease[]>(url)
    return releases.map((release) => this.toVcsRelease(release)).filter((r): r is VcsRelease => r !== null)
  }

  async getRelease(namespace: string, repo: string, version: string): Promise<VcsRelease | null> {
    const tag = version.startsWith('v') ? version : `v${version}`
    const url = `https://api.github.com/repos/${namespace}/${repo}/releases/tags/${encodeURIComponent(tag)}`
    try {
      const release = await this.fetchJson<GithubRelease>(url)
      return this.toVcsRelease(release)
    } catch {
      return null
    }
  }

  async downloadRelease(release: VcsRelease, destPath: string): Promise<string> {
    await fs.mkdir(path.dirname(destPath), { recursive: true })
    const res = await fetch(release.downloadUrl, {
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/octet-stream' },
    })
    if (!res.ok || !res.body) {
      throw new Error(`GitHub download failed: ${res.status}`)
    }
    await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(destPath))
    return destPath
  }

  private toVcsRelease(release: GithubRelease): VcsRelease | null {
    const asset = release.assets[0]
    if (!asset) return null
    return {
      version: release.tag_name.replace(/^v/, ''),
      tag: release.tag_name,
      downloadUrl: asset.browser_download_url,
      artifactSize: asset.size,
      publishedAt: release.published_at,
      releaseNotes: release.body ?? undefined,
    }
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'dotplane-platform',
      },
    })
    if (!res.ok) {
      throw new Error(`GitHub API error ${res.status}: ${await res.text()}`)
    }
    return res.json() as Promise<T>
  }
}
