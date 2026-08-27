import { useEffect, useMemo } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useAppStore } from '@/store'
import type { WecirDevRepositorySelection } from '../../../../shared/wecir-dev/contracts'
import { WecirDevCardPanel } from './WecirDevCardPanel'

function repositorySelection(repo: {
  id: string
  path: string
  displayName: string
}): WecirDevRepositorySelection {
  return {
    repositoryId: repo.id,
    path: repo.path,
    executionHost: 'local',
    provider: 'github',
    name: repo.displayName
  }
}

export default function WecirDevCardPage() {
  const repos = useAppStore((state) => state.repos)
  const repository = useAppStore((state) => state.currentRepository)
  const cards = useAppStore((state) => state.cards)
  const loadState = useAppStore((state) => state.cardLoadState)
  const error = useAppStore((state) => state.cardSyncError)
  const errorCode = useAppStore((state) => state.cardSyncErrorCode)
  const preflight = useAppStore((state) => state.preflightStatus)
  const preflightChecked = useAppStore((state) => state.preflightStatusChecked)
  const preflightLoading = useAppStore((state) => state.preflightStatusLoading)
  const preflightError = useAppStore((state) => state.preflightStatusError)
  const refreshPreflight = useAppStore((state) => state.refreshPreflightStatus)
  const lastSync = useAppStore((state) => state.lastCardSyncAt)
  const selectedIds = useAppStore((state) => state.selectedCardIds)
  const setRepository = useAppStore((state) => state.setCurrentRepository)
  const setRepositories = useAppStore((state) => state.setRepositories)
  const load = useAppStore((state) => state.loadWecirDevCards)
  const refresh = useAppStore((state) => state.refreshWecirDevCards)
  const toggle = useAppStore((state) => state.toggleWecirDevCard)
  const clear = useAppStore((state) => state.clearWecirDevCardSelection)
  const selections = useMemo(
    () => repos.filter((repo) => repo.kind !== 'folder').map(repositorySelection),
    [repos]
  )

  useEffect(() => {
    setRepositories(selections)
  }, [selections, setRepositories])
  useEffect(() => {
    if (!repository && selections[0]) {
      setRepository(selections[0])
    }
  }, [repository, selections, setRepository])
  useEffect(() => {
    if (repository && loadState === 'idle') {
      void load(repository)
    }
  }, [repository, loadState, load])
  useEffect(() => {
    void refreshPreflight()
  }, [refreshPreflight])

  const authLabel =
    preflightLoading || !preflightChecked
      ? 'GitHub：检查中'
      : preflightError
        ? 'GitHub：检查失败'
        : !preflight?.gh.installed
          ? 'GitHub：未配置'
          : preflight.gh.authenticated
            ? 'GitHub：已配置'
            : 'GitHub：认证失效'

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h1 className="text-lg font-semibold">Wecir Dev cards</h1>
          <p className="text-sm text-muted-foreground">Read-only card analysis workspace</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{authLabel}</span>
          {(preflightError || !preflight?.gh.authenticated) && !preflightLoading ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void refreshPreflight({ force: true })}
            >
              Retry auth check
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={!repository || loadState === 'loading' || loadState === 'refreshing'}
          >
            <RefreshCw className={loadState === 'refreshing' ? 'animate-spin' : ''} /> Refresh
          </Button>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3 text-sm">
        <Select
          value={repository?.repositoryId ?? ''}
          onValueChange={(value) => {
            const next = selections.find((item) => item.repositoryId === value)
            if (next) {
              setRepository(next)
              void load(next)
            }
          }}
        >
          <SelectTrigger aria-label="Repository" className="h-8 w-52">
            <SelectValue placeholder="Select repository" />
          </SelectTrigger>
          <SelectContent>
            {selections.map((item) => (
              <SelectItem key={item.repositoryId} value={item.repositoryId}>
                {item.name ?? item.path}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {repository ? (
          <span className="text-muted-foreground">
            {repository.path} · {repository.defaultBranch ?? 'default branch'}
          </span>
        ) : null}
        <span className="text-xs text-muted-foreground">
          Last sync: {lastSync ? new Date(lastSync).toLocaleString() : 'Never'}
        </span>
      </div>
      {error ? (
        <div
          role="alert"
          className="border-b border-destructive/40 bg-destructive/10 px-5 py-3 text-sm"
        >
          {errorCode === 'github_auth_failed'
            ? 'GitHub 认证失效。请运行 gh auth login 后重试。'
            : loadState === 'partial'
              ? `部分结果：${error}`
              : error}
        </div>
      ) : null}
      {!selections.length ? (
        <div className="m-auto text-center text-muted-foreground">
          <p className="font-medium">No repositories available</p>
          <p className="mt-1 text-sm">Add a local GitHub repository to analyze cards.</p>
        </div>
      ) : loadState === 'loading' ? (
        <div className="m-auto text-sm text-muted-foreground">Loading cards…</div>
      ) : (
        <WecirDevCardPanel
          cards={cards}
          selectedIds={selectedIds}
          onToggle={toggle}
          onClear={clear}
        />
      )}
    </main>
  )
}
