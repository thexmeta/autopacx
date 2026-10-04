// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

/**
 * Pure sender-validation helpers for IPC.
 *
 * Kept free of Electron so the policy can be unit tested directly; `src/main/ipc.ts`
 * adapts a real `IpcMainInvokeEvent` into a {@link TrustedFrameContext}.
 */

export interface TrustedFrameContext {
  /** `event.sender.id` — the webContents that issued the call. */
  readonly senderWebContentsId: number
  /** The main window's `webContents.id`. */
  readonly expectedWebContentsId: number
  /** `event.senderFrame === event.sender.mainFrame`. */
  readonly isMainFrame: boolean
  /** `event.senderFrame?.url ?? ''`. */
  readonly senderFrameUrl: string
  /** Origins the renderer may legitimately be served from. */
  readonly allowedOrigins: readonly string[]
}

/**
 * The origin of [url], collapsing every `file:` URL to `file://` (Node reports
 * `null` for file origins, which would never match an allowlist entry).
 */
export function originOf(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'file:') return 'file://'
    return parsed.origin
  } catch {
    return null
  }
}

/**
 * Returns `true` only when the call comes from the main window's main frame and
 * an allowlisted origin.
 */
export function isTrustedFrame(context: TrustedFrameContext): boolean {
  if (context.senderWebContentsId !== context.expectedWebContentsId) return false
  if (!context.isMainFrame) return false

  const origin = originOf(context.senderFrameUrl)
  return origin !== null && context.allowedOrigins.includes(origin)
}
