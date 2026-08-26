import type { ClassifiedError } from '../classified-error'
import type { PRCheckDetail, PRCheckRunDetails } from '../github/check-types'
import type { GitHubWorkItem } from '../github/work-item-types'
import type { WecirDevIssueReference } from './contracts'
import { WECIR_DEV_SCHEMA_VERSION } from './contracts'

export const WECIR_DEV_GITHUB_CARD_DATA_SCHEMA_VERSION = WECIR_DEV_SCHEMA_VERSION

export type WecirDevGitHubCommentSummary = {
  count: number
  authors: string[]
  latestAt: string | null
  latestBody: string | null
}

export type WecirDevGitHubCheckSummary = {
  name: string
  status: PRCheckDetail['status']
  conclusion: PRCheckDetail['conclusion']
  details?: Pick<PRCheckRunDetails, 'summary' | 'text' | 'startedAt' | 'completedAt' | 'annotations' | 'jobs'>
}

export type WecirDevGitHubCardItem = {
  reference: WecirDevIssueReference
  title: string
  body: string
  labels: string[]
  assignees: string[]
  milestone: string | null
  state: GitHubWorkItem['state']
  updatedAt: string
  draft: boolean
  author: string | null
  references: WecirDevIssueReference[]
  comments: WecirDevGitHubCommentSummary
  checks: WecirDevGitHubCheckSummary[]
}

export type WecirDevGitHubItemError = {
  number: number
  type: GitHubWorkItem['type']
  error: ClassifiedError
}

export type WecirDevGitHubCardData = {
  schemaVersion: typeof WECIR_DEV_GITHUB_CARD_DATA_SCHEMA_VERSION
  items: WecirDevGitHubCardItem[]
  itemErrors: WecirDevGitHubItemError[]
  listErrors?: {
    issues?: ClassifiedError
    prs?: ClassifiedError
  }
  page: number
  limit: number
  hasNext: boolean
}

export type WecirDevGitHubCardDataArgs = {
  limit?: number
  query?: string
  page?: number
  noCache?: boolean
}
