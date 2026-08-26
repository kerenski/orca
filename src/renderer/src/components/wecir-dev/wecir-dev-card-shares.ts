import { WECIR_DEV_SCHEMA_VERSION } from '../../../../shared/wecir-dev/contracts'
import { WecirDevCardShareSchema, type WecirDevCardShare } from './wecir-dev-card-share-model'
import { createWecirDevCardDataId, updateWecirDevCardSnapshot } from './wecir-dev-card-storage'

export { WecirDevCardShareSchema, type WecirDevCardShare } from './wecir-dev-card-share-model'

export function shareWecirDevCard(cardId: string, recipient: string): WecirDevCardShare {
  const normalizedRecipient = recipient.trim()
  if (!normalizedRecipient) {
    throw new Error('Recipient is required')
  }
  let saved: WecirDevCardShare | null = null
  updateWecirDevCardSnapshot((current) => {
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
      WecirDevCardShareSchema.parse({
        schemaVersion: WECIR_DEV_SCHEMA_VERSION,
        shareId: createWecirDevCardDataId('share'),
        cardId,
        recipient: normalizedRecipient,
        sharedAt: new Date().toISOString()
      })
    return existing ? current : { ...current, shares: [saved, ...current.shares] }
  })
  return saved!
}

export function revokeWecirDevCardShare(shareId: string): void {
  updateWecirDevCardSnapshot((current) => ({
    ...current,
    shares: current.shares.filter((share) => share.shareId !== shareId)
  }))
}
