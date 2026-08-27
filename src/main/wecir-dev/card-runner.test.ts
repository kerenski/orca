import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { runProcess } = vi.hoisted(() => ({ runProcess: vi.fn() }))

vi.mock('../../shared/child-process/run-process', () => ({ runProcess }))

import { createCardRunner } from './card-runner'

const runnerResult = {
  schemaVersion: 1,
  ok: true,
  controllerPtyId: 'pty-1',
  worktreeId: 'wt-1',
  worktreePath: '/repo/.worktrees/issue-8-card',
  branch: 'issue-8-card',
  workerAgent: 'agent-1',
  issue: 8,
  card: 'm1-08',
  tier: 'medium'
} as const
const temporaryDirectories: string[] = []

async function createRunner() {
  const directory = await mkdtemp(join(tmpdir(), 'orca-card-runner-'))
  temporaryDirectories.push(directory)
  const scriptPath = join(directory, 'start-card.sh')
  await writeFile(scriptPath, '#!/bin/bash\n', { encoding: 'utf8', mode: 0o644 })
  return {
    run: createCardRunner({ scriptPath, cwd: directory }),
    scriptPath,
    directory
  }
}

function processResult(stdout: unknown, code = 0, stderr = '') {
  return {
    stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout),
    stderr,
    code,
    timedOut: false
  }
}

function invoke(run: Awaited<ReturnType<typeof createRunner>>['run']) {
  return run({ issueNumber: 8, card: 'm1-08', tier: 'medium' })
}

describe('createCardRunner', () => {
  beforeEach(() => {
    runProcess.mockReset()
  })

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
    )
  })

  it('returns the strict success result through bash', async () => {
    const { run, scriptPath, directory } = await createRunner()
    runProcess.mockResolvedValue(processResult(runnerResult))

    await expect(invoke(run)).resolves.toEqual(runnerResult)
    expect(runProcess).toHaveBeenCalledWith({
      program: 'bash',
      args: [scriptPath, '--issue', '8', '--card', 'm1-08', '--tier', 'medium', '--json'],
      cwd: directory,
      signal: undefined,
      timeoutMs: 120_000,
      maxOutputBytes: 512 * 1024
    })
  })

  it('prefers the invocation cwd over the runner fallback', async () => {
    const { run } = await createRunner()
    const invocationCwd = await mkdtemp(join(tmpdir(), 'orca-card-runner-cwd-'))
    temporaryDirectories.push(invocationCwd)
    runProcess.mockResolvedValue(processResult(runnerResult))

    await run({ issueNumber: 8, card: 'm1-08', tier: 'medium', cwd: invocationCwd })

    expect(runProcess.mock.calls[0]?.[0].cwd).toBe(invocationCwd)
  })

  it('falls back to process.cwd when no cwd is configured', async () => {
    const { scriptPath } = await createRunner()
    const run = createCardRunner({ scriptPath })
    runProcess.mockResolvedValue(processResult(runnerResult))

    await invoke(run)

    expect(runProcess.mock.calls[0]?.[0].cwd).toBe(process.cwd())
  })

  it('passes force as a separate argv item', async () => {
    const { run } = await createRunner()
    runProcess.mockResolvedValue(processResult(runnerResult))

    await run({ issueNumber: 8, card: 'm1-08', tier: 'medium', force: true })

    expect(runProcess.mock.calls[0]?.[0].args).toContain('--force')
  })

  it.each([
    'controllerPtyId',
    'worktreeId',
    'worktreePath',
    'branch',
    'workerAgent',
    'issue',
    'card',
    'tier'
  ])('rejects missing success field %s', async (field) => {
    const { run } = await createRunner()
    const invalid = { ...runnerResult, [field]: undefined }
    runProcess.mockResolvedValue(processResult(invalid))

    await expect(invoke(run)).rejects.toMatchObject({
      cardError: { code: 'invalid_script_output' }
    })
  })

  it.each([
    { schemaVersion: 2 },
    { issue: 9 },
    { card: 'm1-09' },
    { tier: 'simple' },
    { unexpected: true }
  ])('rejects unsupported or mismatched success output %#', async (change) => {
    const { run } = await createRunner()
    runProcess.mockResolvedValue(processResult({ ...runnerResult, ...change }))

    await expect(invoke(run)).rejects.toMatchObject({
      cardError: { code: 'invalid_script_output' }
    })
  })

  it('consumes a structured failure on nonzero exit', async () => {
    const { run } = await createRunner()
    const failure = {
      schemaVersion: 1,
      ok: false,
      error: {
        code: 'dependency_missing',
        message: 'Missing required dependency: jq',
        retryable: false,
        details: { dependency: 'jq' }
      }
    }
    runProcess.mockResolvedValue(processResult(failure, 1, 'private diagnostic'))

    await expect(invoke(run)).rejects.toMatchObject({ cardError: failure.error })
  })

  it.each([
    ['not JSON', 0],
    ['not JSON', 3],
    [{ ...runnerResult, schemaVersion: 2 }, 3],
    [runnerResult, 3],
    [
      {
        schemaVersion: 1,
        ok: false,
        error: { code: 'unknown', message: 'failed', retryable: true }
      },
      0
    ]
  ])('rejects output and exit-code contradictions %#', async (stdout, code) => {
    const { run } = await createRunner()
    runProcess.mockResolvedValue(processResult(stdout, code as number))

    await expect(invoke(run)).rejects.toMatchObject({
      cardError: { code: 'invalid_script_output' }
    })
  })

  it('does not expose stderr through invalid output errors', async () => {
    const { run } = await createRunner()
    runProcess.mockResolvedValue(processResult('not JSON', 3, 'SECRET TERMINAL CONTENT'))

    const error = await invoke(run).then(
      () => undefined,
      (caught: Error) => caught
    )

    expect(error?.message).not.toContain('SECRET TERMINAL CONTENT')
    expect(JSON.stringify(error)).not.toContain('SECRET TERMINAL CONTENT')
  })

  it('runs a readable non-executable script', async () => {
    const { run } = await createRunner()
    runProcess.mockResolvedValue(processResult(runnerResult))

    await expect(invoke(run)).resolves.toEqual(runnerResult)
    expect(runProcess).toHaveBeenCalledOnce()
  })

  it.each([
    ['missing', (directory: string) => join(directory, 'missing')],
    ['not a directory', (_directory: string, scriptPath: string) => scriptPath]
  ])('rejects a %s cwd before spawning', async (_label, cwdPath) => {
    const { run, scriptPath, directory } = await createRunner()

    await expect(
      run({
        issueNumber: 8,
        card: 'm1-08',
        tier: 'medium',
        cwd: cwdPath(directory, scriptPath)
      })
    ).rejects.toMatchObject({
      cardError: { code: 'worktree_invalid', retryable: false }
    })
    expect(runProcess).not.toHaveBeenCalled()
  })

  it('maps bash ENOENT to a non-retryable dependency error', async () => {
    const { run } = await createRunner()
    runProcess.mockRejectedValue(Object.assign(new Error('spawn bash ENOENT'), { code: 'ENOENT' }))

    await expect(invoke(run)).rejects.toMatchObject({
      cardError: {
        code: 'dependency_missing',
        retryable: false,
        details: { dependency: 'bash' }
      }
    })
  })

  it('keeps other spawn failures as retryable unknown errors', async () => {
    const { run } = await createRunner()
    runProcess.mockRejectedValue(Object.assign(new Error('spawn failed'), { code: 'EACCES' }))

    await expect(invoke(run)).rejects.toMatchObject({
      cardError: { code: 'unknown', retryable: true }
    })
  })

  it('rejects a missing script before spawning it', async () => {
    const scriptPath = join(tmpdir(), `orca-card-runner-missing-${process.pid}.sh`)

    await expect(
      createCardRunner({ scriptPath })({ issueNumber: 8, card: 'm1-08', tier: 'medium' })
    ).rejects.toMatchObject({ cardError: { code: 'script_missing' } })
    expect(runProcess).not.toHaveBeenCalled()
  })
})
