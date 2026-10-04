// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { spawn } from 'node:child_process'

/** Mirrors Dart's `ProcessResult` for the fields the ported services consume. */
export interface ProcessResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

/**
 * Runs an executable with an argv array and resolves with its result.
 *
 * Never a shell string: every call passes `spawn(executable, args)`, so no
 * value is ever re-parsed by a shell.
 */
export type ProcessRunner = (executable: string, args: readonly string[]) => Promise<ProcessResult>

/**
 * Runs `executable` with an argv array — never a shell string — and collects
 * both output streams.
 *
 * Both stdout and stderr are drained: a child that fills the pipe buffer while
 * only one stream is read would block forever. `stdin` is ignored so a tool
 * that would otherwise wait for input cannot hang the caller. A failed spawn
 * (e.g. `ENOENT`) resolves with exit code `-1` rather than rejecting, matching
 * the callers' "treat any failure as no answer" handling.
 */
export function runProcess(executable: string, args: readonly string[]): Promise<ProcessResult> {
  return new Promise<ProcessResult>((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(executable, [...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      resolve({ exitCode: -1, stdout: '', stderr: toMessage(error) })
      return
    }

    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let settled = false

    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk))

    const finish = (exitCode: number): void => {
      if (settled) return
      settled = true
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8')
      })
    }

    child.once('error', () => finish(-1))
    child.once('close', (code) => finish(code ?? -1))
  })
}

/** Best-effort human-readable form of an unknown thrown value. */
function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
