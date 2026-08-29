import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import path from 'node:path'
import {
  CardStartResultSchema,
  type CardStartRequest,
  type CardStartResult
} from '../../shared/card-start-contract'
import type { Repo } from '../../shared/repo-types'
import { getOriginGitHubApiRepository } from '../github/github-api-repository'
import { ghExecFileAsync, ghRepoExecOptions, githubRepoContext } from '../github/gh-utils'

const execFileAsync = promisify(execFile)
const ALLOWED_EXIT_CODES = new Set([0, 1, 2, 3])

type CardStartFailureCode =
  | 'card_start_failed'
  | 'card_start_host_unsupported'
  | 'card_start_repo_not_found'
  | 'card_start_issue_mismatch'
type TierConfig = { controller: string; worker: string }

async function readTierConfig(tier: CardStartRequest['tier']): Promise<TierConfig> {
  const raw = await readFile(path.join(skillDirectory(), 'tiers.json'), 'utf8')
  const parsed = JSON.parse(raw) as { tiers?: Record<string, Partial<TierConfig>> }
  const config = parsed.tiers?.[tier]
  if (!config?.controller || !config.worker) {
    throw new Error(`Tier configuration is missing for ${tier}`)
  }
  return { controller: config.controller, worker: config.worker }
}

function failure(code: CardStartFailureCode, message: string): CardStartResult {
  return { schemaVersion: 1, ok: false, exitCode: 3, error: { code, message, retryable: false } }
}

function skillDirectory(): string {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  return resourcesPath
    ? path.join(resourcesPath, 'orca-skill')
    : path.join(process.cwd(), 'skills', 'orca-skill')
}

async function runSopPrelude(
  request: CardStartRequest,
  repo: Repo
): Promise<CardStartResult | null> {
  if (repo.connectionId || (repo.executionHostId && repo.executionHostId !== 'local')) {
    return failure(
      'card_start_host_unsupported',
      '开卡需要在目标仓库所在 host 执行 gh 和 start-card.sh；当前仓库执行 host 不可用'
    )
  }
  const ownerRepo = await getOriginGitHubApiRepository(repo.path)
  if (!ownerRepo) {
    return failure('card_start_host_unsupported', '无法从 origin 解析 GitHub fork，已停止开卡')
  }
  const ghOptions = {
    ...ghRepoExecOptions(githubRepoContext(repo.path)),
    host: ownerRepo.host
  }
  const repository = `${ownerRepo.owner}/${ownerRepo.repo}`
  let issue: { title?: string; body?: string }
  try {
    const viewed = await ghExecFileAsync(
      ['issue', 'view', String(request.issue), '--json', 'title,body', '-R', repository],
      { ...ghOptions, idempotent: true }
    )
    issue = JSON.parse(viewed.stdout) as typeof issue
  } catch (error) {
    return failure(
      'card_start_failed',
      error instanceof Error ? error.message : 'gh issue view failed'
    )
  }
  if (!issue.title) {
    return failure('card_start_issue_mismatch', `issue #${request.issue} 没有标题，已停止开卡`)
  }
  let tierConfig: TierConfig
  try {
    tierConfig = await readTierConfig(request.tier)
  } catch (error) {
    return failure(
      'card_start_failed',
      error instanceof Error ? error.message : 'Tier configuration is invalid'
    )
  }
  const comment = `🚀 起跑：${request.card}，难度 ${request.tier}，controller: ${tierConfig.controller}，worker: ${tierConfig.worker}，理由：按 issue 标题与需求进入开卡 SOP`
  try {
    await ghExecFileAsync(
      ['issue', 'comment', String(request.issue), '-R', repository, '--body', comment],
      { ...ghOptions, idempotent: false }
    )
  } catch (error) {
    return failure(
      'card_start_failed',
      error instanceof Error ? error.message : 'gh issue comment failed'
    )
  }
  return null
}

export async function startCardOnRuntimeHost(
  request: CardStartRequest,
  repo: Repo
): Promise<CardStartResult> {
  try {
    const preludeFailure = await runSopPrelude(request, repo)
    if (preludeFailure) {
      return preludeFailure
    }
  } catch (error) {
    return failure(
      'card_start_failed',
      error instanceof Error ? error.message : 'Card start prelude failed'
    )
  }
  const args = [
    path.join(skillDirectory(), 'scripts', 'start-card.sh'),
    '--issue',
    String(request.issue),
    '--card',
    request.card,
    '--tier',
    request.tier,
    '--json'
  ]
  try {
    const { stdout } = await execFileAsync('bash', args, {
      cwd: repo.path,
      maxBuffer: 2 * 1024 * 1024
    })
    return CardStartResultSchema.parse({ ...JSON.parse(stdout.trim()), exitCode: 0 })
  } catch (error) {
    const failureError = error as NodeJS.ErrnoException & {
      stdout?: string
      stderr?: string
      code?: number | string
    }
    const stdout = failureError.stdout?.trim()
    if (stdout) {
      try {
        const parsed = CardStartResultSchema.parse(JSON.parse(stdout))
        if (!parsed.ok) {
          const exitCode =
            typeof failureError.code === 'number' ? failureError.code : parsed.exitCode
          if (ALLOWED_EXIT_CODES.has(exitCode)) {
            return { ...parsed, exitCode: exitCode as 0 | 1 | 2 | 3 }
          }
        }
      } catch {
        // Return a schema-shaped execution failure below.
      }
    }
    const exitCode =
      typeof failureError.code === 'number' && ALLOWED_EXIT_CODES.has(failureError.code)
        ? failureError.code
        : 3
    return {
      schemaVersion: 1,
      ok: false,
      exitCode: exitCode as 0 | 1 | 2 | 3,
      error: {
        code: 'card_start_failed',
        message: failureError.stderr?.trim() || failureError.message || 'Card start failed',
        retryable: exitCode === 3
      }
    }
  }
}
