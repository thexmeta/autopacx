// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

/**
 * Normalises an unknown thrown value into a human-readable message.
 *
 * IPC rejections cross the Electron boundary as plain `Error` objects (the
 * message is preserved), but a handler may also reject with a string or an
 * arbitrary value, so never assume `.message` exists.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'An unexpected error occurred.'
}
