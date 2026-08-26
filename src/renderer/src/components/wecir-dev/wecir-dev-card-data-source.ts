import {
  WECIR_DEV_SCHEMA_VERSION,
  isValidWecirDevStatusTransition,
  type WecirDevAnalysisResult,
  type WecirDevCardRecord,
  type WecirDevControllerInstruction,
  type WecirDevDependencyRelation,
  type WecirDevIssueReference,
  type WecirDevPage,
  type WecirDevPriority,
  type WecirDevRepositorySelection,
  type WecirDevStatus
} from '../../../../shared/wecir-dev/contracts'
import { WecirDevCardRecordSchema } from '../../../../shared/wecir-dev/schemas'
import {
  WECIR_DEV_CARD_STORAGE_KEY,
  createWecirDevCardDataId,
  updateWecirDevCardSnapshot,
  useWecirDevCardData,
  type WecirDevCardDataSnapshot
} from './wecir-dev-card-storage'

export { WECIR_DEV_CARD_STORAGE_KEY, useWecirDevCardData }
export type { WecirDevCardDataSnapshot }

export type WecirDevCardDraft = {
  name: string
  repository: WecirDevRepositorySelection
  reference: WecirDevIssueReference
  priority: WecirDevPriority
  dependencies: WecirDevDependencyRelation[]
  analysis?: WecirDevAnalysisResult
}

export function listWecirDevCards(args: {
  snapshot: WecirDevCardDataSnapshot
  repositoryId?: string
  status?: WecirDevStatus
  page: number
  pageSize: number
}): WecirDevPage<WecirDevCardRecord> {
  const filtered = args.snapshot.cards
    .filter((card) => !args.repositoryId || card.repository.repositoryId === args.repositoryId)
    .filter((card) => !args.status || card.status === args.status)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  const start = (args.page - 1) * args.pageSize
  return {
    schemaVersion: WECIR_DEV_SCHEMA_VERSION,
    items: filtered.slice(start, start + args.pageSize),
    page: args.page,
    pageSize: args.pageSize,
    total: filtered.length,
    hasNext: start + args.pageSize < filtered.length
  }
}

export function createWecirDevCard(draft: WecirDevCardDraft): WecirDevCardRecord {
  const now = new Date().toISOString()
  const card = WecirDevCardRecordSchema.parse({
    ...draft,
    schemaVersion: WECIR_DEV_SCHEMA_VERSION,
    cardId: createWecirDevCardDataId('card'),
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    queuedAt: now
  })
  updateWecirDevCardSnapshot((current) => ({ ...current, cards: [card, ...current.cards] }))
  return card
}

export function updateWecirDevCard(cardId: string, draft: WecirDevCardDraft): WecirDevCardRecord {
  let updated: WecirDevCardRecord | null = null
  updateWecirDevCardSnapshot((current) => ({
    ...current,
    cards: current.cards.map((card) => {
      if (card.cardId !== cardId) {
        return card
      }
      updated = WecirDevCardRecordSchema.parse({
        ...card,
        ...draft,
        updatedAt: new Date().toISOString()
      })
      return updated
    })
  }))
  if (!updated) {
    throw new Error('Card not found')
  }
  return updated
}

function targetStatus(
  status: WecirDevStatus,
  command: WecirDevControllerInstruction['command']
): WecirDevStatus | null {
  if (command === 'refresh') {
    return status
  }
  if (command === 'start') {
    return 'starting'
  }
  if (command === 'retry') {
    return 'queued'
  }
  if (command === 'stop' || command === 'mark_stale') {
    return 'stale'
  }
  if (command === 'remove') {
    return 'removed'
  }
  if (command === 'approve_merge') {
    return 'completed'
  }
  return null
}

export function issueWecirDevCardInstruction(
  cardId: string,
  command: WecirDevControllerInstruction['command']
): WecirDevCardRecord {
  let updated: WecirDevCardRecord | null = null
  updateWecirDevCardSnapshot((current) => {
    const card = current.cards.find((candidate) => candidate.cardId === cardId)
    if (!card) {
      throw new Error('Card not found')
    }
    const nextStatus = targetStatus(card.status, command)
    if (
      !nextStatus ||
      (nextStatus !== card.status && !isValidWecirDevStatusTransition(card.status, nextStatus))
    ) {
      throw new Error(`Cannot ${command} a ${card.status} card`)
    }
    const now = new Date().toISOString()
    const instruction: WecirDevControllerInstruction = {
      schemaVersion: WECIR_DEV_SCHEMA_VERSION,
      instructionId: createWecirDevCardDataId('instruction'),
      cardId,
      command,
      expectedStatus: card.status
    }
    updated = WecirDevCardRecordSchema.parse({
      ...card,
      status: nextStatus,
      updatedAt: now,
      ...(nextStatus === 'queued' ? { queuedAt: now } : {}),
      ...(nextStatus === 'starting' ? { startedAt: now } : {}),
      ...(nextStatus === 'completed' ? { completedAt: now } : {})
    })
    return {
      ...current,
      cards: current.cards.map((candidate) => (candidate.cardId === cardId ? updated! : candidate)),
      instructions: [instruction, ...current.instructions].slice(0, 1000)
    }
  })
  return updated!
}

export function deleteWecirDevCard(cardId: string): void {
  updateWecirDevCardSnapshot((current) => ({
    ...current,
    cards: current.cards.filter((card) => card.cardId !== cardId),
    shares: current.shares.filter((share) => share.cardId !== cardId)
  }))
}
