import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  REQUIRED_CARD_SKILL_FILES,
  verifyPackagedCardSkillResource
} = require('./verify-packaged-card-skill-resource.cjs')

async function createPackagedSkillFixture() {
  const resourcesDir = await mkdtemp(join(tmpdir(), 'orca-packaged-card-skill-'))
  await cp(join(process.cwd(), 'skills', 'orca-skill'), join(resourcesDir, 'orca-skill'), {
    recursive: true
  })
  return resourcesDir
}

describe('verifyPackagedCardSkillResource', () => {
  it('accepts the complete card skill runtime closure', async () => {
    const resourcesDir = await createPackagedSkillFixture()
    try {
      expect(REQUIRED_CARD_SKILL_FILES).toContain('scripts/start-card.sh')
      expect(() => verifyPackagedCardSkillResource(resourcesDir)).not.toThrow()
    } finally {
      await rm(resourcesDir, { recursive: true, force: true })
    }
  })

  it('rejects a missing runtime dependency', async () => {
    const resourcesDir = await createPackagedSkillFixture()
    try {
      await rm(join(resourcesDir, 'orca-skill', 'scripts', 'ensure-worker.sh'))

      expect(() => verifyPackagedCardSkillResource(resourcesDir)).toThrow(
        'missing required file: scripts/ensure-worker.sh'
      )
    } finally {
      await rm(resourcesDir, { recursive: true, force: true })
    }
  })

  it('rejects a required path that is not a regular file', async () => {
    const resourcesDir = await createPackagedSkillFixture()
    try {
      const scriptPath = join(resourcesDir, 'orca-skill', 'scripts', 'run-checks.sh')
      await rm(scriptPath)
      await mkdir(scriptPath)

      expect(() => verifyPackagedCardSkillResource(resourcesDir)).toThrow(
        'required path is not a regular file: scripts/run-checks.sh'
      )
    } finally {
      await rm(resourcesDir, { recursive: true, force: true })
    }
  })
})
