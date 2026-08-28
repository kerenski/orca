import type {
  GitHubWorkItem,
  GitHubWorkItemDependencyIdentity,
  GitHubWorkItemDependencyRelation
} from '../../../shared/github/work-item-types'

export type {
  GitHubWorkItemDependencyIdentity,
  GitHubWorkItemDependencyRelation
} from '../../../shared/github/work-item-types'

export type GitHubWorkItemDependencyPriority = {
  identity: GitHubWorkItemDependencyIdentity | string
  priority: number
}

export type GitHubWorkItemDependencyNode = {
  item: GitHubWorkItem
  identity: string
  children: GitHubWorkItemDependencyNode[]
  priority?: number
}

export type GitHubWorkItemDependencyLevel = {
  level: number
  nodes: GitHubWorkItemDependencyNode[]
}

export type GitHubWorkItemDependencyDiagnostic = {
  kind: 'missing-relation-endpoint' | 'self-dependency' | 'cycle'
  relation: GitHubWorkItemDependencyRelation
  identity?: string
}

export type GitHubWorkItemDependencyTree = {
  topLevel: GitHubWorkItemDependencyNode[]
  branchNodes: GitHubWorkItemDependencyNode[]
  leafNodes: GitHubWorkItemDependencyNode[]
  levels: GitHubWorkItemDependencyLevel[]
  parentsByIdentity: Map<string, string[]>
  childrenByIdentity: Map<string, string[]>
  diagnostics: GitHubWorkItemDependencyDiagnostic[]
}

export type BuildGitHubWorkItemDependencyTreeOptions = {
  relations?: readonly GitHubWorkItemDependencyRelation[]
  priorities?: readonly GitHubWorkItemDependencyPriority[]
}

const repositoryIdentity = (item: GitHubWorkItem): string => {
  const repository = item.type === 'pr' ? item.prRepo : item.issueRepo
  if (repository) {
    return `${repository.host ?? 'github.com'}:${repository.owner}/${repository.repo}`
  }
  return item.repoId
}

export const githubWorkItemDependencyIdentity = (item: GitHubWorkItem): string =>
  `${repositoryIdentity(item)}#${item.type}:${item.number}`

const identityFromInput = (identity: GitHubWorkItemDependencyIdentity | string): string => {
  if (typeof identity === 'string') {
    return identity
  }
  const repository = identity.repo
    ? `${identity.repo.host ?? 'github.com'}:${identity.repo.owner}/${identity.repo.repo}`
    : identity.repoId
  if (!repository) {
    return `${identity.type}:${identity.number}`
  }
  return `${repository}#${identity.type}:${identity.number}`
}

const compareNodes = (
  left: GitHubWorkItemDependencyNode,
  right: GitHubWorkItemDependencyNode
): number => {
  const leftPriority = left.priority
  const rightPriority = right.priority
  if (leftPriority !== undefined || rightPriority !== undefined) {
    if (leftPriority === undefined) {
      return 1
    }
    if (rightPriority === undefined) {
      return -1
    }
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority
    }
  }
  const updated = right.item.updatedAt.localeCompare(left.item.updatedAt)
  return (
    updated || left.item.number - right.item.number || left.identity.localeCompare(right.identity)
  )
}

/** Builds a defensive dependency forest without mutating the supplied work items. */
export const buildGitHubWorkItemDependencyTree = (
  items: readonly GitHubWorkItem[],
  options: BuildGitHubWorkItemDependencyTreeOptions = {}
): GitHubWorkItemDependencyTree => {
  const priorities = new Map(
    options.priorities?.map((entry) => [identityFromInput(entry.identity), entry.priority])
  )
  const nodes = new Map<string, GitHubWorkItemDependencyNode>()
  for (const item of items) {
    const identity = githubWorkItemDependencyIdentity(item)
    if (!nodes.has(identity)) {
      nodes.set(identity, {
        item,
        identity,
        children: [],
        priority: priorities.get(identity) ?? item.priority
      })
    }
  }

  const diagnostics: GitHubWorkItemDependencyDiagnostic[] = []
  const parentIdentities = new Set<string>()
  const linkedChildren = new Set<string>()
  const outgoing = new Map<string, Set<string>>()
  const incoming = new Map<string, Set<string>>()
  for (const relation of options.relations ?? []) {
    const parent = identityFromInput(relation.parent)
    const child = identityFromInput(relation.child)
    if (!nodes.has(parent) || !nodes.has(child)) {
      diagnostics.push({
        kind: 'missing-relation-endpoint',
        relation,
        identity: !nodes.has(parent) ? parent : child
      })
      continue
    }
    if (parent === child) {
      diagnostics.push({ kind: 'self-dependency', relation, identity: parent })
      continue
    }
    const reachable = (from: string, target: string, seen = new Set<string>()): boolean => {
      if (from === target) {
        return true
      }
      if (seen.has(from)) {
        return false
      }
      seen.add(from)
      return [...(outgoing.get(from) ?? [])].some((next) => reachable(next, target, seen))
    }
    if (reachable(child, parent)) {
      diagnostics.push({ kind: 'cycle', relation, identity: parent })
      continue
    }
    if (!outgoing.has(parent)) {
      outgoing.set(parent, new Set())
    }
    const children = outgoing.get(parent)!
    if (children.has(child)) {
      continue
    }
    children.add(child)
    if (!incoming.has(child)) {
      incoming.set(child, new Set())
    }
    incoming.get(child)!.add(parent)
    parentIdentities.add(parent)
    linkedChildren.add(child)
    nodes.get(parent)!.children.push(nodes.get(child)!)
  }

  const sortTree = (node: GitHubWorkItemDependencyNode): void => {
    node.children.sort(compareNodes)
    node.children.forEach(sortTree)
  }
  const topLevel = [...nodes.values()]
    .filter((node) => !linkedChildren.has(node.identity))
    .sort(compareNodes)
  topLevel.forEach(sortTree)
  const branchNodes = [...nodes.values()]
    .filter((node) => parentIdentities.has(node.identity))
    .sort(compareNodes)
  const leafNodes = [...nodes.values()]
    .filter((node) => !parentIdentities.has(node.identity))
    .sort(compareNodes)
  const levelsByIdentity = new Map<string, number>()
  const queue = topLevel.map((node) => node.identity)
  queue.forEach((identity) => levelsByIdentity.set(identity, 0))
  for (let index = 0; index < queue.length; index += 1) {
    const identity = queue[index]
    const level = levelsByIdentity.get(identity) ?? 0
    for (const child of outgoing.get(identity) ?? []) {
      const childLevel = Math.max(levelsByIdentity.get(child) ?? 0, level + 1)
      levelsByIdentity.set(child, childLevel)
      queue.push(child)
    }
  }
  const levels = [...nodes.values()].reduce<GitHubWorkItemDependencyLevel[]>((result, node) => {
    const level = levelsByIdentity.get(node.identity) ?? 0
    const bucket = result[level] ?? { level, nodes: [] }
    bucket.nodes.push(node)
    result[level] = bucket
    return result
  }, [])
  levels.forEach((level) => level.nodes.sort(compareNodes))
  const toIdentityLists = (source: Map<string, Set<string>>) =>
    new Map([...source].map(([identity, values]) => [identity, [...values]]))
  return {
    topLevel,
    branchNodes,
    leafNodes,
    levels,
    parentsByIdentity: toIdentityLists(incoming),
    childrenByIdentity: toIdentityLists(outgoing),
    diagnostics
  }
}
