import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { assessCardTier, CardTierSchema, type CardTier } from '../../../shared/card-tier-assessment'
import type { GitHubWorkItem } from '../../../shared/github/work-item-types'
import { startCardForRuntimeTarget } from '@/runtime/runtime-skills-client'
import { getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { lookupGitHubWorkItemDetailsForSource } from '@/lib/github-work-item-source-lookup'
import type { TaskSourceContext } from '../../../shared/task-source-context'

type CardStartData = {
  item: GitHubWorkItem
  repoId: string
  repoPath?: string | null
  sourceContext?: TaskSourceContext | null
  body?: string | null
}

export default function CardStartDialog(): React.JSX.Element | null {
  const open = useAppStore((state) => state.activeModal === 'card-start')
  const data = useAppStore((state) => state.modalData as CardStartData | undefined)
  const closeModal = useAppStore((state) => state.closeModal)
  const settings = useAppStore((state) => state.settings)
  const item = data?.item
  const [body, setBody] = useState<string | null>(data?.body ?? null)
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [tier, setTier] = useState<CardTier>('simple')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    setBody(data?.body ?? null)
    setDetailsError(null)
    setDetailsLoading(false)
    setTier('simple')
  }, [data?.body, data?.item?.id, data?.repoId])

  useEffect(() => {
    if (!open || !item || item.type !== 'issue' || !data?.repoId) {
      return
    }
    let cancelled = false
    setDetailsLoading(true)
    setDetailsError(null)
    void lookupGitHubWorkItemDetailsForSource({
      repoPath: data.repoPath ?? '',
      repoId: data.repoId,
      sourceContext: data.sourceContext,
      number: item.number,
      type: 'issue',
      issueRepo: item.issueRepo
    })
      .then((details) => {
        if (cancelled) {
          return
        }
        if (!details) {
          setDetailsError('无法加载 issue 详情，已停止开卡')
          return
        }
        setBody(details.body)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDetailsError(
            error instanceof Error ? error.message : '无法加载 issue 详情，已停止开卡'
          )
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDetailsLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [data?.repoId, data?.repoPath, data?.sourceContext, item, open])

  const assessment =
    item && body !== null ? assessCardTier({ title: item.title, body, labels: item.labels }) : null
  const displayAssessment =
    assessment ??
    (item ? assessCardTier({ title: item.title, body: '', labels: item.labels }) : null)
  const assessedTier = assessment?.tier
  useEffect(() => {
    if (assessedTier) {
      setTier(assessedTier)
    }
  }, [assessedTier])

  if (!open || !item || item.type !== 'issue' || !displayAssessment) {
    return null
  }

  const start = async (): Promise<void> => {
    if (!assessment || detailsLoading || detailsError) {
      return
    }
    setPending(true)
    try {
      if (!assessment.cardId) {
        toast.error('标题开头未识别到合法 card id，无法开卡')
        return
      }
      const result = await startCardForRuntimeTarget(getActiveRuntimeTarget(settings), {
        issue: item.number,
        card: assessment.cardId,
        tier: CardTierSchema.parse(tier),
        repoId: data.repoId
      })
      if (!result.ok) {
        toast.error(result.error?.message ?? 'Unable to start card')
        return
      }
      toast.success(`CARD_STARTED: ${result.worktreeId}`)
      closeModal()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to start card')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(visible) => !visible && closeModal()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>开卡</DialogTitle>
          <DialogDescription>
            确认为 #{item.number}「{item.title}」启动独立开卡 SOP。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {detailsLoading ? (
            <div className="text-sm text-muted-foreground">正在加载 issue 详情…</div>
          ) : null}
          {detailsError ? <div className="text-sm text-destructive">{detailsError}</div> : null}
          <div className="rounded-md border border-border/50 bg-muted/20 p-3 text-sm">
            <div className="font-medium">Card：{displayAssessment.cardId ?? '未识别'}</div>
            <div className="mt-1 text-muted-foreground">{displayAssessment.reasons.join(' ')}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              规则建议：{displayAssessment.tier} · confidence：
              {Math.round(displayAssessment.confidence * 100)}%
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium">判定档位</div>
            <Select value={tier} onValueChange={(value) => setTier(CardTierSchema.parse(value))}>
              <SelectTrigger aria-label="选择开卡档位">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="simple">Simple · 小范围改动</SelectItem>
                <SelectItem value="medium">Medium · 跨模块协作</SelectItem>
                <SelectItem value="complex">Complex · 高复杂度任务</SelectItem>
              </SelectContent>
            </Select>
            {tier !== displayAssessment.tier ? (
              <div className="text-xs text-amber-600 dark:text-amber-300">
                已手动覆盖规则建议：{tier}
              </div>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={closeModal} disabled={pending}>
            取消
          </Button>
          <Button
            onClick={() => void start()}
            disabled={pending || detailsLoading || Boolean(detailsError)}
          >
            开始
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
