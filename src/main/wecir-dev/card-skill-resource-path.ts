import { join } from 'node:path'

const START_CARD_RELATIVE_PATH = join('scripts', 'start-card.sh')

type CardSkillResourcePathOptions = {
  isPackaged: boolean
  projectRoot: string
  resourcesPath?: string
}

type CardSkillRuntimeEnvironment = {
  getAppPath(): string
  isPackaged(): boolean
}

type CardSkillRuntimePathOptions = {
  environment?: CardSkillRuntimeEnvironment
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
  const app = loadElectronApp()
  return resolveCardSkillRuntimePath({
    environment: app
      ? { getAppPath: () => app.getAppPath(), isPackaged: () => app.isPackaged }
      : undefined,
    cwd: process.cwd(),
    resourcesPath: process.resourcesPath
  })
}

function loadElectronApp(): { getAppPath(): string; isPackaged: boolean } | null {
  try {
    return require('electron').app ?? null
  } catch {
    return null
  }
}
