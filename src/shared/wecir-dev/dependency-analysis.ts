import {
  WECIR_DEV_SCHEMA_VERSION,
  type WecirDevDependencyAnalysis,
  type WecirDevRelationSource
} from './contracts'

export type WecirDevDependencyReference = {
  number: number
  owner?: string
  repository?: string
  url?: string
}

export type WecirDevDependencyInput = {
  number: number
  title: string
  body?: string
  labels?: string[]
  comments?: string[]
  references?: WecirDevDependencyReference[]
}

export type WecirDevRepositoryScope = { owner: string; repository: string }
type Source = Pick<WecirDevRelationSource, 'kind' | 'text'>
type Edge = { dependent: number; dependency: number; source: Source }

const RELATION_PATTERN = /\b(blocked\s+by|depends?\s+on|blocks)\s+#(\d+)\b/gi
const LABEL_PATTERN = /^(blocked|depends-on|blocker)(?:\s*:\s*#?(\d+))?$/i

function parseNumber(value: string | undefined): number | null {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

function isInScope(
  reference: WecirDevDependencyReference,
  scope?: WecirDevRepositoryScope
): boolean {
  if (!scope || !reference.owner || !reference.repository) {
    return true
  }
  return (
    reference.owner.toLowerCase() === scope.owner.toLowerCase() &&
    reference.repository.toLowerCase() === scope.repository.toLowerCase()
  )
}

function addEdge(edges: Edge[], edge: Edge): void {
  if (
    !edges.some(
      (candidate) =>
        candidate.dependent === edge.dependent &&
        candidate.dependency === edge.dependency &&
        candidate.source.kind === edge.source.kind &&
        candidate.source.text === edge.source.text
    )
  ) {
    edges.push(edge)
  }
}

function addTextEdges(item: WecirDevDependencyInput, text: string, edges: Edge[]): void {
  for (const match of text.matchAll(RELATION_PATTERN)) {
    const target = parseNumber(match[2])
    if (target === null || target === item.number) {
      continue
    }
    const relation = match[1].toLowerCase().replace(/\s+/g, ' ')
    const source = { kind: 'explicit_text' as const, text: match[0] }
    if (relation === 'blocks') {
      addEdge(edges, { dependent: target, dependency: item.number, source })
    } else {
      addEdge(edges, { dependent: item.number, dependency: target, source })
    }
  }
}

function collectEdges(items: WecirDevDependencyInput[], scope?: WecirDevRepositoryScope): Edge[] {
  const available = new Set(items.map((item) => item.number))
  const edges: Edge[] = []
  for (const item of items) {
    addTextEdges(item, [item.title, item.body ?? '', ...(item.comments ?? [])].join('\n'), edges)
    for (const reference of item.references ?? []) {
      if (!isInScope(reference, scope) || reference.number === item.number) {
        continue
      }
      addEdge(edges, {
        dependent: item.number,
        dependency: reference.number,
        source: { kind: 'cross_reference', text: reference.url ?? `#${reference.number}` }
      })
    }
    for (const label of item.labels ?? []) {
      const match = LABEL_PATTERN.exec(label.trim())
      if (!match) {
        continue
      }
      const target = parseNumber(match[2])
      if (target !== null && target !== item.number) {
        const isBlocker = match[1].toLowerCase() === 'blocker'
        addEdge(edges, {
          dependent: isBlocker ? target : item.number,
          dependency: isBlocker ? item.number : target,
          source: { kind: 'label', text: label.trim() }
        })
      } else if (target === null) {
        for (const edge of edges.filter((candidate) => candidate.dependent === item.number)) {
          addEdge(edges, { ...edge, source: { kind: 'label', text: label.trim() } })
        }
      }
    }
  }
  return edges.filter((edge) => available.has(edge.dependent) && available.has(edge.dependency))
}

function findCycleNodes(nodes: number[], dependencies: Map<number, number[]>): Set<number> {
  const visiting = new Set<number>()
  const visited = new Set<number>()
  const cycles = new Set<number>()
  const stack: number[] = []
  function visit(node: number): void {
    if (visiting.has(node)) {
      for (const cycleNode of stack.slice(stack.indexOf(node))) {
        cycles.add(cycleNode)
      }
      return
    }
    if (visited.has(node)) {
      return
    }
    visiting.add(node)
    stack.push(node)
    for (const dependency of dependencies.get(node) ?? []) {
      visit(dependency)
    }
    stack.pop()
    visiting.delete(node)
    visited.add(node)
  }
  for (const node of nodes) {
    visit(node)
  }
  return cycles
}

function calculateLevels(
  nodes: number[],
  dependencies: Map<number, number[]>
): Map<number, number> {
  const levels = new Map<number, number>()
  const visiting = new Set<number>()
  function level(node: number): number {
    if (levels.has(node)) {
      return levels.get(node)!
    }
    if (visiting.has(node)) {
      return 0
    }
    visiting.add(node)
    const result = Math.max(-1, ...(dependencies.get(node) ?? []).map(level)) + 1
    visiting.delete(node)
    levels.set(node, result)
    return result
  }
  for (const node of nodes) {
    level(node)
  }
  return levels
}

function executableOrder(
  nodes: number[],
  dependencies: Map<number, number[]>,
  cycles: Set<number>
): number[] {
  const unusable = new Set(cycles)
  let changed = true
  while (changed) {
    changed = false
    for (const node of nodes) {
      if (
        !unusable.has(node) &&
        (dependencies.get(node) ?? []).some((dependency) => unusable.has(dependency))
      ) {
        unusable.add(node)
        changed = true
      }
    }
  }
  const indegree = new Map(nodes.filter((node) => !unusable.has(node)).map((node) => [node, 0]))
  const dependents = new Map<number, number[]>()
  for (const node of indegree.keys()) {
    for (const dependency of dependencies.get(node) ?? []) {
      if (!indegree.has(dependency)) {
        continue
      }
      indegree.set(node, indegree.get(node)! + 1)
      dependents.set(dependency, [...(dependents.get(dependency) ?? []), node])
    }
  }
  const ready = [...indegree]
    .filter(([, count]) => count === 0)
    .map(([node]) => node)
    .sort((a, b) => a - b)
  const order: number[] = []
  while (ready.length) {
    const node = ready.shift()!
    order.push(node)
    for (const dependent of dependents.get(node) ?? []) {
      const count = indegree.get(dependent)! - 1
      indegree.set(dependent, count)
      if (count === 0) {
        ready.push(dependent)
        ready.sort((a, b) => a - b)
      }
    }
  }
  return order
}

export function analyzeWecirDevDependencies(
  items: WecirDevDependencyInput[],
  scope?: WecirDevRepositoryScope
): WecirDevDependencyAnalysis[] {
  const nodes = [...new Set(items.map((item) => item.number))].sort((a, b) => a - b)
  const dependencies = new Map(nodes.map((node) => [node, [] as number[]]))
  const sources = new Map<number, WecirDevRelationSource[]>()
  for (const edge of collectEdges(items, scope)) {
    const values = dependencies.get(edge.dependent)!
    if (!values.includes(edge.dependency)) {
      values.push(edge.dependency)
    }
    const addSource = (node: number, relation: 'blocks' | 'blocked_by', targetNumber: number) => {
      const source = { ...edge.source, relation, targetNumber }
      const current = sources.get(node) ?? []
      if (!current.some((candidate) => JSON.stringify(candidate) === JSON.stringify(source))) {
        current.push(source)
      }
      sources.set(node, current)
    }
    addSource(edge.dependent, 'blocked_by', edge.dependency)
    addSource(edge.dependency, 'blocks', edge.dependent)
  }
  for (const values of dependencies.values()) {
    values.sort((a, b) => a - b)
  }
  for (const values of sources.values()) {
    values.sort(
      (a, b) =>
        a.targetNumber - b.targetNumber ||
        a.relation.localeCompare(b.relation) ||
        a.kind.localeCompare(b.kind) ||
        (a.text ?? '').localeCompare(b.text ?? '')
    )
  }
  const cycles = findCycleNodes(nodes, dependencies)
  const levels = calculateLevels(nodes, dependencies)
  const order = executableOrder(nodes, dependencies, cycles)
  const blockedCounts = new Map(nodes.map((node) => [node, 0]))
  for (const values of dependencies.values()) {
    for (const dependency of values) {
      blockedCounts.set(dependency, blockedCounts.get(dependency)! + 1)
    }
  }
  return nodes.map((number) => ({
    schemaVersion: WECIR_DEV_SCHEMA_VERSION,
    issueNumber: number,
    dependsOn: dependencies.get(number)!,
    blocks: nodes.filter((node) => dependencies.get(node)!.includes(number)),
    relationSources: sources.get(number) ?? [],
    topoLevel: levels.get(number) ?? 0,
    blockedCount: blockedCounts.get(number) ?? 0,
    cycleDetected: cycles.has(number),
    cycleNodes: [...cycles].sort((a, b) => a - b),
    executableOrder: order
  }))
}
