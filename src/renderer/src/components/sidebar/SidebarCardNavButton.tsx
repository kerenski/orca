import React from 'react'
import { Layers } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { isGitRepoKind } from '../../../../shared/repo-kind'

/**
 * Sidebar entry for the Cards page — a Tasks-data-backed clone with its own
 * activeView/navigation so the native Tasks entry stays untouched.
 */
export function SidebarCardNavButton(): React.JSX.Element | null {
  const openCardPage = useAppStore((s) => s.openCardPage)
  const activeView = useAppStore((s) => s.activeView)
  const repos = useAppStore((s) => s.repos)
  const canBrowseCards = repos.some((repo) => isGitRepoKind(repo))

  const cardsActive = activeView === 'cards'

  return (
    <button
      type="button"
      onClick={() => {
        if (!canBrowseCards) {
          return
        }
        openCardPage()
      }}
      aria-disabled={!canBrowseCards}
      aria-current={cardsActive ? 'page' : undefined}
      data-contextual-tour-target="sidebar-cards"
      className={cn(
        'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors',
        cardsActive
          ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
          : 'text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-foreground/8',
        !canBrowseCards && 'cursor-not-allowed opacity-50 hover:bg-transparent'
      )}
    >
      <Layers
        className={cn('size-4 shrink-0', !cardsActive && 'text-worktree-sidebar-foreground/30')}
        strokeWidth={cardsActive ? 2.25 : 1.75}
      />
      <span className="flex-1">
        {translate('auto.components.sidebar.SidebarNav.cards', '卡片')}
      </span>
    </button>
  )
}
