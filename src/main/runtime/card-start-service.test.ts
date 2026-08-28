import { describe, expect, it, vi } from 'vitest'

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile: execFileMock }))
vi.mock('../github/github-api-repository', () => ({
  getOriginGitHubApiRepository: vi.fn(async () => ({
    owner: 'stablyai',
    repo: 'orca',
    host: 'github.com'
  }))
}))
vi.mock('../github/gh-utils', () => ({
  ghExecFileAsync: vi.fn(async (args: string[]) => {
    if (args[0] === 'issue' && args[1] === 'view') {
      return {
        stdout: JSON.stringify({
          title: 'M1-04 implement dependency graph',
          body: 'body',
          isPullRequest: false
        })
      }
    }
    return { stdout: '' }
  }),
  ghRepoExecOptions: vi.fn(() => ({})),
  githubRepoContext: vi.fn(() => ({}))
}))

import { startCardOnRuntimeHost } from './card-start-service'
import { ghExecFileAsync } from '../github/gh-utils'

function repo(overrides: Record<string, unknown> = {}) {
  return {
    id: 'repo-1',
    path: '/repo',
    displayName: 'orca',
    badgeColor: '#000',
    addedAt: 1,
    ...overrides
  } as never
}

describe('startCardOnRuntimeHost', () => {
  it('runs the issue prelude and starts the SOP with the selected tier', async () => {
    execFileMock.mockImplementationOnce(
      (
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, result: { stdout: string; stderr: string }) => void
      ) => {
        callback(null, {
          stdout: JSON.stringify({
            schemaVersion: 1,
            ok: true,
            controllerPtyId: 'pty-1',
            worktreeId: 'wt-1',
            worktreePath: '/repo-m1-04',
            branch: 'm1-04',
            workerAgent: 'kimi',
            issue: 64,
            card: 'm1-04',
            tier: 'complex'
          }),
          stderr: ''
        })
      }
    )

    const result = await startCardOnRuntimeHost(
      { issue: 64, card: 'm1-04', tier: 'complex', repoId: 'repo-1' },
      repo()
    )

    expect(result).toMatchObject({ ok: true, tier: 'complex', issue: 64 })
    expect(ghExecFileAsync).toHaveBeenCalledWith(
      [
        'issue',
        'comment',
        '64',
        '-R',
        'stablyai/orca',
        '--body',
        expect.stringContaining('难度 complex')
      ],
      expect.anything()
    )
    expect(execFileMock).toHaveBeenCalledWith(
      'bash',
      [
        expect.stringContaining('start-card.sh'),
        '--issue',
        '64',
        '--card',
        'm1-04',
        '--tier',
        'complex',
        '--json'
      ],
      expect.objectContaining({ cwd: '/repo' }),
      expect.any(Function)
    )
  })

  it('rejects remote execution before running gh or the script', async () => {
    execFileMock.mockClear()
    vi.mocked(ghExecFileAsync).mockClear()

    const result = await startCardOnRuntimeHost(
      { issue: 64, card: 'm1-04', tier: 'simple', repoId: 'repo-1' },
      repo({ executionHostId: 'ssh:host-1' })
    )

    expect(result).toMatchObject({ ok: false, error: { code: 'card_start_host_unsupported' } })
    expect(ghExecFileAsync).not.toHaveBeenCalled()
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('rejects pull requests without commenting or starting a card', async () => {
    vi.mocked(ghExecFileAsync).mockImplementationOnce(async () => ({
      stdout: JSON.stringify({
        title: 'M1-04 implement dependency graph',
        body: '',
        isPullRequest: true
      }),
      stderr: ''
    }))
    execFileMock.mockClear()

    const result = await startCardOnRuntimeHost(
      { issue: 64, card: 'm1-04', tier: 'medium', repoId: 'repo-1' },
      repo()
    )

    expect(result).toMatchObject({ ok: false, error: { code: 'card_start_issue_mismatch' } })
    expect(ghExecFileAsync).toHaveBeenCalledOnce()
    expect(execFileMock).not.toHaveBeenCalled()
  })
})
