import { decrypt } from '../../utils/crypto.js'
import type { VcsProvider, VcsProviderName } from './interface.js'
import { AzureVcsProvider } from './azure.js'
import { BitbucketVcsProvider } from './bitbucket.js'
import { GithubVcsProvider } from './github.js'
import { GitlabVcsProvider } from './gitlab.js'

export interface VcsAppConfig {
  vcsProvider: VcsProviderName | null
  vcsNamespace: string | null
  vcsRepo: string | null
  vcsTokenEnc: string | null
  artifactName?: string
}

export function createVcsProvider(config: VcsAppConfig): VcsProvider {
  if (!config.vcsProvider) {
    throw new Error('App is not configured for VCS')
  }
  if (!config.vcsTokenEnc) {
    throw new Error('VCS token not configured')
  }

  const token = decrypt(config.vcsTokenEnc)

  switch (config.vcsProvider) {
    case 'github':
      return new GithubVcsProvider(token)
    case 'gitlab':
      return new GitlabVcsProvider(token)
    case 'azure':
      if (!config.vcsNamespace) {
        throw new Error('Azure DevOps requires vcsNamespace (project name)')
      }
      return new AzureVcsProvider(token, config.vcsNamespace)
    case 'bitbucket':
      return new BitbucketVcsProvider(token)
    default: {
      const _exhaustive: never = config.vcsProvider
      throw new Error(`Unsupported VCS provider: ${String(_exhaustive)}`)
    }
  }
}

export function getVcsRepoPath(config: VcsAppConfig): { namespace: string; repo: string } {
  if (!config.vcsNamespace || !config.vcsRepo) {
    throw new Error('VCS namespace and repo must be configured')
  }
  return { namespace: config.vcsNamespace, repo: config.vcsRepo }
}
