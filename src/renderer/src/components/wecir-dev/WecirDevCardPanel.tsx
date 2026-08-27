import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { WecirDevCardRecord } from '../../../../shared/wecir-dev/contracts'
import { filterWecirDevCards, type WecirDevCardFilters } from '@/store/slices/wecir-dev-card'
import { WecirDevCardDetailDrawer } from './WecirDevCardDetailDrawer'
import { WecirDevCardQueueBar } from './WecirDevCardQueueBar'

const initialFilters: WecirDevCardFilters = {
  kind: 'all',
  statuses: [],
  labels: [],
  assignee: '',
  priority: ''
}

function MultiFilter({
  label,
  values,
  selected,
  onToggle
}: {
  label: string
  values: string[]
  selected: string[]
  onToggle: (value: string) => void
}) {
  if (!values.length) {
    return null
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          {label}
          {selected.length ? ` (${selected.length})` : ''}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {values.map((value) => (
          <DropdownMenuCheckboxItem
            key={value}
            checked={selected.includes(value)}
            onCheckedChange={() => onToggle(value)}
          >
            {value}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function WecirDevCardPanel({
  cards,
  selectedIds,
  onToggle,
  onClear
}: {
  cards: WecirDevCardRecord[]
  selectedIds: string[]
  onToggle: (id: string) => void
  onClear: () => void
}) {
  const [filters, setFilters] = useState(initialFilters)
  const [detail, setDetail] = useState<WecirDevCardRecord | null>(null)
  const visibleCards = useMemo(() => filterWecirDevCards(cards, filters), [cards, filters])
  const statuses = [...new Set(cards.map((card) => card.status))]
  const labels = [...new Set(cards.flatMap((card) => card.labels ?? []))]
  const assignees = [...new Set(cards.flatMap((card) => card.assignees ?? []))]
  const toggleFilter = (key: 'statuses' | 'labels', value: string) =>
    setFilters((current) => ({
      ...current,
      [key]: current[key].includes(value)
        ? current[key].filter((item) => item !== value)
        : [...current[key], value]
    }))
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <Select
          value={filters.kind}
          onValueChange={(kind) =>
            setFilters((current) => ({ ...current, kind: kind as WecirDevCardFilters['kind'] }))
          }
        >
          <SelectTrigger aria-label="Type" className="h-8 w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Issue / PR</SelectItem>
            <SelectItem value="issue">Issue</SelectItem>
            <SelectItem value="pull_request">Pull request</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filters.priority || 'all'}
          onValueChange={(priority) =>
            setFilters((current) => ({ ...current, priority: priority === 'all' ? '' : priority }))
          }
        >
          <SelectTrigger aria-label="Priority" className="h-8 w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            {['critical', 'high', 'normal', 'low'].map((priority) => (
              <SelectItem key={priority} value={priority}>
                {priority}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <MultiFilter
          label="Status"
          values={statuses}
          selected={filters.statuses}
          onToggle={(value) => toggleFilter('statuses', value)}
        />
        <MultiFilter
          label="Labels"
          values={labels}
          selected={filters.labels}
          onToggle={(value) => toggleFilter('labels', value)}
        />
        <MultiFilter
          label="Assignee"
          values={assignees}
          selected={filters.assignee ? [filters.assignee] : []}
          onToggle={(value) =>
            setFilters((current) => ({
              ...current,
              assignee: current.assignee === value ? '' : value
            }))
          }
        />
        {filters.kind !== 'all' ||
        filters.statuses.length ||
        filters.priority ||
        filters.assignee ||
        filters.labels.length ? (
          <Button variant="ghost" size="sm" onClick={() => setFilters(initialFilters)}>
            Reset
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek">
        {visibleCards.map((card) => {
          const selected = selectedIds.includes(card.cardId)
          const analysis = card.analysis
          return (
            <div
              key={card.cardId}
              className="flex items-start gap-3 border-b border-border px-4 py-3 hover:bg-accent/40"
            >
              <input
                aria-label={`Select ${card.name}`}
                type="checkbox"
                checked={selected}
                onChange={() => onToggle(card.cardId)}
                className="mt-1"
              />
              <button className="min-w-0 flex-1 text-left" onClick={() => setDetail(card)}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    #{card.reference.number} {card.reference.title ?? card.name}
                  </span>
                  <Badge variant="outline">
                    {card.reference.kind === 'pull_request' ? 'PR' : 'Issue'}
                  </Badge>
                  <Badge variant="secondary">{card.status}</Badge>
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>priority {card.priority}</span>
                  <span>level {analysis?.topoLevel ?? '未提供'}</span>
                  <span>blocked {analysis?.blockedCount ?? '未提供'}</span>
                  <span>cycle {analysis?.cycleWarning ?? '未提供'}</span>
                  <span>tier {analysis?.suggestedTier ?? '未提供'}</span>
                </div>
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {analysis?.summary ?? '未提供'}
                </p>
              </button>
            </div>
          )
        })}
        {!visibleCards.length ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            {cards.length
              ? 'No cards match these filters.'
              : 'No cards available for this repository.'}
          </div>
        ) : null}
      </div>
      <WecirDevCardQueueBar
        count={selectedIds.length}
        onClear={() => {
          setDetail(null)
          onClear()
        }}
      />
      <WecirDevCardDetailDrawer
        card={detail}
        open={Boolean(detail)}
        onOpenChange={(open) => !open && setDetail(null)}
      />
    </div>
  )
}
