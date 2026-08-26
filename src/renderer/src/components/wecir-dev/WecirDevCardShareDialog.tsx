import { useState } from 'react'
import { Trash2, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { WecirDevCardRecord } from '../../../../shared/wecir-dev/contracts'
import {
  revokeWecirDevCardShare,
  shareWecirDevCard,
  type WecirDevCardShare
} from './wecir-dev-card-shares'

export function WecirDevCardShareDialog({
  card,
  shares,
  onClose
}: {
  card: WecirDevCardRecord | null
  shares: WecirDevCardShare[]
  onClose: () => void
}): React.JSX.Element {
  const [recipient, setRecipient] = useState('')
  const [error, setError] = useState<string | null>(null)
  const cardShares = card ? shares.filter((share) => share.cardId === card.cardId) : []

  return (
    <Dialog open={card !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="text-base">Share {card?.name}</DialogTitle>
          <DialogDescription className="text-xs">
            Add user names or email addresses to this card&apos;s share list.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3 px-5 py-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!card) {
              return
            }
            try {
              shareWecirDevCard(card.cardId, recipient)
              setRecipient('')
              setError(null)
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : 'Unable to add this user.')
            }
          }}
        >
          <div className="space-y-2">
            <Label>User</Label>
            <div className="flex gap-2">
              <Input
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                placeholder="name@example.com"
              />
              <Button type="submit">
                <UserPlus />
                Add user
              </Button>
            </div>
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </form>
        <div className="border-t border-border">
          {cardShares.length ? (
            cardShares.map((share) => (
              <div
                key={share.shareId}
                className="flex items-center gap-3 border-b border-border/60 px-5 py-3 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{share.recipient}</p>
                  <p className="text-xs text-muted-foreground">
                    Added {new Date(share.sharedAt).toLocaleString()}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-destructive"
                  aria-label={`Revoke ${share.recipient}`}
                  onClick={() => revokeWecirDevCardShare(share.shareId)}
                >
                  <Trash2 />
                </Button>
              </div>
            ))
          ) : (
            <p className="px-5 py-6 text-center text-sm text-muted-foreground">
              This card has not been shared.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
