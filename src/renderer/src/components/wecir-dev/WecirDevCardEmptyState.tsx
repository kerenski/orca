import {
  CircleAlert,
  FolderGit2,
  Github,
  LayoutGrid,
  LoaderCircle,
  Plus,
  RefreshCw,
  Settings2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'

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

export function WecirDevCardEmptyState({
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
    { icon: typeof LayoutGrid; title: string; description: string; action: React.ReactNode }
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
