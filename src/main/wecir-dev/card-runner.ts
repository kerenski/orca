import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { runProcess } from '../../shared/child-process/run-process'
import type { WecirDevError } from '../../shared/wecir-dev/contracts'
import { WecirDevStartCardScriptResultSchema } from '../../shared/wecir-dev/schemas'
import { getCardSkillScriptPath } from './card-skill-resource-path'
import type { CardRunner, CardRunnerResult } from './types'

const OUTPUT_LIMIT = 512 * 1024

export function createCardRunner(options: { scriptPath?: string; cwd?: string } = {}): CardRunner {
  const scriptPath = options.scriptPath ?? getCardSkillScriptPath()
  return async ({ issueNumber, card, tier, cwd, force, signal }): Promise<CardRunnerResult> => {
    try {
      await access(scriptPath, constants.R_OK)
    } catch {
      throw cardError('script_missing', 'The start-card script is not available', false)
    }
    const args = [
      scriptPath,
      '--issue',
      String(issueNumber),
      '--card',
      card,
      '--tier',
      tier,
      '--json'
    ]
    if (force) {
      args.push('--force')
    }
    const workingDirectory = cwd ?? options.cwd ?? process.cwd()
    try {
      const metadata = await stat(workingDirectory)
      if (!metadata.isDirectory()) {
        throw new Error('Not a directory')
      }
    } catch {
      throw cardError('worktree_invalid', 'The card working directory is not available', false)
    }
    let result
    try {
      result = await runProcess({
        program: 'bash',
        args,
        cwd: workingDirectory,
        signal,
        timeoutMs: 120_000,
        maxOutputBytes: OUTPUT_LIMIT
      })
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') {
        throw cardError('dependency_missing', 'The bash executable is not available', false, {
          dependency: 'bash'
        })
      }
      throw cardError('unknown', 'Unable to start the card script', true)
    }
    if (result.timedOut) {
      throw cardError('timeout', 'The card script timed out', true)
    }

    const parsed = parseScriptResult(result.stdout)
    if (result.code !== 0) {
      if (!parsed.ok) {
        throw cardErrorFromContract(parsed.error)
      }
      throw invalidScriptOutput()
    }
    if (!parsed.ok) {
      throw invalidScriptOutput()
    }
    if (parsed.issue !== issueNumber || parsed.card !== card || parsed.tier !== tier) {
      throw invalidScriptOutput()
    }
    return parsed
  }
}

function parseScriptResult(stdout: string) {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw invalidScriptOutput()
  }
  const result = WecirDevStartCardScriptResultSchema.safeParse(parsed)
  if (!result.success) {
    throw invalidScriptOutput()
  }
  return result.data
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error
}

function invalidScriptOutput(): Error & { cardError: WecirDevError } {
  return cardError(
    'invalid_script_output',
    'The start-card script returned an unsupported result',
    false
  )
}

function cardErrorFromContract(contract: WecirDevError): Error & { cardError: WecirDevError } {
  const error = new Error(contract.message) as Error & { cardError: WecirDevError }
  error.cardError = contract
  return error
}

function cardError(
  code: WecirDevError['code'],
  message: string,
  retryable: boolean,
  details?: WecirDevError['details']
): Error & { cardError: WecirDevError } {
  const error = new Error(message) as Error & { cardError: WecirDevError }
  error.cardError = { code, message, retryable, ...(details ? { details } : {}) }
  return error
}
