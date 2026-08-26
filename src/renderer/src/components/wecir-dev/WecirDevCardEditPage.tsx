import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import type { Repo } from '../../../../shared/repo-types'
import type { WecirDevCardRecord } from '../../../../shared/wecir-dev/contracts'
import { updateWecirDevCard } from './wecir-dev-card-data-source'
import { WecirDevCardForm } from './WecirDevCardForm'

function Metadata({ card }: { card: WecirDevCardRecord }): React.JSX.Element {
  const values = [
    ['Status', card.status],
    ['Created', new Date(card.createdAt).toLocaleString()],
    ['Updated', new Date(card.updatedAt).toLocaleString()],
    ['Controller', card.controllerHandle ?? 'Not assigned'],
    ['Worker', card.workerHandle ?? 'Not assigned'],
    ['Worktree', card.worktreePath ?? 'Not created']
  ]
  return (
    <div className="grid gap-x-4 gap-y-2 border-b border-border bg-muted/20 px-5 py-3 text-xs sm:grid-cols-2">
      {values.map(([label, value]) => (
        <div key={label} className="flex min-w-0 items-center justify-between gap-3">
          <span className="text-muted-foreground">{label}</span>
          {label === 'Status' ? (
            <Badge variant="outline">{value}</Badge>
          ) : (
            <span className="truncate font-mono">{value}</span>
          )}
        </div>
      ))}
      {card.lastError ? (
        <p className="sm:col-span-2 text-destructive">{card.lastError.message}</p>
      ) : null}
    </div>
  )
}

export function WecirDevCardEditPage({
  card,
  repositories,
  onClose
}: {
  card: WecirDevCardRecord | null
  repositories: Repo[]
  onClose: () => void
}): React.JSX.Element {
  return (
    <Sheet open={card !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="min-h-0 sm:max-w-2xl">
        {card ? (
          <>
            <SheetHeader className="shrink-0 border-b border-border px-5 py-4">
              <SheetTitle>Edit {card.name}</SheetTitle>
              <SheetDescription>
                Update card fields and analysis without changing runtime history.
              </SheetDescription>
            </SheetHeader>
            <Metadata card={card} />
            <WecirDevCardForm
              key={card.cardId}
              repositories={repositories}
              initial={{
                name: card.name,
                repository: card.repository,
                reference: card.reference,
                priority: card.priority,
                dependencies: card.dependencies,
                analysis: card.analysis
              }}
              submitLabel="Save changes"
              onCancel={onClose}
              onSubmit={(draft) => {
                updateWecirDevCard(card.cardId, draft)
                onClose()
              }}
            />
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
