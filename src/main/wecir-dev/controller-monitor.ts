import type { WecirDevStatus } from '../../shared/wecir-dev/contracts'

export type ControllerBinding = {
  repositoryId: string
  cardId: string
  controllerPtyId: string
  worktreeId?: string
  status: WecirDevStatus
  updatedAt: string
}

export class ControllerMonitor {
  private readonly bindings = new Map<string, ControllerBinding>()

  set(binding: ControllerBinding): void {
    this.bindings.set(binding.cardId, { ...binding })
  }

  get(cardId: string): ControllerBinding | undefined {
    const binding = this.bindings.get(cardId)
    return binding ? { ...binding } : undefined
  }

  matches(cardId: string, repositoryId: string, ptyId: string): boolean {
    const binding = this.bindings.get(cardId)
    return Boolean(
      binding && binding.repositoryId === repositoryId && binding.controllerPtyId === ptyId
    )
  }

  remove(cardId: string): void {
    this.bindings.delete(cardId)
  }

  clear(): void {
    this.bindings.clear()
  }
}
