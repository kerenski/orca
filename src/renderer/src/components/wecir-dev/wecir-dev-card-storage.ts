import { useSyncExternalStore } from 'react'
import { z } from 'zod'
import {
  WECIR_DEV_SCHEMA_VERSION,
  type WecirDevCardRecord,
  type WecirDevControllerInstruction
} from '../../../../shared/wecir-dev/contracts'
import {
  WecirDevCardRecordSchema,
  WecirDevControllerInstructionSchema
} from '../../../../shared/wecir-dev/schemas'
import { WecirDevCardShareSchema, type WecirDevCardShare } from './wecir-dev-card-share-model'
import {
  WecirDevCardTemplateSchema,
  type WecirDevCardTemplate
} from './wecir-dev-card-template-model'

export const WECIR_DEV_CARD_STORAGE_KEY = 'orca:wecir-dev:card-data:v1'
const CHANGE_EVENT = 'orca:wecir-dev-card-data-changed'

export type WecirDevCardDataSnapshot = {
  schemaVersion: typeof WECIR_DEV_SCHEMA_VERSION
  cards: WecirDevCardRecord[]
  templates: WecirDevCardTemplate[]
  shares: WecirDevCardShare[]
  instructions: WecirDevControllerInstruction[]
}

const SnapshotSchema = z
  .object({
    schemaVersion: z.literal(WECIR_DEV_SCHEMA_VERSION),
    cards: z.array(WecirDevCardRecordSchema),
    templates: z.array(WecirDevCardTemplateSchema),
    shares: z.array(WecirDevCardShareSchema),
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

export function createWecirDevCardDataId(prefix: string): string {
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

export function updateWecirDevCardSnapshot(
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
