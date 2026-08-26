import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { resolveCardSkillRuntimePath, resolveCardSkillScriptPath } from './card-skill-resource-path'

describe('resolveCardSkillScriptPath', () => {
  it('resolves the source skill from the development project root', () => {
    expect(
      resolveCardSkillScriptPath({
        isPackaged: false,
        projectRoot: join('workspace', 'orca'),
        resourcesPath: join('ignored', 'resources')
      })
    ).toBe(join('workspace', 'orca', 'skills', 'orca-skill', 'scripts', 'start-card.sh'))
  })

  it('resolves the copied skill from packaged resources', () => {
    expect(
      resolveCardSkillScriptPath({
        isPackaged: true,
        projectRoot: join('ignored', 'project'),
        resourcesPath: join('Orca.app', 'Contents', 'Resources')
      })
    ).toBe(join('Orca.app', 'Contents', 'Resources', 'orca-skill', 'scripts', 'start-card.sh'))
  })

  it('rejects a packaged layout without resourcesPath', () => {
    expect(() =>
      resolveCardSkillScriptPath({ isPackaged: true, projectRoot: join('workspace', 'orca') })
    ).toThrow('Packaged card skill resources path is unavailable')
  })
})

describe('resolveCardSkillRuntimePath', () => {
  it('uses the initialized application root in development', () => {
    const environment = {
      getAppPath: vi.fn(() => join('app', 'root')),
      isPackaged: vi.fn(() => false)
    }

    expect(
      resolveCardSkillRuntimePath({
        environment,
        cwd: join('wrong', 'cwd'),
        resourcesPath: join('ignored', 'resources')
      })
    ).toBe(join('app', 'root', 'skills', 'orca-skill', 'scripts', 'start-card.sh'))
    expect(environment.isPackaged).toHaveBeenCalledOnce()
    expect(environment.getAppPath).toHaveBeenCalledOnce()
  })

  it('uses packaged resources when the initialized environment is packaged', () => {
    expect(
      resolveCardSkillRuntimePath({
        environment: {
          getAppPath: () => join('ignored', 'app'),
          isPackaged: () => true
        },
        cwd: join('ignored', 'cwd'),
        resourcesPath: join('app', 'Resources')
      })
    ).toBe(join('app', 'Resources', 'orca-skill', 'scripts', 'start-card.sh'))
  })

  it('treats a plain Node fallback as development even when resourcesPath exists', () => {
    expect(
      resolveCardSkillRuntimePath({
        cwd: join('plain', 'node', 'cwd'),
        resourcesPath: join('misleading', 'resources')
      })
    ).toBe(join('plain', 'node', 'cwd', 'skills', 'orca-skill', 'scripts', 'start-card.sh'))
  })
})
