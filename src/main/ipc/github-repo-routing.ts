import { resolve } from 'node:path'
import type { Repo } from '../../shared/repo-types'
import type { Store } from '../persistence'

export type GitHubRepoScopedArgs = {
  repoPath: string
  repoId?: string | null
}

export function assertRegisteredGitHubRepo(
  args: string | GitHubRepoScopedArgs,
  store: Store
): Repo {
  const repoPath = typeof args === 'string' ? args : args.repoPath
  const repoId = typeof args === 'string' ? undefined : args.repoId
  const resolvedRepoPath = resolve(repoPath)
  const repo = store
    .getRepos()
    .find((candidate) =>
      repoId ? candidate.id === repoId : resolve(candidate.path) === resolvedRepoPath
    )
  if (!repo || (repoId && resolve(repo.path) !== resolvedRepoPath)) {
    throw new Error('Access denied: unknown repository path')
  }
  return repo
}

export function getGitHubRepoConnectionId(repo: Repo): string | null {
  return repo.connectionId ?? null
}
