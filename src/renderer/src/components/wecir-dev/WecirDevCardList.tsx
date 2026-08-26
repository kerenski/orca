import {
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  Share2,
  Square,
  Trash2,
  UserRoundX
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  WECIR_DEV_STATUSES,
  isValidWecirDevStatusTransition,
  type WecirDevCardRecord,
  type WecirDevControllerInstruction,
  type WecirDevPage,
  type WecirDevStatus
} from '../../../../shared/wecir-dev/contracts'

export type WecirDevStatusFilter = WecirDevStatus | 'all'

function label(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

function statusTone(status: WecirDevStatus): string {
  if (status === 'completed') {
    return 'border-status-success-border bg-status-success-background text-status-success'
  }
  if (status === 'failed' || status === 'removed') {
    return 'border-destructive/30 bg-destructive/10 text-destructive'
  }
  if (status === 'blocked' || status === 'stale') {
    return 'border-border bg-muted text-muted-foreground'
  }
  return 'border-border bg-background text-foreground'
}

function canMove(card: WecirDevCardRecord, target: WecirDevStatus): boolean {
  return isValidWecirDevStatusTransition(card.status, target)
}

function CardActions({
  card,
  onEdit,
  onShare,
  onInstruction,
  onDelete
}: {
  card: WecirDevCardRecord
  onEdit: () => void
  onShare: () => void
  onInstruction: (command: WecirDevControllerInstruction['command']) => void
  onDelete: () => void
}): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Actions for ${card.name}`}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onShare}>
          <Share2 />
          Share
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!canMove(card, 'starting')}
          onSelect={() => onInstruction('start')}
        >
          <Play />
          Start
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canMove(card, 'stale')} onSelect={() => onInstruction('stop')}>
          <Square />
          Stop
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canMove(card, 'queued')}
          onSelect={() => onInstruction('retry')}
        >
          <RotateCcw />
          Retry
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onInstruction('refresh')}>
          <RefreshCw />
          Refresh status
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!canMove(card, 'removed')}
          onSelect={() => onInstruction('remove')}
        >
          <UserRoundX />
          Remove
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={card.status !== 'removed'}
          onSelect={onDelete}
        >
          <Trash2 />
          Delete permanently
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CardRow({
  card,
  onEdit,
  onShare,
  onInstruction,
  onDelete
}: {
  card: WecirDevCardRecord
  onEdit: () => void
  onShare: () => void
  onInstruction: (command: WecirDevControllerInstruction['command']) => void
  onDelete: () => void
}): React.JSX.Element {
  return (
    <div
      role="button"
      tabIndex={0}
      className="grid min-h-16 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/60 px-4 py-3 outline-none last:border-b-0 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      onClick={onEdit}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onEdit()
        }
      }}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{card.name}</span>
          <Badge variant="outline" className={statusTone(card.status)}>
            {label(card.status)}
          </Badge>
          <Badge variant="outline">{label(card.priority)}</Badge>
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="truncate">
            {card.repository.owner}/{card.repository.name}
          </span>
          <span>
            {card.reference.kind === 'issue' ? 'Issue' : 'PR'} #{card.reference.number}
          </span>
          {card.dependencies.length ? <span>{card.dependencies.length} dependencies</span> : null}
          {card.analysis ? <span>Analysis available</span> : null}
          <span>Updated {new Date(card.updatedAt).toLocaleString()}</span>
        </div>
      </div>
      <CardActions
        card={card}
        onEdit={onEdit}
        onShare={onShare}
        onInstruction={onInstruction}
        onDelete={onDelete}
      />
    </div>
  )
}

export function WecirDevCardList({
  page,
  statusFilter,
  onStatusFilterChange,
  onPageChange,
  onCreate,
  onEdit,
  onShare,
  onInstruction,
  onDelete
}: {
  page: WecirDevPage<WecirDevCardRecord>
  statusFilter: WecirDevStatusFilter
  onStatusFilterChange: (status: WecirDevStatusFilter) => void
  onPageChange: (page: number) => void
  onCreate: () => void
  onEdit: (card: WecirDevCardRecord) => void
  onShare: (card: WecirDevCardRecord) => void
  onInstruction: (
    card: WecirDevCardRecord,
    command: WecirDevControllerInstruction['command']
  ) => void
  onDelete: (card: WecirDevCardRecord) => void
}): React.JSX.Element {
  const groups = WECIR_DEV_STATUSES.map((status) => ({
    status,
    cards: page.items.filter((card) => card.status === status)
  })).filter((group) => group.cards.length > 0)
  const first = page.total === 0 ? 0 : (page.page - 1) * page.pageSize + 1
  const last = Math.min(page.page * page.pageSize, page.total)

  return (
    <section className="flex min-h-0 flex-1 flex-col" data-testid="wecir-dev-card-list">
      <div className="flex shrink-0 items-center justify-between gap-3 border-y border-border px-5 py-3 md:px-8">
        <Select
          value={statusFilter}
          onValueChange={(value) => onStatusFilterChange(value as WecirDevStatusFilter)}
        >
          <SelectTrigger size="sm" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            <SelectItem value="all">All statuses</SelectItem>
            {WECIR_DEV_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {label(status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{page.total} cards</span>
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-5 py-4 md:px-8">
        {groups.length ? (
          <div className="mx-auto max-w-5xl overflow-hidden rounded-md border border-border bg-card text-card-foreground shadow-xs">
            {groups.map((group) => (
              <section key={group.status}>
                <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2">
                  <h2 className="text-[11px] font-semibold uppercase text-muted-foreground">
                    {label(group.status)}
                  </h2>
                  <span className="text-xs text-muted-foreground">{group.cards.length}</span>
                </div>
                {group.cards.map((card) => (
                  <CardRow
                    key={card.cardId}
                    card={card}
                    onEdit={() => onEdit(card)}
                    onShare={() => onShare(card)}
                    onInstruction={(command) => onInstruction(card, command)}
                    onDelete={() => onDelete(card)}
                  />
                ))}
              </section>
            ))}
          </div>
        ) : (
          <div className="flex h-full min-h-60 flex-col items-center justify-center text-center">
            <p className="text-sm font-medium">No matching development cards</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a card or choose another status filter.
            </p>
            <Button size="sm" className="mt-4" onClick={onCreate}>
              Create card
            </Button>
          </div>
        )}
      </div>
      <footer className="flex shrink-0 items-center justify-between border-t border-border px-5 py-3 md:px-8">
        <span className="text-xs text-muted-foreground">
          {first}-{last} of {page.total}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous page"
            disabled={page.page <= 1}
            onClick={() => onPageChange(page.page - 1)}
          >
            <ChevronLeft />
          </Button>
          <span className="min-w-16 text-center text-xs">Page {page.page}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next page"
            disabled={!page.hasNext}
            onClick={() => onPageChange(page.page + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      </footer>
    </section>
  )
}
