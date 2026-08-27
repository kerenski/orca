import { Button } from '@/components/ui/button'

export function WecirDevCardQueueBar({ count, onClear }: { count: number; onClear: () => void }) {
  if (!count) {
    return null
  }
  return (
    <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-3 text-sm">
      <span>
        {count} card{count === 1 ? '' : 's'} selected — ready to prepare
      </span>
      <Button variant="ghost" size="sm" onClick={onClear}>
        Clear selection
      </Button>
    </div>
  )
}
