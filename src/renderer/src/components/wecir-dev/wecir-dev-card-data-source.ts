import { useSyncExternalStore } from 'react'
import { z } from 'zod'
import {
  WECIR_DEV_PRIORITIES,
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
import {
  WecirDevCardNameSchema,
  WecirDevCardRecordSchema,
  WecirDevControllerInstructionSchema
} from '../../../../shared/wecir-dev/schemas'

export const WECIR_DEV_CARD_STORAGE_KEY = 'orca:wecir-dev:card-data:v1'
const CHANGE_EVENT = 'orca:wecir-dev-card-data-changed'

export type WecirDevCardDraft = {
  name: string
  repository: WecirDevRepositorySelection
  reference: WecirDevIssueReference
  priority: WecirDevPriority
  dependencies: WecirDevDependencyRelation[]
  analysis?: WecirDevAnalysisResult
}

export type WecirDevCardTemplate = {
  schemaVersion: typeof WECIR_DEV_SCHEMA_VERSION
  templateId: string
  name: string
  cardName: string
  repositoryId?: string
  referenceKind: WecirDevIssueReference['kind']
  priority: WecirDevPriority
  owner?: string
  repository?: string
  createdAt: string
  updatedAt: string
}

export type WecirDevCardTemplateDraft = Omit<
  WecirDevCardTemplate,
  'schemaVersion' | 'templateId' | 'createdAt' | 'updatedAt'
>

export type WecirDevCardShare = {
  schemaVersion: typeof WECIR_DEV_SCHEMA_VERSION
  shareId: string
  cardId: string
  recipient: string
  sharedAt: string
}

export type WecirDevCardDataSnapshot = {
  schemaVersion: typeof WECIR_DEV_SCHEMA_VERSION
  cards: WecirDevCardRecord[]
  templates: WecirDevCardTemplate[]
  shares: WecirDevCardShare[]
  instructions: WecirDevControllerInstruction[]
}

const TemplateSchema: z.ZodType<WecirDevCardTemplate> = z
  .object({
    schemaVersion: z.literal(WECIR_DEV_SCHEMA_VERSION),
    templateId: z.string().min(1).max(128),
    name: z.string().min(1).max(100),
    cardName: WecirDevCardNameSchema,
    repositoryId: z.string().min(1).max(128).optional(),
    referenceKind: z.enum(['issue', 'pull_request']),
    priority: z.enum(WECIR_DEV_PRIORITIES),
    owner: z.string().min(1).max(100).optional(),
    repository: z.string().min(1).max(100).optional(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true })
  })
  .strict()

const ShareSchema: z.ZodType<WecirDevCardShare> = z
  .object({
    schemaVersion: z.literal(WECIR_DEV_SCHEMA_VERSION),
    shareId: z.string().min(1).max(128),
    cardId: z.string().min(1).max(128),
    recipient: z.string().min(1).max(320),
    sharedAt: z.iso.datetime({ offset: true })
  })
  .strict()

const SnapshotSchema = z
  .object({
    schemaVersion: z.literal(WECIR_DEV_SCHEMA_VERSION),
    cards: z.array(WecirDevCardRecordSchema),
    templates: z.array(TemplateSchema),
    shares: z.array(ShareSchema),
    instructions: z.array(WecirDevControllerInstructionSchema).max(1000)
  })
  .strict()

const EMPTY_SNAPSHOT: WecirDevCardDataSnapshot = {
  schemaVersion: WECIR_DEV_SCHEMA_VERSION,
  cards: [],
  templates: [],
  shares: [],
  instructions: []
}

let cachedRaw: string | null | undefined
let cachedSnapshot = EMPTY_SNAPSHOT

function storage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage
}

function createId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
  return `${prefix}-${random}`
}

function readSnapshot(): WecirDevCardDataSnapshot {
  const raw = storage()?.getItem(WECIR_DEV_CARD_STORAGE_KEY) ?? null
  if (raw === cachedRaw) {
    return cachedSnapshot
  }
  cachedRaw = raw
  if (!raw) {
    cachedSnapshot = EMPTY_SNAPSHOT
    return cachedSnapshot
  }
  try {
    const parsed = SnapshotSchema.safeParse(JSON.parse(raw))
    cachedSnapshot = parsed.success ? parsed.data : EMPTY_SNAPSHOT
  } catch {
    cachedSnapshot = EMPTY_SNAPSHOT
  }
  return cachedSnapshot
}

function writeSnapshot(next: WecirDevCardDataSnapshot): void {
  const raw = JSON.stringify(next)
  storage()?.setItem(WECIR_DEV_CARD_STORAGE_KEY, raw)
  cachedRaw = raw
  cachedSnapshot = next
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

function updateSnapshot(
  updater: (current: WecirDevCardDataSnapshot) => WecirDevCardDataSnapshot
): WecirDevCardDataSnapshot {
  const next = updater(readSnapshot())
  writeSnapshot(next)
  return next
}

function subscribe(listener: () => void): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.key === WECIR_DEV_CARD_STORAGE_KEY) {
      cachedRaw = undefined
      listener()
    }
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener(CHANGE_EVENT, listener)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(CHANGE_EVENT, listener)
  }
}

export function useWecirDevCardData(): WecirDevCardDataSnapshot {
  return useSyncExternalStore(subscribe, readSnapshot, () => EMPTY_SNAPSHOT)
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
    cardId: createId('card'),
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    queuedAt: now
  })
  updateSnapshot((current) => ({ ...current, cards: [card, ...current.cards] }))
  return card
}

export function updateWecirDevCard(cardId: string, draft: WecirDevCardDraft): WecirDevCardRecord {
  let updated: WecirDevCardRecord | null = null
  updateSnapshot((current) => ({
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
  updateSnapshot((current) => {
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
      instructionId: createId('instruction'),
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
  updateSnapshot((current) => ({
    ...current,
    cards: current.cards.filter((card) => card.cardId !== cardId),
    shares: current.shares.filter((share) => share.cardId !== cardId)
  }))
}

export function saveWecirDevCardTemplate(
  draft: WecirDevCardTemplateDraft,
  templateId?: string
): WecirDevCardTemplate {
  const now = new Date().toISOString()
  let saved: WecirDevCardTemplate | null = null
  updateSnapshot((current) => {
    const existing = templateId
      ? current.templates.find((template) => template.templateId === templateId)
      : undefined
    saved = TemplateSchema.parse({
      ...draft,
      schemaVersion: WECIR_DEV_SCHEMA_VERSION,
      templateId: existing?.templateId ?? createId('template'),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    })
    return {
      ...current,
      templates: existing
        ? current.templates.map((template) =>
            template.templateId === existing.templateId ? saved! : template
          )
        : [saved, ...current.templates]
    }
  })
  return saved!
}

export function deleteWecirDevCardTemplate(templateId: string): void {
  updateSnapshot((current) => ({
    ...current,
    templates: current.templates.filter((template) => template.templateId !== templateId)
  }))
}

export function shareWecirDevCard(cardId: string, recipient: string): WecirDevCardShare {
  const normalizedRecipient = recipient.trim()
  if (!normalizedRecipient) {
    throw new Error('Recipient is required')
  }
  let saved: WecirDevCardShare | null = null
  updateSnapshot((current) => {
    if (!current.cards.some((card) => card.cardId === cardId)) {
      throw new Error('Card not found')
    }
    const existing = current.shares.find(
      (share) =>
        share.cardId === cardId &&
        share.recipient.toLowerCase() === normalizedRecipient.toLowerCase()
    )
    saved =
      existing ??
      ShareSchema.parse({
        schemaVersion: WECIR_DEV_SCHEMA_VERSION,
        shareId: createId('share'),
        cardId,
        recipient: normalizedRecipient,
        sharedAt: new Date().toISOString()
      })
    return existing ? current : { ...current, shares: [saved, ...current.shares] }
  })
  return saved!
}

export function revokeWecirDevCardShare(shareId: string): void {
  updateSnapshot((current) => ({
    ...current,
    shares: current.shares.filter((share) => share.shareId !== shareId)
  }))
}
