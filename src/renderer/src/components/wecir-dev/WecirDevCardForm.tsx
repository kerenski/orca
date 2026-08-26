import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { Repo } from '../../../../shared/repo-types'
import {
  WECIR_DEV_PRIORITIES,
  type WecirDevAnalysisResult,
  type WecirDevDependencyRelation,
  type WecirDevPriority
} from '../../../../shared/wecir-dev/contracts'
import {
  WecirDevCardNameSchema,
  WecirDevDependencyRelationSchema,
  WecirDevIssueReferenceSchema
} from '../../../../shared/wecir-dev/schemas'
import type { WecirDevCardDraft } from './wecir-dev-card-data-source'
import type { WecirDevCardTemplate } from './wecir-dev-card-templates'

function repositoryIdentity(repo: Repo | undefined): { owner: string; repository: string } {
  const parts = repo?.gitRemoteIdentity?.canonicalKey.split('/') ?? []
  return {
    owner: parts.length >= 3 ? (parts.at(-2) ?? '') : '',
    repository: parts.length >= 2 ? (parts.at(-1) ?? '') : (repo?.displayName ?? '')
  }
}

function lines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function Field({
  label,
  description,
  children
}: {
  label: string
  description?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label>{label}</Label>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </div>
  )
}

export function WecirDevCardForm({
  repositories,
  initial,
  template,
  submitLabel,
  onSubmit,
  onCancel
}: {
  repositories: Repo[]
  initial?: WecirDevCardDraft
  template?: WecirDevCardTemplate | null
  submitLabel: string
  onSubmit: (draft: WecirDevCardDraft) => void
  onCancel: () => void
}): React.JSX.Element {
  const initialRepoId =
    initial?.repository.repositoryId ?? template?.repositoryId ?? repositories[0]?.id ?? ''
  const initialRepo = repositories.find((repo) => repo.id === initialRepoId)
  const identity = repositoryIdentity(initialRepo)
  const [name, setName] = useState(initial?.name ?? template?.cardName ?? '')
  const [repositoryId, setRepositoryId] = useState(initialRepoId)
  const [referenceKind, setReferenceKind] = useState<'issue' | 'pull_request'>(
    initial?.reference.kind ?? template?.referenceKind ?? 'issue'
  )
  const [referenceNumber, setReferenceNumber] = useState(
    initial ? String(initial.reference.number) : ''
  )
  const [owner, setOwner] = useState(initial?.reference.owner ?? template?.owner ?? identity.owner)
  const [repository, setRepository] = useState(
    initial?.reference.repository ?? template?.repository ?? identity.repository
  )
  const [priority, setPriority] = useState<WecirDevPriority>(
    initial?.priority ?? template?.priority ?? 'normal'
  )
  const [dependencies, setDependencies] = useState(
    initial?.dependencies.length ? JSON.stringify(initial.dependencies, null, 2) : ''
  )
  const [analysisSummary, setAnalysisSummary] = useState(initial?.analysis?.summary ?? '')
  const [suggestedPriority, setSuggestedPriority] = useState<WecirDevPriority>(
    initial?.analysis?.suggestedPriority ?? priority
  )
  const [riskFlags, setRiskFlags] = useState(initial?.analysis?.riskFlags.join('\n') ?? '')
  const [acceptanceCriteria, setAcceptanceCriteria] = useState(
    initial?.analysis?.acceptanceCriteria.join('\n') ?? ''
  )
  const [error, setError] = useState<string | null>(null)

  const changeRepository = (nextRepositoryId: string): void => {
    setRepositoryId(nextRepositoryId)
    const nextIdentity = repositoryIdentity(
      repositories.find((repo) => repo.id === nextRepositoryId)
    )
    setOwner(nextIdentity.owner)
    setRepository(nextIdentity.repository)
  }

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    try {
      if (!WecirDevCardNameSchema.safeParse(name).success) {
        throw new Error('Name must be a lowercase slug using letters, numbers, and hyphens.')
      }
      const selectedRepository = repositories.find((repo) => repo.id === repositoryId)
      if (!selectedRepository) {
        throw new Error('Select a repository.')
      }
      const parsedDependencies = dependencies.trim()
        ? (JSON.parse(dependencies) as WecirDevDependencyRelation[])
        : []
      for (const dependency of parsedDependencies) {
        WecirDevDependencyRelationSchema.parse(dependency)
      }
      const reference = WecirDevIssueReferenceSchema.parse({
        kind: referenceKind,
        number: Number(referenceNumber),
        owner: owner.trim(),
        repository: repository.trim(),
        url: `https://github.com/${owner.trim()}/${repository.trim()}/${referenceKind === 'issue' ? 'issues' : 'pull'}/${referenceNumber}`
      })
      const analysis: WecirDevAnalysisResult | undefined = analysisSummary.trim()
        ? {
            summary: analysisSummary.trim(),
            suggestedPriority,
            dependencies: parsedDependencies,
            riskFlags: lines(riskFlags),
            acceptanceCriteria: lines(acceptanceCriteria),
            generatedAt: new Date().toISOString()
          }
        : undefined
      onSubmit({
        name,
        repository: {
          repositoryId: selectedRepository.id,
          path: selectedRepository.path,
          executionHost: 'local',
          provider: 'github',
          owner: owner.trim(),
          name: repository.trim()
        },
        reference,
        priority,
        dependencies: parsedDependencies,
        analysis
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Card fields are invalid.')
    }
  }

  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
      <div className="scrollbar-sleek flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <Field label="Card name" description="Lowercase slug, up to 64 characters.">
          <Input value={name} onChange={(event) => setName(event.target.value)} required />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Repository">
            <Select value={repositoryId} onValueChange={changeRepository}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {repositories.map((repo) => (
                  <SelectItem key={repo.id} value={repo.id}>
                    {repo.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Priority">
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
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_8rem]">
          <Field label="Owner">
            <Input value={owner} onChange={(event) => setOwner(event.target.value)} required />
          </Field>
          <Field label="Repository name">
            <Input
              value={repository}
              onChange={(event) => setRepository(event.target.value)}
              required
            />
          </Field>
          <Field label="Reference">
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
          </Field>
        </div>
        <Field label="Issue / PR number">
          <Input
            type="number"
            min="1"
            value={referenceNumber}
            onChange={(event) => setReferenceNumber(event.target.value)}
            required
          />
        </Field>
        <Field
          label="Dependencies"
          description="JSON array using relation plus targetCardId or targetReference."
        >
          <Textarea
            className="min-h-28 font-mono text-xs"
            value={dependencies}
            onChange={(event) => setDependencies(event.target.value)}
            placeholder='[{"relation":"blocked_by","targetCardId":"card-id"}]'
          />
        </Field>
        <Field
          label="Analysis summary"
          description="Optional analysis output stored with the card."
        >
          <Textarea
            value={analysisSummary}
            onChange={(event) => setAnalysisSummary(event.target.value)}
          />
        </Field>
        {analysisSummary ? (
          <>
            <Field label="Suggested priority">
              <Select
                value={suggestedPriority}
                onValueChange={(value) => setSuggestedPriority(value as WecirDevPriority)}
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
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Risk flags" description="One per line.">
                <Textarea
                  value={riskFlags}
                  onChange={(event) => setRiskFlags(event.target.value)}
                />
              </Field>
              <Field label="Acceptance criteria" description="One per line.">
                <Textarea
                  value={acceptanceCriteria}
                  onChange={(event) => setAcceptanceCriteria(event.target.value)}
                />
              </Field>
            </div>
          </>
        ) : null}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{submitLabel}</Button>
      </div>
    </form>
  )
}
