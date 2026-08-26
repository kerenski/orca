import { LayoutGrid } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'

export function SidebarWecirDevNavButton(): React.JSX.Element {
  const active = useAppStore((state) => state.activeView === 'cards')
  const openWecirDevCardPage = useAppStore((state) => state.openWecirDevCardPage)

  return (
    <button
      type="button"
      onClick={openWecirDevCardPage}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors',
        active
          ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
          : 'text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-foreground/8'
      )}
    >
      <LayoutGrid
        className={cn('size-4 shrink-0', !active && 'text-worktree-sidebar-foreground/30')}
        strokeWidth={active ? 2.25 : 1.75}
      />
      <span className="flex-1">
        {translate('auto.components.sidebar.SidebarWecirDevNavButton.cards', 'Cards')}
      </span>
    </button>
  )
}
