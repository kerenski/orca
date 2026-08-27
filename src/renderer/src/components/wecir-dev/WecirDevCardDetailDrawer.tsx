import { ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import type { WecirDevCardRecord } from '../../../../shared/wecir-dev/contracts'

export function WecirDevCardDetailDrawer({
  card,
  open,
  onOpenChange
}: {
  card: WecirDevCardRecord | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto scrollbar-sleek">
        <div className="min-w-0">
          {card ? (
            <>
              <SheetHeader>
                <SheetTitle>
                  #{card.reference.number} {card.reference.title ?? card.name}
                </SheetTitle>
                <SheetDescription>
                  {card.reference.kind === 'pull_request' ? 'Pull request' : 'Issue'} ·{' '}
                  {card.status}
                  {(card.url ?? card.reference.url) ? (
                    <Button asChild variant="link" size="sm" className="ml-2 h-auto p-0">
                      <a href={card.url ?? card.reference.url} target="_blank" rel="noreferrer">
                        <ExternalLink /> Open on GitHub
                      </a>
                    </Button>
                  ) : null}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-5 px-4 pb-6 text-sm">
                <section className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium">标签与负责人</h3>
                  {(card.labels ?? []).map((label) => (
                    <Badge key={label} variant="outline">
                      {label}
                    </Badge>
                  ))}
                  {(card.assignees ?? []).map((assignee) => (
                    <Badge key={assignee} variant="secondary">
                      @{assignee}
                    </Badge>
                  ))}
                  {!card.labels?.length && !card.assignees?.length ? (
                    <span className="text-muted-foreground">未提供</span>
                  ) : null}
                </section>
                <section>
                  <h3 className="mb-1 font-medium">正文</h3>
                  <p className="whitespace-pre-wrap break-words text-muted-foreground">
                    {card.body || '未提供'}
                  </p>
                </section>
                <section>
                  <h3 className="mb-1 font-medium">依赖关系及来源</h3>
                  {card.dependencies.length ? (
                    <ul className="space-y-2 text-muted-foreground">
                      {card.dependencies.map((dependency, index) => (
                        <li
                          key={`${dependency.relation}-${index}`}
                          className="flex flex-wrap items-center gap-2"
                        >
                          <span>
                            {dependency.relation}:{' '}
                            {dependency.targetReference?.number ??
                              dependency.targetCardId ??
                              '未提供'}
                          </span>
                          {dependency.targetReference?.url ? (
                            <Button asChild variant="link" size="sm" className="h-auto p-0">
                              <a
                                href={dependency.targetReference.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <ExternalLink /> 来源
                              </a>
                            </Button>
                          ) : null}
                          <span>{dependency.note ?? '来源未提供'}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">未提供</p>
                  )}
                </section>
                <section>
                  <h3 className="mb-1 font-medium">评分明细</h3>
                  {card.analysis?.scoreDetails?.length ? (
                    <ul className="space-y-1 text-muted-foreground">
                      {card.analysis.scoreDetails.map((detail) => (
                        <li key={detail.rule}>
                          {detail.rule}: {detail.points} — {detail.explanation}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">未提供</p>
                  )}
                </section>
                <section>
                  <h3 className="mb-1 font-medium">建议</h3>
                  <div className="flex gap-2">
                    <Badge variant="secondary">
                      tier {card.analysis?.suggestedTier ?? '未提供'}
                    </Badge>
                    <Badge variant="outline">
                      {card.analysis?.suggestedPriority ?? card.priority}
                    </Badge>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {card.analysis?.explanation ?? '未提供'}
                  </p>
                </section>
                {card.reference.kind === 'pull_request' ? (
                  <section>
                    <h3 className="mb-1 font-medium">PR / CI 摘要</h3>
                    {card.checksSummary ? (
                      <p className="text-muted-foreground">
                        {card.checksSummary.state} · {card.checksSummary.passed}/
                        {card.checksSummary.total} passed · {card.checksSummary.failed} failed ·{' '}
                        {card.checksSummary.pending} pending
                      </p>
                    ) : (
                      <p className="text-muted-foreground">未提供</p>
                    )}
                  </section>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}
