import { spawn } from 'node:child_process'

export type ProcessSpec = {
  program: string
  args?: readonly string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number | null
  maxOutputBytes?: number
  signal?: AbortSignal
}

export type ProcessResult = {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024

export function runProcess(spec: ProcessSpec): Promise<ProcessResult> {
  if (spec.signal?.aborted) {
    return Promise.resolve({ code: null, signal: null, stdout: '', stderr: '', timedOut: false })
  }
  return new Promise((resolve, reject) => {
    const child = spawn(spec.program, [...(spec.args ?? [])], {
      cwd: spec.cwd,
      env: spec.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const maxOutputBytes = spec.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0)
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0)
    let timedOut = false
    let settled = false

    const append = (
      current: Buffer<ArrayBufferLike>,
      chunk: Buffer | string
    ): Buffer<ArrayBufferLike> => {
      if (current.length >= maxOutputBytes) {
        return current
      }
      const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      return Buffer.concat([current, incoming.subarray(0, maxOutputBytes - current.length)])
    }
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout = append(stdout, chunk)
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr = append(stderr, chunk)
    })

    const terminate = (): void => {
      try {
        child.kill()
      } catch {}
    }
    const onAbort = (): void => terminate()
    spec.signal?.addEventListener('abort', onAbort, { once: true })
    const timer =
      spec.timeoutMs === null
        ? undefined
        : setTimeout(() => {
            timedOut = true
            terminate()
          }, spec.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    timer?.unref?.()

    const cleanup = (): void => {
      clearTimeout(timer)
      spec.signal?.removeEventListener('abort', onAbort)
    }
    child.once('error', (error) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      reject(error)
    })
    child.once('close', (code, signal) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve({
        code,
        signal,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
        timedOut
      })
    })
  })
}
