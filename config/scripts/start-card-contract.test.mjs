import { chmod, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')
const SCRIPT_PATH = path.join(REPO_ROOT, 'skills', 'orca-skill', 'scripts', 'start-card.sh')
const SKILL_ROOT = path.dirname(path.dirname(SCRIPT_PATH))
const TEST_CARD = `m1-07-test-${process.pid}-${Date.now().toString(36)}`
const TEST_WORKTREE_PATH = `/tmp/worktree-${TEST_CARD}`
const TEST_WORKTREE_ID = `repo::${TEST_WORKTREE_PATH}`
const TEST_BRANCH = `kerenski/${TEST_CARD}`
const TEST_ORPHAN_PATH = `/tmp/orphan-${TEST_CARD}`
const TEST_CARD_STATE_PATH = `/tmp/${TEST_CARD}`
let sandbox
let binDirectory
let shellSensitiveScriptPath

const orcaStub = String.raw`#!/bin/bash
set -eu
printf '%s\n' "$*" >> "$STUB_STATE"
case "$1 $2" in
  "worktree list")
    if [ "$SCENARIO" = duplicate ] || [ "$SCENARIO" = force ] || [ "$SCENARIO" = invalid-rm ]; then
      printf '{"ok":true,"result":{"worktrees":[{"displayName":"%s","path":"%s","isArchived":false}]}}\n' "$TEST_CARD" "$TEST_ORPHAN_PATH"
    elif [ "$SCENARIO" = invalid-list ]; then
      printf '%s\n' 'not-json'
    else
      printf '%s\n' '{"ok":true,"result":{"worktrees":[]}}'
    fi
    ;;
  "worktree rm")
    if [ "$SCENARIO" = invalid-rm ]; then
      printf '%s\n' '{"ok":false,"error":{"code":"failed"}}'
    else
      printf '%s\n' '{"ok":true,"result":{"removed":true}}'
    fi
    ;;
  "worktree create")
    if [ "$SCENARIO" = execution-failure ]; then
      printf '%s\n' 'private create failure' >&2
      exit 9
    elif [ "$SCENARIO" = invalid-worktree ]; then
      printf '{"ok":true,"result":{"worktree":{"path":"%s"}}}\n' "$TEST_WORKTREE_PATH"
    else
      printf '{"ok":true,"result":{"worktree":{"id":"%s","path":"%s","branch":"%s"}}}\n' "$TEST_WORKTREE_ID" "$TEST_WORKTREE_PATH" "$TEST_BRANCH"
    fi
    ;;
  "terminal create")
    if [ "$SCENARIO" = wrong-binding ]; then
      printf '%s\n' '{"ok":true,"result":{"terminal":{"handle":"term-1","ptyId":"pty-1","worktreeId":"other-worktree"}}}'
    elif [ "$SCENARIO" = invalid-terminal ]; then
      printf '{"ok":true,"result":{"terminal":{"worktreeId":"%s"}}}\n' "$TEST_WORKTREE_ID"
    elif [ "$SCENARIO" = delayed-show ] || [ "$SCENARIO" = show-invalid-json ] || [ "$SCENARIO" = show-wrong-handle ] || [ "$SCENARIO" = show-wrong-worktree ] || [ "$SCENARIO" = show-timeout ]; then
      printf '{"ok":true,"result":{"terminal":{"handle":"term-1","worktreeId":"%s"}}}\n' "$TEST_WORKTREE_ID"
    else
      printf '{"ok":true,"result":{"terminal":{"handle":"term-1","ptyId":"pty-1","worktreeId":"%s"}}}\n' "$TEST_WORKTREE_ID"
    fi
    ;;
  "terminal show")
    if [ "$SCENARIO" = show-invalid-json ]; then
      printf '%s\n' 'not-json'
    elif [ "$SCENARIO" = show-wrong-handle ]; then
      printf '{"ok":true,"result":{"terminal":{"handle":"other-term","ptyId":"pty-1","worktreeId":"%s"}}}\n' "$TEST_WORKTREE_ID"
    elif [ "$SCENARIO" = show-wrong-worktree ]; then
      printf '%s\n' '{"ok":true,"result":{"terminal":{"handle":"term-1","ptyId":"pty-1","worktreeId":"other-worktree"}}}'
    else
      SHOW_COUNT=0
      [ ! -f "$SHOW_COUNT_FILE" ] || SHOW_COUNT="$(cat "$SHOW_COUNT_FILE")"
      SHOW_COUNT=$((SHOW_COUNT + 1))
      printf '%s\n' "$SHOW_COUNT" > "$SHOW_COUNT_FILE"
      if [ "$SCENARIO" = delayed-show ] && [ "$SHOW_COUNT" -ge 3 ]; then
        printf '{"ok":true,"result":{"terminal":{"handle":"term-1","ptyId":"pty-delayed","worktreeId":"%s"}}}\n' "$TEST_WORKTREE_ID"
      else
        printf '{"ok":true,"result":{"terminal":{"handle":"term-1","worktreeId":"%s"}}}\n' "$TEST_WORKTREE_ID"
      fi
    fi
    ;;
  "terminal send") printf '%s\n' '{"ok":true,"result":{"accepted":true}}' ;;
  "terminal read") printf '%s\n' 'TOP-SECRET-SCREEN ensure-worker' ;;
  *) printf 'unexpected orca invocation: %s\n' "$*" >&2; exit 12 ;;
esac
`

const gitStub = String.raw`#!/bin/bash
set -eu
case "$1 $2 $3" in
  "remote get-url origin") printf '%s\n' 'git@github.com:fork-owner/orca.git' ;;
  "symbolic-ref --short HEAD") printf '%s\n' 'feature/base' ;;
  *) printf 'unexpected git invocation: %s\n' "$*" >&2; exit 13 ;;
esac
`

async function executableStub(name, content) {
  const target = path.join(binDirectory, name)
  await writeFile(target, content)
  await chmod(target, 0o755)
}

function runScript({
  scenario = 'success',
  json = true,
  force = false,
  pathValue,
  scriptPath = SCRIPT_PATH
} = {}) {
  const statePath = path.join(sandbox, `state-${scenario}-${Math.random()}`)
  const showCountPath = path.join(sandbox, `show-count-${scenario}-${Math.random()}`)
  const args = [scriptPath, '--issue', '7', '--card', TEST_CARD, '--tier', 'medium']
  if (force) {
    args.push('--force')
  }
  if (json) {
    args.push('--json')
  }
  const result = spawnSync('/bin/bash', args, {
    cwd: sandbox,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: pathValue ?? `${binDirectory}:/usr/bin:/bin`,
      SCENARIO: scenario,
      SHOW_COUNT_FILE: showCountPath,
      STUB_STATE: statePath,
      TEST_BRANCH,
      TEST_CARD,
      TEST_ORPHAN_PATH,
      TEST_WORKTREE_ID,
      TEST_WORKTREE_PATH
    }
  })
  return { ...result, showCountPath, statePath }
}

function parseResult(result) {
  const lines = result.stdout.trim().split('\n')
  expect(lines).toHaveLength(1)
  return JSON.parse(lines[0])
}

beforeAll(async () => {
  sandbox = await mkdtemp(path.join(tmpdir(), 'orca-start-card-contract-'))
  binDirectory = path.join(sandbox, 'bin')
  const shellSensitiveSkillRoot = path.join(sandbox, 'skill-$(not-executed)')
  shellSensitiveScriptPath = path.join(shellSensitiveSkillRoot, 'scripts', 'start-card.sh')
  await Promise.all([
    mkdir(binDirectory),
    cp(SKILL_ROOT, shellSensitiveSkillRoot, { recursive: true })
  ])
  await Promise.all([
    executableStub('orca', orcaStub),
    executableStub('git', gitStub),
    executableStub('gh', '#!/bin/bash\nexit 0\n'),
    executableStub('sleep', '#!/bin/bash\nexit 0\n')
  ])
})

afterAll(async () => {
  await Promise.all([
    rm(sandbox, { recursive: true }),
    rm(TEST_CARD_STATE_PATH, { recursive: true, force: true })
  ])
})

describe('start-card.sh contract', () => {
  it('uses a PTY returned directly by terminal create', async () => {
    const result = runScript()

    expect(result.status).toBe(0)
    expect(parseResult(result)).toEqual({
      schemaVersion: 1,
      ok: true,
      controllerPtyId: 'pty-1',
      worktreeId: TEST_WORKTREE_ID,
      worktreePath: TEST_WORKTREE_PATH,
      branch: TEST_BRANCH,
      workerAgent: 'kimi',
      issue: 7,
      card: TEST_CARD,
      tier: 'medium'
    })
    const state = await readFile(result.statePath, 'utf8')
    expect(state).not.toContain('terminal show')
    expect(state).toContain(SKILL_ROOT)
    expect(state).not.toContain('{{SKILL_DIR}}')
    expect(state).not.toContain('$HOME/.orca-skill')
    expect(result.stderr).toContain('[1/4]')
    expect(result.stdout).not.toContain('TOP-SECRET-SCREEN')
    expect(result.stderr).not.toContain('TOP-SECRET-SCREEN')
  })

  it('shell-escapes the injected skill root', async () => {
    const result = runScript({ scriptPath: shellSensitiveScriptPath })

    expect(result.status).toBe(0)
    const state = await readFile(result.statePath, 'utf8')
    expect(state).toContain('skill-\\$(not-executed)')
    expect(state).not.toContain('skill-$(not-executed)')
  })

  it('resolves a delayed PTY through terminal show', async () => {
    const result = runScript({ scenario: 'delayed-show' })

    expect(result.status).toBe(0)
    expect(parseResult(result)).toMatchObject({ ok: true, controllerPtyId: 'pty-delayed' })
    expect(await readFile(result.showCountPath, 'utf8')).toBe('3\n')
  })

  it('rejects non-JSON terminal show output', () => {
    const result = runScript({ scenario: 'show-invalid-json' })

    expect(result.status).toBe(3)
    expect(parseResult(result)).toMatchObject({
      ok: false,
      error: { code: 'invalid_script_output' }
    })
  })

  it.each(['show-wrong-handle', 'show-wrong-worktree'])(
    'rejects a mismatched terminal show binding: %s',
    (scenario) => {
      const result = runScript({ scenario })

      expect(result.status).toBe(3)
      expect(parseResult(result)).toMatchObject({
        ok: false,
        error: { code: 'pty_binding_lost' }
      })
    }
  )

  it('fails when terminal show never reports a PTY', async () => {
    const result = runScript({ scenario: 'show-timeout' })

    expect(result.status).toBe(3)
    expect(parseResult(result)).toMatchObject({
      ok: false,
      error: { code: 'pty_binding_lost', retryable: true }
    })
    expect(await readFile(result.showCountPath, 'utf8')).toBe('6\n')
  })

  it('returns structured dependency failure without jq', () => {
    const result = runScript({ pathValue: path.join(sandbox, 'empty-path') })

    expect(result.status).toBe(1)
    expect(parseResult(result)).toMatchObject({
      schemaVersion: 1,
      ok: false,
      error: { code: 'dependency_missing', details: { dependency: 'jq' } }
    })
  })

  it.each(['invalid-list', 'invalid-worktree', 'invalid-terminal'])(
    'rejects invalid Orca receipt: %s',
    (scenario) => {
      const result = runScript({ scenario })

      expect(result.status).toBe(3)
      expect(parseResult(result)).toMatchObject({
        schemaVersion: 1,
        ok: false,
        error: { code: 'invalid_script_output', retryable: false }
      })
      expect(result.stderr).not.toContain('not-json')
    }
  )

  it('rejects a terminal bound to another worktree', () => {
    const result = runScript({ scenario: 'wrong-binding' })

    expect(result.status).toBe(3)
    expect(parseResult(result)).toMatchObject({
      ok: false,
      error: { code: 'pty_binding_lost' }
    })
  })

  it('uses the orphan-worktree exit code without force', () => {
    const result = runScript({ scenario: 'duplicate' })

    expect(result.status).toBe(2)
    expect(parseResult(result)).toMatchObject({
      ok: false,
      error: { code: 'worktree_invalid', details: { worktreePath: TEST_ORPHAN_PATH } }
    })
  })

  it('removes an orphan and continues when forced', async () => {
    const result = runScript({ scenario: 'force', force: true })

    expect(result.status).toBe(0)
    expect(parseResult(result)).toMatchObject({ ok: true, card: TEST_CARD })
    expect(await readFile(result.statePath, 'utf8')).toContain(
      `worktree rm --worktree path:${TEST_ORPHAN_PATH} --force --json`
    )
  })

  it('rejects an unsuccessful force-removal receipt', () => {
    const result = runScript({ scenario: 'invalid-rm', force: true })

    expect(result.status).toBe(3)
    expect(parseResult(result)).toMatchObject({
      ok: false,
      error: { code: 'invalid_script_output' }
    })
  })

  it('returns a structured execution failure without raw command output', () => {
    const result = runScript({ scenario: 'execution-failure' })

    expect(result.status).toBe(3)
    expect(parseResult(result)).toMatchObject({
      ok: false,
      error: { code: 'unknown', retryable: true }
    })
    expect(result.stdout).not.toContain('private create failure')
  })

  it('keeps CARD_STARTED output in legacy mode', () => {
    const result = runScript({ json: false })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('CARD_STARTED')
    expect(result.stdout).toContain(`branch       : ${TEST_BRANCH}`)
  })

  it('is non-executable and still runs through bash', async () => {
    const mode = (await stat(SCRIPT_PATH)).mode & 0o777
    const result = runScript()

    expect(mode).toBe(0o644)
    expect(result.status).toBe(0)
  })
})
