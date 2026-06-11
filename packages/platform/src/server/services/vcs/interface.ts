export interface VcsRelease {
  version: string
  tag: string
  downloadUrl: string
  artifactSize?: number
  publishedAt: string
  releaseNotes?: string
}

export interface VcsProvider {
  readonly name: string
  listReleases(namespace: string, repo: string, limit?: number): Promise<VcsRelease[]>
  getRelease(namespace: string, repo: string, version: string): Promise<VcsRelease | null>
  downloadRelease(release: VcsRelease, destPath: string): Promise<string>
}

export type VcsProviderName = 'github' | 'gitlab' | 'azure' | 'bitbucket'
