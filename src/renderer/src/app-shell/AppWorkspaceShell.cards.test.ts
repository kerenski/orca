import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./AppWorkspaceShell.tsx', import.meta.url), 'utf8')

describe('workspace shell page mounts', () => {
  it('lazy mounts cards without changing the tasks branch', () => {
    expect(source).toContain(
      "const WecirDevCardPage = lazy(() => import('../components/wecir-dev/WecirDevCardPage'))"
    )
    expect(source).toContain("{activeView === 'cards' ? <WecirDevCardPage /> : null}")
    expect(source).toContain("{activeView === 'tasks' ? <TaskPage /> : null}")
    expect(source).toContain("const TaskPage = lazy(() => import('../components/TaskPage'))")
  })
})
