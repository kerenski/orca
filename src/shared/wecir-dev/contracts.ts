export const WECIR_DEV_SCHEMA_VERSION = 1 as const

export type WecirDevSchemaVersion = typeof WECIR_DEV_SCHEMA_VERSION

export const WECIR_DEV_STATUSES = [
  'queued',
  'starting',
  'controller_ready',
  'worker_running',
  'waiting_review',
  'ci_running',
  'waiting_merge',
  'completed',
  'failed',
  'stale',
  'removed',
  'blocked'
] as const
export type WecirDevStatus = (typeof WECIR_DEV_STATUSES)[number]

export const WECIR_DEV_PRIORITIES = ['critical', 'high', 'normal', 'low'] as const
export type WecirDevPriority = (typeof WECIR_DEV_PRIORITIES)[number]

export const WECIR_DEV_ERROR_CODES = [
  'invalid_parameters',
  'repository_not_registered',
  'repository_path_mismatch',
  'non_local_execution_host',
  'dependency_missing',
  'script_missing',
  'invalid_script_output',
  'pty_binding_lost',
  'worktree_invalid',
  'github_auth_failed',
  'timeout',
  'unknown'
] as const
export type WecirDevErrorCode = (typeof WECIR_DEV_ERROR_CODES)[number]

export type WecirDevRepositorySelection = {
  repositoryId: string
  path: string
  executionHost: 'local'
  provider?: 'github'
  owner?: string
  name?: string
  defaultBranch?: string
}

export type WecirDevIssueReference = {
  kind: 'issue' | 'pull_request'
  number: number
  owner: string
  repository: string
  url?: string
  title?: string
}

export type WecirDevDependencyRelation = {
  relation: 'blocks' | 'blocked_by' | 'related'
  targetCardId?: string
  targetReference?: WecirDevIssueReference
  note?: string
}

export type WecirDevRelationSource = {
  kind: 'cross_reference' | 'explicit_text' | 'label'
  relation: 'blocks' | 'blocked_by'
  targetNumber: number
  text?: string
}

export type WecirDevDependencyAnalysis = {
  schemaVersion: WecirDevSchemaVersion
  issueNumber: number
  dependsOn: number[]
  blocks: number[]
  relationSources: WecirDevRelationSource[]
  topoLevel: number
  blockedCount: number
  cycleDetected: boolean
  cycleNodes: number[]
  executableOrder: number[]
}

export type WecirDevAnalysisResult = {
  summary: string
  suggestedPriority: WecirDevPriority
  dependencies: WecirDevDependencyRelation[]
  riskFlags: string[]
  acceptanceCriteria: string[]
  generatedAt: string
}

export type WecirDevError = {
  code: WecirDevErrorCode
  message: string
  retryable: boolean
  details?: Record<string, string | number | boolean>
}

export type WecirDevStartCardSuccess = {
  schemaVersion: WecirDevSchemaVersion
  ok: true
  controllerPtyId: string
  worktreeId: string
  worktreePath: string
  branch: string
  workerAgent: string
  issue: number
  card: string
  tier: 'simple' | 'medium' | 'complex'
}

export type WecirDevStartCardFailure = {
  schemaVersion: WecirDevSchemaVersion
  ok: false
  error: WecirDevError
}

export type WecirDevStartCardScriptResult = WecirDevStartCardSuccess | WecirDevStartCardFailure

export type WecirDevCardRecord = {
  schemaVersion: WecirDevSchemaVersion
  cardId: string
  name: string
  repository: WecirDevRepositorySelection
  reference: WecirDevIssueReference
  priority: WecirDevPriority
  analysis?: WecirDevAnalysisResult
  dependencies: WecirDevDependencyRelation[]
  status: WecirDevStatus
  createdAt: string
  updatedAt: string
  queuedAt?: string
  startedAt?: string
  completedAt?: string
  controllerHandle?: string
  workerHandle?: string
  worktreePath?: string
  lastError?: WecirDevError
}

export type WecirDevQueueItem = {
  schemaVersion: WecirDevSchemaVersion
  queueId: string
  cardId: string
  priority: WecirDevPriority
  enqueuedAt: string
  attempt: number
  requestedBy: 'renderer' | 'controller' | 'recovery'
}

export type WecirDevControllerInstruction = {
  schemaVersion: WecirDevSchemaVersion
  instructionId: string
  cardId: string
  command: 'start' | 'stop' | 'retry' | 'remove' | 'refresh' | 'approve_merge' | 'mark_stale'
  expectedStatus?: WecirDevStatus
  reason?: string
}

export type WecirDevPageRequest = {
  page?: number
  pageSize?: number
  cursor?: string
}

export type WecirDevPage<T> = {
  schemaVersion: WecirDevSchemaVersion
  items: T[]
  page: number
  pageSize: number
  total: number
  hasNext: boolean
  nextCursor?: string
}

export type WecirDevRequest<T> = {
  schemaVersion: WecirDevSchemaVersion
  requestId: string
  payload: T
}

export type WecirDevResponse<T> = {
  schemaVersion: WecirDevSchemaVersion
  requestId: string
  ok: boolean
  data?: T
  error?: WecirDevError
}

export type WecirDevStatusTransition = {
  schemaVersion: WecirDevSchemaVersion
  cardId: string
  from: WecirDevStatus
  to: WecirDevStatus
  reason?: string
}

const STATUS_TRANSITIONS: Readonly<Record<WecirDevStatus, readonly WecirDevStatus[]>> = {
  queued: ['starting', 'removed', 'blocked'],
  starting: ['controller_ready', 'failed', 'stale', 'removed'],
  controller_ready: ['worker_running', 'failed', 'stale', 'removed'],
  worker_running: ['waiting_review', 'ci_running', 'failed', 'stale', 'blocked'],
  waiting_review: ['ci_running', 'failed', 'stale', 'removed'],
  ci_running: ['waiting_merge', 'completed', 'failed', 'stale'],
  waiting_merge: ['completed', 'failed', 'stale', 'removed'],
  completed: ['stale', 'removed'],
  failed: ['queued', 'starting', 'removed', 'stale'],
  stale: ['queued', 'removed'],
  removed: [],
  blocked: ['queued', 'removed', 'stale']
}

export function isValidWecirDevStatusTransition(from: WecirDevStatus, to: WecirDevStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to)
}

export function isKnownWecirDevStatus(value: string): value is WecirDevStatus {
  return (WECIR_DEV_STATUSES as readonly string[]).includes(value)
}

export const WECIR_DEV_WIRE_COMPATIBILITY = {
  schemaVersion: WECIR_DEV_SCHEMA_VERSION,
  policy: 'additive-optional-fields',
  unknownFields: 'ignore',
  unknownStatus: 'reject',
  newStatesRequireCapability: true,
  newChannelsRequireCapability: true,
  executionHosts: ['local']
} as const
