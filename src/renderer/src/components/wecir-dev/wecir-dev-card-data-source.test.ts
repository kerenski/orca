// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest'
import { WECIR_DEV_SCHEMA_VERSION } from '../../../../shared/wecir-dev/contracts'
import {
  WECIR_DEV_CARD_STORAGE_KEY,
  createWecirDevCard,
  deleteWecirDevCard,
  issueWecirDevCardInstruction,
  listWecirDevCards,
  saveWecirDevCardTemplate,
  shareWecirDevCard,
  updateWecirDevCard,
  type WecirDevCardDataSnapshot,
  type WecirDevCardDraft
} from './wecir-dev-card-data-source'

function draft(name: string, repositoryId = 'repo-1'): WecirDevCardDraft {
  return {
    name,
    repository: {
      repositoryId,
      path: `/tmp/${repositoryId}`,
      executionHost: 'local',
      provider: 'github',
      owner: 'kerenski',
      name: 'orca'
    },
    reference: {
      kind: 'issue',
      number: 62,
      owner: 'kerenski',
      repository: 'orca'
    },
    priority: 'high',
    dependencies: []
  }
}

function snapshot(): WecirDevCardDataSnapshot {
  return JSON.parse(localStorage.getItem(WECIR_DEV_CARD_STORAGE_KEY) ?? '{}')
}

describe('wecir dev card data source', () => {
  beforeEach(() => localStorage.clear())

  it('persists, pages, filters, updates and deletes cards', () => {
    const first = createWecirDevCard(draft('issue-62'))
    createWecirDevCard(draft('issue-63'))
    createWecirDevCard(draft('other-repo', 'repo-2'))

    const page = listWecirDevCards({
      snapshot: snapshot(),
      repositoryId: 'repo-1',
      status: 'queued',
      page: 1,
      pageSize: 1
    })
    expect(page).toMatchObject({ total: 2, page: 1, pageSize: 1, hasNext: true })

    const updated = updateWecirDevCard(first.cardId, {
      ...draft('issue-62-edited'),
      priority: 'critical'
    })
    expect(updated).toMatchObject({ name: 'issue-62-edited', priority: 'critical' })

    deleteWecirDevCard(first.cardId)
    expect(snapshot().cards.some((card) => card.cardId === first.cardId)).toBe(false)
  })

  it('records controller instructions with valid status transitions', () => {
    const card = createWecirDevCard(draft('issue-62'))
    expect(issueWecirDevCardInstruction(card.cardId, 'start').status).toBe('starting')
    expect(issueWecirDevCardInstruction(card.cardId, 'stop').status).toBe('stale')
    expect(issueWecirDevCardInstruction(card.cardId, 'retry').status).toBe('queued')
    expect(snapshot().instructions.map((instruction) => instruction.command)).toEqual([
      'retry',
      'stop',
      'start'
    ])
  })

  it('persists templates and card shares separately from legacy skill sharing', () => {
    const card = createWecirDevCard(draft('issue-62'))
    const template = saveWecirDevCardTemplate({
      name: 'High priority issue',
      cardName: 'high-priority-issue',
      repositoryId: 'repo-1',
      referenceKind: 'issue',
      priority: 'high',
      owner: 'kerenski',
      repository: 'orca'
    })
    const share = shareWecirDevCard(card.cardId, 'reviewer@example.com')

    expect(snapshot()).toMatchObject({
      schemaVersion: WECIR_DEV_SCHEMA_VERSION,
      templates: [{ templateId: template.templateId }],
      shares: [{ shareId: share.shareId, recipient: 'reviewer@example.com' }]
    })
    expect(localStorage.getItem(WECIR_DEV_CARD_STORAGE_KEY)).not.toContain('agent-skill-share')
  })
})
