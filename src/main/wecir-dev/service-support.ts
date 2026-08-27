import { resolve } from 'node:path'
import type { Store } from '../persistence'
import { assertRegisteredGitHubRepo } from '../ipc/github-repo-routing'
import type {
  WecirDevCardRecord,
  WecirDevError,
  WecirDevPriority,
  WecirDevRepositorySelection
} from '../../shared/wecir-dev/contracts'
import { WECIR_DEV_SCHEMA_VERSION } from '../../shared/wecir-dev/contracts'
import type {
  WecirDevGetCardStatusesArgs,
  WecirDevGetCardStatusesResult,
  WecirDevStartCardArgs,
  WecirDevStartCardResult,
  WecirDevStartCardsBatchResult
} from './types'

export function assertServiceRunning(shuttingDown: boolean): void {
  if (shuttingDown) {
    throw cardError('unknown', 'Wecir Dev service is shutting down', false)
  }
}

export function summarizeChecks(checks: { status: string; conclusion: string | null }[]) {
  if (!checks.length) {
    return undefined
  }
  const failed = checks.filter((check) => check.conclusion === 'failure').length
  const pending = checks.filter((check) => check.status !== 'completed').length
  return {
    state: failed ? ('failure' as const) : pending ? ('pending' as const) : ('success' as const),
    total: checks.length,
    passed: checks.filter((check) => check.conclusion === 'success').length,
    failed,
    pending,
    neutral: checks.filter(
      (check) => check.conclusion === 'neutral' || check.conclusion === 'skipped'
    ).length
  }
}

export const CONTROLLER_COMMANDS: Record<string, string> = {
  start: '继续下一步',
  stop: '停止当前工作',
  retry: '重试当前工作',
  remove: '移除当前卡片',
  refresh: '查询进度',
  approve_merge: '等待人工确认',
  mark_stale: '汇总阻塞'
}

const MAX_CARD_NAME_LENGTH = 64

export function cardNameForIssue(issueNumber: number, title: string): string {
  const prefix = `issue-${issueNumber}-`
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, Math.max(0, MAX_CARD_NAME_LENGTH - prefix.length))
  return `${prefix}${slug || 'card'}`.slice(0, MAX_CARD_NAME_LENGTH)
}

export function createCardRecord(
  repository: WecirDevRepositorySelection,
  issueNumber: number,
  name: string,
  kind: 'issue' | 'pull_request',
  now: () => string,
  labels: string[] = [],
  metadata?: Pick<WecirDevCardRecord, 'assignees' | 'body' | 'url' | 'checksSummary' | 'labels'>
): WecirDevCardRecord {
  const timestamp = now()
  const priority: WecirDevPriority = labels.some((label) => /critical|blocker/i.test(label))
    ? 'critical'
    : labels.some((label) => /high/i.test(label))
      ? 'high'
      : 'normal'
  return {
    schemaVersion: WECIR_DEV_SCHEMA_VERSION,
    cardId: `${repository.repositoryId}:${issueNumber}`,
    name,
    repository,
    reference: {
      kind,
      number: issueNumber,
      owner: repository.owner?.trim() || 'unknown-owner',
      repository: repository.name?.trim() || 'unknown-repository'
    },
    priority,
    ...(metadata ?? { labels }),
    dependencies: [],
    status: 'queued',
    createdAt: timestamp,
    updatedAt: timestamp,
    queuedAt: timestamp
  }
}

export function requireLocalRepo(store: Store, repositoryId: string, path?: string) {
  const registered = store.getRepo(repositoryId)
  if (!registered) {
    throw cardError('repository_not_registered', 'Repository is not registered', false)
  }
  if (path && resolve(registered.path) !== resolve(path)) {
    throw cardError(
      'repository_path_mismatch',
      'Repository path does not match repository id',
      false
    )
  }
  let repo
  try {
    repo = assertRegisteredGitHubRepo(
      { repoId: repositoryId, repoPath: path ?? registered.path },
      store
    )
  } catch {
    throw cardError('repository_not_registered', 'Repository is not registered', false)
  }
  if (repo.connectionId || repo.executionHostId) {
    throw cardError(
      'non_local_execution_host',
      'Cards can only run on the local execution host',
      false
    )
  }
  return repo
}

export function cardRecordKey(repositoryId: string, cardId: string): string {
  return `${repositoryId}:${cardId}`
}

export function buildCardStatuses(
  cards: Iterable<WecirDevCardRecord>,
  args: WecirDevGetCardStatusesArgs
): WecirDevGetCardStatusesResult {
  const wanted = args.cardIds ? new Set(args.cardIds) : undefined
  const items = [...cards].filter(
    (card) =>
      card.repository.repositoryId === args.repositoryId && (!wanted || wanted.has(card.cardId))
  )
  return {
    schemaVersion: WECIR_DEV_SCHEMA_VERSION,
    items,
    page: 1,
    pageSize: items.length || 1,
    total: items.length,
    hasNext: false
  }
}

export function cardError(
  code: WecirDevError['code'],
  message: string,
  retryable: boolean
): Error & { cardError: WecirDevError } {
  const error = new Error(message) as Error & { cardError: WecirDevError }
  error.cardError = { code, message, retryable }
  return error
}

export function toCardError(error: unknown): WecirDevError {
  return (
    (error as { cardError?: WecirDevError }).cardError ?? {
      code: 'unknown',
      message: error instanceof Error ? error.message : 'Card operation failed',
      retryable: true
    }
  )
}

export function analysisError(
  message: string,
  details?: Record<string, string | number | boolean>,
  code: WecirDevError['code'] = 'unknown'
): WecirDevError {
  return { code, message, retryable: true, ...(details ? { details } : {}) }
}

export function githubAnalysisError(
  error: { type?: string; message: string },
  details?: Record<string, string | number | boolean>
): WecirDevError {
  const authenticationFailure =
    error.type === 'permission_denied' ||
    /not authenticated|authentication required|authentication failed|token|credentials|logged in/i.test(
      error.message
    )
  return analysisError(
    error.message,
    details,
    authenticationFailure ? 'github_auth_failed' : 'unknown'
  )
}

export function existingCardNames(
  cards: Iterable<WecirDevCardRecord>,
  repositoryId: string
): Set<string> {
  return new Set(
    [...cards]
      .filter((card) => card.repository.repositoryId === repositoryId)
      .map((card) => card.name)
  )
}

export async function runCardBatch(
  args: {
    cards: Omit<WecirDevStartCardArgs, 'repository'>[]
    repository: WecirDevStartCardArgs['repository']
  },
  startCard: (args: WecirDevStartCardArgs) => Promise<WecirDevStartCardResult>
): Promise<WecirDevStartCardsBatchResult> {
  const items: WecirDevStartCardsBatchResult['items'] = []
  for (const cardArgs of args.cards) {
    try {
      const result = await startCard({ ...cardArgs, repository: args.repository })
      items.push({ issueNumber: cardArgs.issueNumber, ok: true, card: result.card })
    } catch (error) {
      items.push({ issueNumber: cardArgs.issueNumber, ok: false, error: toCardError(error) })
      return { items, stoppedOnFailure: true }
    }
  }
  return { items, stoppedOnFailure: false }
}
