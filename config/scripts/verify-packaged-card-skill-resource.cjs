const { lstatSync } = require('node:fs')
const { join } = require('node:path')

const REQUIRED_CARD_SKILL_FILES = [
  'scripts/start-card.sh',
  'tiers.json',
  'templates/controller-prompt.tpl.md',
  'scripts/ensure-worker.sh',
  'scripts/send-dev-task.sh',
  'scripts/send-review.sh',
  'scripts/send-review-round.sh',
  'scripts/poll-dev-local.sh',
  'scripts/wait-dev-watchdog.sh',
  'scripts/check-ci.sh',
  'scripts/kimi-trust.sh',
  'scripts/run-checks.sh'
]

function verifyPackagedCardSkillResource(resourcesDir) {
  const skillRoot = join(resourcesDir, 'orca-skill')
  for (const relativePath of REQUIRED_CARD_SKILL_FILES) {
    const filePath = join(skillRoot, relativePath)
    let metadata
    try {
      metadata = lstatSync(filePath)
    } catch {
      throw new Error(
        `[verify-packaged-card-skill-resource] missing required file: ${relativePath}`
      )
    }
    if (!metadata.isFile()) {
      throw new Error(
        `[verify-packaged-card-skill-resource] required path is not a regular file: ${relativePath}`
      )
    }
  }
  console.log(
    `[verify-packaged-card-skill-resource] OK — verified ${REQUIRED_CARD_SKILL_FILES.length} files`
  )
}

module.exports = { REQUIRED_CARD_SKILL_FILES, verifyPackagedCardSkillResource }
