import type { Store } from '../persistence'
import { getGitHubRepoConnectionId } from '../ipc/github-repo-routing'
import { getLocalPtyProvider } from '../ipc/pty'
import { getGitHubDataBatch, listGitHubData } from './github-data-adapter'
import { ControllerMonitor } from './controller-monitor'
import { createCardRunner } from './card-runner'
import type {
  WecirDevAnalyzeCardsArgs,
  WecirDevAnalyzeCardsResult,
  WecirDevGetCardStatusesArgs,
  WecirDevGetCardStatusesResult,
  WecirDevSendControllerCommandArgs,
  WecirDevSendControllerCommandResult,
  WecirDevServiceDependencies,
  WecirDevStartCardArgs,
  WecirDevStartCardResult,
  WecirDevStartCardsBatchArgs,
  WecirDevStartCardsBatchResult
} from './types'
import type { WecirDevCardRecord } from '../../shared/wecir-dev/contracts'
import { analyzeWecirDevDependencies } from '../../shared/wecir-dev/dependency-analysis'
import { buildAnalysisCards } from './analysis-card-priorities'
import {
  getGitHubSourceForItem,
  resolveGitHubOwner,
  resolveGitHubRepository
} from './analysis-support'
import {
  CONTROLLER_COMMANDS,
  buildCardStatuses,
  cardError,
  cardRecordKey,
  createCardRecord,
  requireLocalRepo,
  toCardError
} from './service-support'
export class WecirDevService {
  private readonly cards = new Map<string, WecirDevCardRecord>()
  private readonly monitor = new ControllerMonitor()
  private readonly runCard
  private readonly now
  private readonly modelAssist
  private readonly priorityConfig
  private readonly inFlight = new Map<string, Promise<WecirDevStartCardResult>>()
  private readonly abortControllers = new Map<string, AbortController>()
  private shuttingDown = false
  constructor(
    private readonly store: Store,
    dependencies: WecirDevServiceDependencies = {}
  ) {
    this.runCard = dependencies.runCard ?? createCardRunner()
    this.now = dependencies.now ?? (() => new Date().toISOString())
    this.modelAssist = dependencies.modelAssist
    this.priorityConfig = dependencies.priorityConfig
  }
  async analyzeCards(args: WecirDevAnalyzeCardsArgs): Promise<WecirDevAnalyzeCardsResult> {
    this.assertRunning()
    const repo = requireLocalRepo(this.store, args.repository.repositoryId, args.repository.path)
    const result = await listGitHubData({
      repoPath: repo.path,
      repoId: repo.id,
      limit: 200,
      query: args.query,
      connectionId: getGitHubRepoConnectionId(repo)
    })
    const selected = args.issueNumbers ? new Set(args.issueNumbers) : undefined
    const items = result.items.filter((item) => !selected || selected.has(item.number))
    const owner = resolveGitHubOwner(args.repository.owner, result.sources, items)
    const repository = resolveGitHubRepository(args.repository.name, result.sources, items)
    const detailArgs = items.map((item) => {
      const source = getGitHubSourceForItem(result.sources, item.type)
      return {
        repoPath: repo.path,
        repoId: repo.id,
        number: item.number,
        type: item.type,
        connectionId: getGitHubRepoConnectionId(repo),
        ...(source ? (item.type === 'issue' ? { issueRepo: source } : { prRepo: source }) : {})
      }
    })
    let detailItems: Awaited<ReturnType<typeof getGitHubDataBatch>>['items'] = []
    let failedDetails = new Set<number>()
    try {
      const details = await getGitHubDataBatch(detailArgs)
      detailItems = details.items
      failedDetails = new Set(details.errors.map((error) => error.number))
    } catch {
      failedDetails = new Set(items.map((item) => item.number))
    }
    const detailsByIssue = new Map(detailItems.map((detail) => [detail.item.number, detail]))
    const analyzedItems = items.map((item) => {
      const detail = detailsByIssue.get(item.number)
      if (!detail) {
        return item
      }
      return {
        ...item,
        ...detail.item,
        labels: detail.item.labels ?? item.labels,
        references: detail.references
      }
    })
    const dependencyItems = analyzedItems.map((item) => {
      const detail = detailsByIssue.get(item.number)
      return {
        number: item.number,
        title: detail?.item.title ?? item.title,
        body: detail?.body,
        labels: detail?.item.labels ?? item.labels,
        comments: detail?.comments.latest ? [detail.comments.latest.body] : undefined,
        references: item.references
      }
    })
    const dependencyByIssue = new Map(
      analyzeWecirDevDependencies(dependencyItems, { owner, repository }).map((analysis) => [
        analysis.issueNumber,
        analysis
      ])
    )
    const analyzedAt = this.now()
    const usedNames = new Set(
      [...this.cards.values()]
        .filter((card) => card.repository.repositoryId === args.repository.repositoryId)
        .map((card) => card.name)
    )
    const cards = await buildAnalysisCards({
      items: analyzedItems,
      repository: args.repository,
      owner,
      repositoryName: repository,
      analyzedAt,
      now: this.now,
      usedNames,
      failedDetails,
      dependencyByIssue,
      modelAssist: this.modelAssist,
      priorityConfig: args.priorityConfig ?? this.priorityConfig
    })
    for (const card of cards) {
      const key = cardRecordKey(card.repository.repositoryId, card.cardId)
      const existing = this.cards.get(key)
      if (existing) {
        card.priority = existing.priority
      }
      this.cards.set(key, card)
    }
    return { cards, analyzedAt }
  }
  async startCard(args: WecirDevStartCardArgs): Promise<WecirDevStartCardResult> {
    if (this.shuttingDown) {
      throw cardError('unknown', 'Wecir Dev service is shutting down', false)
    }
    const repo = requireLocalRepo(this.store, args.repository.repositoryId, args.repository.path)
    const key = cardRecordKey(repo.id, `${args.issueNumber}:${args.card}`)
    const existing = this.inFlight.get(key)
    if (existing) {
      return existing
    }
    const controller = new AbortController()
    const operation = this.startCardInternal(args, repo.id, repo.path, controller.signal)
    this.inFlight.set(key, operation)
    this.abortControllers.set(key, controller)
    try {
      return await operation
    } finally {
      this.inFlight.delete(key)
      this.abortControllers.delete(key)
    }
  }
  async startCardsBatch(args: WecirDevStartCardsBatchArgs): Promise<WecirDevStartCardsBatchResult> {
    requireLocalRepo(this.store, args.repository.repositoryId, args.repository.path)
    const items: WecirDevStartCardsBatchResult['items'] = []
    let stoppedOnFailure = false
    for (const cardArgs of args.cards) {
      try {
        const result = await this.startCard({ ...cardArgs, repository: args.repository })
        items.push({ issueNumber: cardArgs.issueNumber, ok: true, card: result.card })
      } catch (error) {
        items.push({ issueNumber: cardArgs.issueNumber, ok: false, error: toCardError(error) })
        stoppedOnFailure = true
        break
      }
    }
    return { items, stoppedOnFailure }
  }
  getCardStatuses(args: WecirDevGetCardStatusesArgs): WecirDevGetCardStatusesResult {
    this.assertRunning()
    requireLocalRepo(this.store, args.repositoryId)
    return buildCardStatuses(this.cards.values(), args)
  }
  async sendControllerCommand(
    args: WecirDevSendControllerCommandArgs
  ): Promise<WecirDevSendControllerCommandResult> {
    this.assertRunning()
    requireLocalRepo(this.store, args.repositoryId)
    const card = this.findCard(args.repositoryId, args.cardId)
    const handle = card.controllerHandle
    if (!handle || !this.monitor.matches(card.cardId, args.repositoryId, handle)) {
      throw cardError('pty_binding_lost', 'Controller PTY binding is no longer valid', false)
    }
    if (args.expectedStatus && card.status !== args.expectedStatus) {
      throw cardError('invalid_parameters', 'Card status does not match expected status', false)
    }
    const command = CONTROLLER_COMMANDS[args.command]
    if (!command) {
      throw cardError('invalid_parameters', 'Unsupported controller command', false)
    }
    const provider = getLocalPtyProvider()
    const accepted = provider.writeWithSettlement
      ? await provider.writeWithSettlement(handle, `${command}\n`)
      : provider.write(handle, `${command}\n`) !== false
    if (!accepted) {
      throw cardError('pty_binding_lost', 'Controller PTY rejected the command', true)
    }
    return { card, accepted: true }
  }
  shutdown(): void {
    this.shuttingDown = true
    this.monitor.clear()
    for (const controller of this.abortControllers.values()) {
      controller.abort()
    }
  }
  private async startCardInternal(
    args: WecirDevStartCardArgs,
    repositoryId: string,
    repositoryPath: string,
    signal: AbortSignal
  ): Promise<WecirDevStartCardResult> {
    const existing = [...this.cards.values()].find(
      (card) =>
        card.repository.repositoryId === repositoryId &&
        card.reference.number === args.issueNumber &&
        card.name === args.card
    )
    const sameName = [...this.cards.values()].some(
      (card) => card.repository.repositoryId === repositoryId && card.name === args.card
    )
    if (sameName && (!existing || !args.force)) {
      throw cardError('worktree_invalid', 'A card with this name already exists', false)
    }
    const card =
      existing && args.force
        ? { ...existing, status: 'starting' as const, updatedAt: this.now(), lastError: undefined }
        : createCardRecord(args.repository, args.issueNumber, args.card, 'issue', this.now)
    card.status = 'starting'
    card.startedAt = this.now()
    card.updatedAt = card.startedAt
    this.cards.set(cardRecordKey(repositoryId, card.cardId), card)
    try {
      const result = await this.runCard({
        issueNumber: args.issueNumber,
        card: args.card,
        tier: args.tier ?? 'medium',
        cwd: repositoryPath,
        force: args.force,
        signal
      })
      const updated: WecirDevCardRecord = {
        ...card,
        status: 'controller_ready',
        controllerHandle: result.controllerPtyId,
        ...(result.workerAgent ? { workerHandle: result.workerAgent } : {}),
        ...(result.worktreePath ? { worktreePath: result.worktreePath } : {}),
        updatedAt: this.now()
      }
      this.cards.set(cardRecordKey(repositoryId, updated.cardId), updated)
      this.monitor.set({
        repositoryId,
        cardId: updated.cardId,
        controllerPtyId: result.controllerPtyId,
        ...(result.worktreeId ? { worktreeId: result.worktreeId } : {}),
        status: updated.status,
        updatedAt: updated.updatedAt
      })
      return { card: updated }
    } catch (error) {
      const failed = {
        ...card,
        status: 'failed' as const,
        lastError: toCardError(error),
        updatedAt: this.now()
      }
      this.cards.set(cardRecordKey(repositoryId, failed.cardId), failed)
      throw error
    }
  }
  private findCard(repositoryId: string, cardId: string): WecirDevCardRecord {
    const card = this.cards.get(cardRecordKey(repositoryId, cardId))
    if (!card) {
      throw cardError('invalid_parameters', 'Card was not found', false)
    }
    return card
  }
  private assertRunning(): void {
    if (this.shuttingDown) {
      throw cardError('unknown', 'Wecir Dev service is shutting down', false)
    }
  }
}
