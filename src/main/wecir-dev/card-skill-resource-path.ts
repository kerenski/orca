import { join } from 'node:path'
import {
  getAppEnvironment,
  hasAppEnvironment,
  type AppEnvironment
} from '../../shared/app-environment'

const START_CARD_RELATIVE_PATH = join('scripts', 'start-card.sh')

type CardSkillResourcePathOptions = {
  isPackaged: boolean
  projectRoot: string
  resourcesPath?: string
}

type CardSkillRuntimePathOptions = {
  environment?: Pick<AppEnvironment, 'getAppPath' | 'isPackaged'>
  cwd: string
  resourcesPath?: string
}

export function resolveCardSkillScriptPath(options: CardSkillResourcePathOptions): string {
  if (options.isPackaged) {
    if (!options.resourcesPath) {
      throw new Error('Packaged card skill resources path is unavailable')
    }
    return join(options.resourcesPath, 'orca-skill', START_CARD_RELATIVE_PATH)
  }
  return join(options.projectRoot, 'skills', 'orca-skill', START_CARD_RELATIVE_PATH)
}

export function resolveCardSkillRuntimePath(options: CardSkillRuntimePathOptions): string {
  return resolveCardSkillScriptPath({
    isPackaged: options.environment?.isPackaged() ?? false,
    projectRoot: options.environment?.getAppPath() ?? options.cwd,
    resourcesPath: options.resourcesPath
  })
}

export function getCardSkillScriptPath(): string {
  return resolveCardSkillRuntimePath({
    environment: hasAppEnvironment() ? getAppEnvironment() : undefined,
    cwd: process.cwd(),
    resourcesPath: process.resourcesPath
  })
}
