import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type { Repo } from '../../../../shared/repo-types'
import { createWecirDevCard, type WecirDevCardTemplate } from './wecir-dev-card-data-source'
import { WecirDevCardForm } from './WecirDevCardForm'

export function WecirDevCardCreateDialog({
  open,
  repositories,
  template,
  onOpenChange,
  onCreated
}: {
  open: boolean
  repositories: Repo[]
  template: WecirDevCardTemplate | null
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(760px,calc(100vh-2rem))] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4">
          <DialogTitle className="text-base">Create development card</DialogTitle>
          <DialogDescription className="text-xs">
            {template
              ? `Using template: ${template.name}`
              : 'Create a queued card for a GitHub issue or pull request.'}
          </DialogDescription>
        </DialogHeader>
        <WecirDevCardForm
          key={template?.templateId ?? 'blank'}
          repositories={repositories}
          template={template}
          submitLabel="Create card"
          onCancel={() => onOpenChange(false)}
          onSubmit={(draft) => {
            createWecirDevCard(draft)
            onCreated()
            onOpenChange(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
