import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { Repo } from '../../../../shared/repo-types'
import { WECIR_DEV_PRIORITIES, type WecirDevPriority } from '../../../../shared/wecir-dev/contracts'
import {
  deleteWecirDevCardTemplate,
  saveWecirDevCardTemplate,
  type WecirDevCardTemplate
} from './wecir-dev-card-data-source'

const NO_REPOSITORY = '__none__'

export function WecirDevTemplateManagerDialog({
  open,
  repositories,
  templates,
  onOpenChange,
  onUseTemplate
}: {
  open: boolean
  repositories: Repo[]
  templates: WecirDevCardTemplate[]
  onOpenChange: (open: boolean) => void
  onUseTemplate: (template: WecirDevCardTemplate) => void
}): React.JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [cardName, setCardName] = useState('')
  const [repositoryId, setRepositoryId] = useState(NO_REPOSITORY)
  const [referenceKind, setReferenceKind] = useState<'issue' | 'pull_request'>('issue')
  const [priority, setPriority] = useState<WecirDevPriority>('normal')
  const [owner, setOwner] = useState('')
  const [repository, setRepository] = useState('')
  const [error, setError] = useState<string | null>(null)

  const reset = (): void => {
    setEditingId(null)
    setName('')
    setCardName('')
    setRepositoryId(NO_REPOSITORY)
    setReferenceKind('issue')
    setPriority('normal')
    setOwner('')
    setRepository('')
    setError(null)
  }

  const edit = (template: WecirDevCardTemplate): void => {
    setEditingId(template.templateId)
    setName(template.name)
    setCardName(template.cardName)
    setRepositoryId(template.repositoryId ?? NO_REPOSITORY)
    setReferenceKind(template.referenceKind)
    setPriority(template.priority)
    setOwner(template.owner ?? '')
    setRepository(template.repository ?? '')
    setError(null)
  }

  const save = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    try {
      saveWecirDevCardTemplate(
        {
          name: name.trim(),
          cardName,
          repositoryId: repositoryId === NO_REPOSITORY ? undefined : repositoryId,
          referenceKind,
          priority,
          owner: owner.trim() || undefined,
          repository: repository.trim() || undefined
        },
        editingId ?? undefined
      )
      reset()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Template fields are invalid.')
    }
  }

  const changeOpen = (nextOpen: boolean): void => {
    if (!nextOpen) {
      reset()
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[min(720px,calc(100vh-2rem))] overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="text-base">Card templates</DialogTitle>
          <DialogDescription className="text-xs">
            Administrators can maintain reusable defaults and create cards from them.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 md:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
          <div className="scrollbar-sleek max-h-[580px] overflow-y-auto border-b border-border md:border-r md:border-b-0">
            {templates.length ? (
              templates.map((template) => (
                <div
                  key={template.templateId}
                  className="flex items-center gap-3 border-b border-border/60 px-4 py-3 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{template.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {template.cardName} · {template.referenceKind === 'issue' ? 'Issue' : 'PR'} ·{' '}
                      {template.priority}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      reset()
                      onUseTemplate(template)
                    }}
                  >
                    Use
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Edit ${template.name}`}
                    onClick={() => edit(template)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Delete ${template.name}`}
                    className="text-destructive"
                    onClick={() => deleteWecirDevCardTemplate(template.templateId)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))
            ) : (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No card templates yet.
              </p>
            )}
          </div>
          <form
            className="scrollbar-sleek max-h-[580px] space-y-4 overflow-y-auto p-4"
            onSubmit={save}
          >
            <h3 className="text-sm font-semibold">
              {editingId ? 'Edit template' : 'New template'}
            </h3>
            <div className="space-y-2">
              <Label>Template name</Label>
              <Input value={name} onChange={(event) => setName(event.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Default card name</Label>
              <Input
                value={cardName}
                onChange={(event) => setCardName(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Repository</Label>
              <Select value={repositoryId} onValueChange={setRepositoryId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_REPOSITORY}>Choose when creating</SelectItem>
                  {repositories.map((repo) => (
                    <SelectItem key={repo.id} value={repo.id}>
                      {repo.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Reference</Label>
                <Select
                  value={referenceKind}
                  onValueChange={(value) => setReferenceKind(value as 'issue' | 'pull_request')}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="issue">Issue</SelectItem>
                    <SelectItem value="pull_request">Pull request</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select
                  value={priority}
                  onValueChange={(value) => setPriority(value as WecirDevPriority)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WECIR_DEV_PRIORITIES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Owner</Label>
                <Input value={owner} onChange={(event) => setOwner(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Repository name</Label>
                <Input value={repository} onChange={(event) => setRepository(event.target.value)} />
              </div>
            </div>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              {editingId ? (
                <Button type="button" variant="outline" onClick={reset}>
                  Cancel edit
                </Button>
              ) : null}
              <Button type="submit">
                <Plus />
                {editingId ? 'Save template' : 'Add template'}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
