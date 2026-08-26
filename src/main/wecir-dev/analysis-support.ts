import type {
  WecirDevGitHubItem,
  WecirDevGitHubListResult
} from '../../shared/wecir-dev/github-data-contracts'

type GitHubListSources = WecirDevGitHubListResult['sources']
type GitHubSource = NonNullable<GitHubListSources['issues']>

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function sourceForItem(
  sources: GitHubListSources,
  type: WecirDevGitHubItem['type']
): GitHubSource | undefined {
  const candidates =
    type === 'issue'
      ? [sources.issues, sources.originCandidate, sources.upstreamCandidate, sources.prs]
      : [sources.prs, sources.originCandidate, sources.upstreamCandidate, sources.issues]
  return candidates.find((source): source is GitHubSource => Boolean(source?.owner && source.repo))
}

export function resolveGitHubOwner(
  explicitOwner: string | undefined,
  sources: GitHubListSources,
  items: WecirDevGitHubItem[]
): string {
  return (
    nonEmpty(explicitOwner) ??
    items
      .map((item) => sourceForItem(sources, item.type)?.owner)
      .map(nonEmpty)
      .find(Boolean) ??
    'unknown-owner'
  )
}

export function resolveGitHubRepository(
  explicitRepository: string | undefined,
  sources: GitHubListSources,
  items: WecirDevGitHubItem[]
): string {
  return (
    nonEmpty(explicitRepository) ??
    items
      .map((item) => sourceForItem(sources, item.type)?.repo)
      .map(nonEmpty)
      .find(Boolean) ??
    'unknown-repository'
  )
}

export function getGitHubSourceForItem(
  sources: GitHubListSources,
  type: WecirDevGitHubItem['type']
): GitHubSource | undefined {
  return sourceForItem(sources, type)
}

export function uniqueCardName(baseName: string, usedNames: Set<string>): string {
  if (!usedNames.has(baseName)) {
    usedNames.add(baseName)
    return baseName
  }
  let revision = 2
  while (usedNames.has(`${baseName}-r${revision}`)) {
    revision += 1
  }
  const name = `${baseName}-r${revision}`
  usedNames.add(name)
  return name
}
