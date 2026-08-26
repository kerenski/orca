import { useEffect } from 'react'
import {
  CircleAlert,
  FolderGit2,
  Github,
  LayoutGrid,
  LoaderCircle,
  Plus,
  RefreshCw,
  Settings2,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { getLocalPreflightContext, localPreflightContextKey } from '@/lib/local-preflight-context'
import { useAppStore } from '@/store'
import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { isGitRepoKind } from '../../../../shared/repo-kind'

export type WecirDevCardPageState =
  | 'no-repositories'
  | 'checking-github'
  | 'github-check-failed'
  | 'github-cli-missing'
  | 'github-auth-required'
  | 'ready'

export function resolveWecirDevCardPageState(args: {
  localRepositoryCount: number
  preflightCurrent: boolean
  preflightChecked: boolean
  preflightLoading: boolean
  preflightError: string | null
  githubInstalled: boolean
  githubAuthenticated: boolean
}): WecirDevCardPageState {
  if (args.localRepositoryCount === 0) {
    return 'no-repositories'
  }
  if (args.preflightLoading || !args.preflightChecked || !args.preflightCurrent) {
    return 'checking-github'
  }
  if (args.preflightError) {
    return 'github-check-failed'
  }
  if (!args.githubInstalled) {
    return 'github-cli-missing'
  }
  if (!args.githubAuthenticated) {
    return 'github-auth-required'
  }
  return 'ready'
}

function WecirDevCardEmptyState({
  state,
  onAddRepository,
  onOpenIntegrations,
  onRetry
}: {
  state: WecirDevCardPageState
  onAddRepository: () => void
  onOpenIntegrations: () => void
  onRetry: () => void
}): React.JSX.Element {
  const content = {
    'no-repositories': {
      icon: FolderGit2,
      title: translate(
        'auto.components.wecirDev.WecirDevCardPage.noRepositoriesTitle',
        'No local Git repositories'
      ),
      description: translate(
        'auto.components.wecirDev.WecirDevCardPage.noRepositoriesDescription',
        'Add a local Git repository before creating development cards.'
      ),
      action: (
        <Button size="sm" onClick={onAddRepository} className="gap-1.5">
          <Plus className="size-3.5" />
          {translate('auto.components.wecirDev.WecirDevCardPage.addRepository', 'Add repository')}
        </Button>
      )
    },
    'checking-github': {
      icon: LoaderCircle,
      title: translate(
        'auto.components.wecirDev.WecirDevCardPage.checkingGitHubTitle',
        'Checking GitHub access'
      ),
      description: translate(
        'auto.components.wecirDev.WecirDevCardPage.checkingGitHubDescription',
        'Orca is checking the GitHub CLI on this execution host.'
      ),
      action: null
    },
    'github-check-failed': {
      icon: CircleAlert,
      title: translate(
        'auto.components.wecirDev.WecirDevCardPage.githubCheckFailedTitle',
        'GitHub access could not be checked'
      ),
      description: translate(
        'auto.components.wecirDev.WecirDevCardPage.githubCheckFailedDescription',
        'Retry the integration check before loading development cards.'
      ),
      action: (
        <Button variant="outline" size="sm" onClick={onRetry} className="gap-1.5">
          <RefreshCw className="size-3.5" />
          {translate('auto.components.wecirDev.WecirDevCardPage.retry', 'Retry')}
        </Button>
      )
    },
    'github-cli-missing': {
      icon: Github,
      title: translate(
        'auto.components.wecirDev.WecirDevCardPage.githubCliMissingTitle',
        'GitHub CLI is not installed'
      ),
      description: translate(
        'auto.components.wecirDev.WecirDevCardPage.githubCliMissingDescription',
        'Install and authenticate the GitHub CLI before loading development cards.'
      ),
      action: (
        <Button variant="outline" size="sm" onClick={onOpenIntegrations} className="gap-1.5">
          <Settings2 className="size-3.5" />
          {translate(
            'auto.components.wecirDev.WecirDevCardPage.openIntegrations',
            'Open Integrations'
          )}
        </Button>
      )
    },
    'github-auth-required': {
      icon: Github,
      title: translate(
        'auto.components.wecirDev.WecirDevCardPage.githubAuthRequiredTitle',
        'GitHub authentication required'
      ),
      description: translate(
        'auto.components.wecirDev.WecirDevCardPage.githubAuthRequiredDescription',
        'Authenticate the GitHub CLI before loading development cards.'
      ),
      action: (
        <Button variant="outline" size="sm" onClick={onOpenIntegrations} className="gap-1.5">
          <Settings2 className="size-3.5" />
          {translate(
            'auto.components.wecirDev.WecirDevCardPage.openIntegrations',
            'Open Integrations'
          )}
        </Button>
      )
    },
    ready: {
      icon: LayoutGrid,
      title: translate(
        'auto.components.wecirDev.WecirDevCardPage.readyTitle',
        'No development cards yet'
      ),
      description: translate(
        'auto.components.wecirDev.WecirDevCardPage.readyDescription',
        'Development cards for the selected repository will appear here.'
      ),
      action: null
    }
  } satisfies Record<
    WecirDevCardPageState,
    {
      icon: typeof LayoutGrid
      title: string
      description: string
      action: React.ReactNode
    }
  >
  const selected = content[state]
  const Icon = selected.icon

  return (
    <section
      className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-10 text-center"
      data-testid="wecir-dev-card-empty-state"
      data-state={state}
    >
      <div className="flex size-10 items-center justify-center rounded-md border border-border bg-muted/30">
        <Icon
          className={`size-5 text-muted-foreground${state === 'checking-github' ? ' animate-spin' : ''}`}
        />
      </div>
      <h2 className="mt-4 text-sm font-semibold text-foreground">{selected.title}</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{selected.description}</p>
      {selected.action ? <div className="mt-4">{selected.action}</div> : null}
    </section>
  )
}

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

  const openIntegrations = (): void => {
    openSettingsTarget({ pane: 'integrations', repoId: selectedRepository?.id ?? null })
    openSettingsPage()
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
      </header>
      <WecirDevCardEmptyState
        state={pageState}
        onAddRepository={() => openModal('add-repo')}
        onOpenIntegrations={openIntegrations}
        onRetry={() => void refreshPreflightStatus({ force: true })}
      />
    </main>
  )
}
