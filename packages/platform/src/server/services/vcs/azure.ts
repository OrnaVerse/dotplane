import fs from 'fs/promises'
import path from 'path'
import { pipeline } from 'stream/promises'
import { createWriteStream } from 'fs'
import type { VcsProvider, VcsRelease } from './interface.js'

interface AzureReleaseAsset {
  name: string
  downloadUrl: string
  size: number
}

interface AzureRelease {
  name: string
  tagName: string
  description: string
  createdOn: string
  assets: AzureReleaseAsset[]
}

export class AzureVcsProvider implements VcsProvider {
  readonly name = 'azure'

  constructor(
    private readonly token: string,
    private readonly organization: string,
  ) {}

  async listReleases(namespace: string, repo: string, limit = 20): Promise<VcsRelease[]> {
    const url = `${this.apiBase()}/${this.organization}/${namespace}/_apis/release/releases?api-version=7.1&$top=${limit}`
    const data = await this.fetchJson<{ value: AzureRelease[] }>(url)
    return data.value
      .filter((release) => release.tagName.includes(repo) || release.name.includes(repo))
      .map((release) => this.toVcsRelease(release))
      .filter((r): r is VcsRelease => r !== null)
  }

  async getRelease(namespace: string, repo: string, version: string): Promise<VcsRelease | null> {
    const releases = await this.listReleases(namespace, repo, 100)
    const tag = version.startsWith('v') ? version : `v${version}`
    return releases.find((r) => r.tag === tag || r.version === version) ?? null
  }

  async downloadRelease(release: VcsRelease, destPath: string): Promise<string> {
    await fs.mkdir(path.dirname(destPath), { recursive: true })
    const res = await fetch(release.downloadUrl, {
      headers: { Authorization: `Basic ${Buffer.from(`:${this.token}`).toString('base64')}` },
    })
    if (!res.ok || !res.body) {
      throw new Error(`Azure DevOps download failed: ${res.status}`)
    }
    await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(destPath))
    return destPath
  }

  private apiBase(): string {
    return 'https://dev.azure.com'
  }

  private toVcsRelease(release: AzureRelease): VcsRelease | null {
    const asset = release.assets[0]
    if (!asset) return null
    return {
      version: release.tagName.replace(/^v/, ''),
      tag: release.tagName,
      downloadUrl: asset.downloadUrl,
      artifactSize: asset.size,
      publishedAt: release.createdOn,
      releaseNotes: release.description || undefined,
    }
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const res = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`:${this.token}`).toString('base64')}`,
      },
    })
    if (!res.ok) {
      throw new Error(`Azure DevOps API error ${res.status}: ${await res.text()}`)
    }
    return res.json() as Promise<T>
  }
}
