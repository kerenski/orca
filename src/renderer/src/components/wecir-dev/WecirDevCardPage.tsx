import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { LayoutGrid, LayoutTemplate, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { getLocalPreflightContext, localPreflightContextKey } from '@/lib/local-preflight-context'
import { useAppStore } from '@/store'
import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import type {
  WecirDevCardRecord,
  WecirDevControllerInstruction
} from '../../../../shared/wecir-dev/contracts'
import { WecirDevCardCreateDialog } from './WecirDevCardCreateDialog'
import { WecirDevCardEditPage } from './WecirDevCardEditPage'
import { WecirDevCardEmptyState, resolveWecirDevCardPageState } from './WecirDevCardEmptyState'
import { WecirDevCardList, type WecirDevStatusFilter } from './WecirDevCardList'
import { WecirDevCardShareDialog } from './WecirDevCardShareDialog'
import { WecirDevTemplateManagerDialog } from './WecirDevTemplateManagerDialog'
import {
  deleteWecirDevCard,
  issueWecirDevCardInstruction,
  listWecirDevCards,
  useWecirDevCardData
} from './wecir-dev-card-data-source'
import type { WecirDevCardTemplate } from './wecir-dev-card-templates'

export default function WecirDevCardPage(): React.JSX.Element {
  const repos = useAppStore((state) => state.repos)
  const closeWecirDevCardPage = useAppStore((state) => state.closeWecirDevCardPage)
  const openModal = useAppStore((state) => state.openModal)
  const openSettingsPage = useAppStore((state) => state.openSettingsPage)
  const openSettingsTarget = useAppStore((state) => state.openSettingsTarget)
  const selectedRepositoryId = useAppStore((state) => state.wecirDevCardRepositoryId)
  const setSelectedRepositoryId = useAppStore((state) => state.setWecirDevCardRepositoryId)
  const preflightStatus = useAppStore((state) => state.preflightStatus)
  const preflightStatusChecked = useAppStore((state) => state.preflightStatusChecked)
  const preflightStatusContextKey = useAppStore((state) => state.preflightStatusContextKey)
  const preflightStatusLoading = useAppStore((state) => state.preflightStatusLoading)
  const preflightStatusError = useAppStore((state) => state.preflightStatusError)
  const refreshPreflightStatus = useAppStore((state) => state.refreshPreflightStatus)
  const cardData = useWecirDevCardData()
  const [statusFilter, setStatusFilter] = useState<WecirDevStatusFilter>('all')
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [createTemplate, setCreateTemplate] = useState<WecirDevCardTemplate | null>(null)
  const [editingCard, setEditingCard] = useState<WecirDevCardRecord | null>(null)
  const [sharingCard, setSharingCard] = useState<WecirDevCardRecord | null>(null)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const expectedPreflightContextKey = useAppStore((state) =>
    localPreflightContextKey(getLocalPreflightContext(state))
  )
  const localRepositories = repos.filter(
    (repo) =>
      isGitRepoKind(repo) && getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID && repo.path
  )
  const selectedRepository =
    localRepositories.find((repo) => repo.id === selectedRepositoryId) ??
    localRepositories[0] ??
    null
  const preflightCurrent = preflightStatusContextKey === expectedPreflightContextKey
  const pageState = resolveWecirDevCardPageState({
    localRepositoryCount: localRepositories.length,
    preflightCurrent,
    preflightChecked: preflightStatusChecked,
    preflightLoading: preflightStatusLoading,
    preflightError: preflightStatusError,
    githubInstalled: preflightStatus?.gh.installed === true,
    githubAuthenticated: preflightStatus?.gh.authenticated === true
  })
  const cardPage = listWecirDevCards({
    snapshot: cardData,
    repositoryId: selectedRepository?.id,
    status: statusFilter === 'all' ? undefined : statusFilter,
    page,
    pageSize: 8
  })

  useEffect(() => {
    if (selectedRepositoryId !== selectedRepository?.id) {
      setSelectedRepositoryId(selectedRepository?.id ?? null)
    }
  }, [selectedRepository?.id, selectedRepositoryId, setSelectedRepositoryId])

  useEffect(() => {
    if (
      localRepositories.length > 0 &&
      (!preflightCurrent || !preflightStatusChecked) &&
      !preflightStatusLoading
    ) {
      void refreshPreflightStatus()
    }
  }, [
    localRepositories.length,
    preflightCurrent,
    preflightStatusChecked,
    preflightStatusLoading,
    refreshPreflightStatus
  ])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return
      }
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }
      event.preventDefault()
      closeWecirDevCardPage()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeWecirDevCardPage])

  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil(cardPage.total / cardPage.pageSize))
    if (page > lastPage) {
      setPage(lastPage)
    }
  }, [cardPage.pageSize, cardPage.total, page])

  const openIntegrations = (): void => {
    openSettingsTarget({ pane: 'integrations', repoId: selectedRepository?.id ?? null })
    openSettingsPage()
  }

  const runInstruction = (
    card: WecirDevCardRecord,
    command: WecirDevControllerInstruction['command']
  ): void => {
    try {
      issueWecirDevCardInstruction(card.cardId, command)
      toast.success(
        command === 'refresh' ? 'Card status refreshed' : `Card command recorded: ${command}`
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Card command failed')
    }
  }

  return (
    <main className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-10 shrink-0 items-center gap-2 px-5 md:px-8">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-full"
              onClick={closeWecirDevCardPage}
              aria-label={translate(
                'auto.components.wecirDev.WecirDevCardPage.closeCards',
                'Close cards'
              )}
            >
              <X className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {translate('auto.components.wecirDev.WecirDevCardPage.closeHint', 'Close · Esc')}
          </TooltipContent>
        </Tooltip>
        <div className="h-5 w-px bg-border/50" aria-hidden />
        <LayoutGrid className="size-4 text-muted-foreground" />
        <h1 className="truncate text-sm font-semibold">
          {translate('auto.components.wecirDev.WecirDevCardPage.title', 'Cards')}
        </h1>
        {pageState === 'ready' ? (
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="xs" onClick={() => setTemplatesOpen(true)}>
              <LayoutTemplate />
              Templates
            </Button>
            <Button
              size="xs"
              onClick={() => {
                setCreateTemplate(null)
                setCreateOpen(true)
              }}
            >
              <Plus />
              New card
            </Button>
          </div>
        ) : null}
      </header>
      {pageState === 'ready' ? (
        <>
          <div className="flex shrink-0 items-center gap-3 px-5 pb-3 md:px-8">
            <span className="text-xs text-muted-foreground">Repository</span>
            <Select
              value={selectedRepository?.id}
              onValueChange={(repositoryId) => {
                setSelectedRepositoryId(repositoryId)
                setPage(1)
              }}
            >
              <SelectTrigger size="sm" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                {localRepositories.map((repository) => (
                  <SelectItem key={repository.id} value={repository.id}>
                    {repository.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <WecirDevCardList
            page={cardPage}
            statusFilter={statusFilter}
            onStatusFilterChange={(status) => {
              setStatusFilter(status)
              setPage(1)
            }}
            onPageChange={setPage}
            onCreate={() => {
              setCreateTemplate(null)
              setCreateOpen(true)
            }}
            onEdit={setEditingCard}
            onShare={setSharingCard}
            onInstruction={runInstruction}
            onDelete={(card) => {
              deleteWecirDevCard(card.cardId)
              toast.success('Card deleted')
            }}
          />
          <WecirDevCardCreateDialog
            open={createOpen}
            repositories={localRepositories}
            template={createTemplate}
            onOpenChange={setCreateOpen}
            onCreated={() => {
              setStatusFilter('all')
              setPage(1)
              toast.success('Development card created')
            }}
          />
          <WecirDevCardEditPage
            card={editingCard}
            repositories={localRepositories}
            onClose={() => setEditingCard(null)}
          />
          <WecirDevTemplateManagerDialog
            open={templatesOpen}
            repositories={localRepositories}
            templates={cardData.templates}
            onOpenChange={setTemplatesOpen}
            onUseTemplate={(template) => {
              setCreateTemplate(template)
              setTemplatesOpen(false)
              setCreateOpen(true)
            }}
          />
          <WecirDevCardShareDialog
            key={sharingCard?.cardId ?? 'closed'}
            card={sharingCard}
            shares={cardData.shares}
            onClose={() => setSharingCard(null)}
          />
        </>
      ) : (
        <WecirDevCardEmptyState
          state={pageState}
          onAddRepository={() => openModal('add-repo')}
          onOpenIntegrations={openIntegrations}
          onRetry={() => void refreshPreflightStatus({ force: true })}
        />
      )}
    </main>
  )
}
