// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { app, type BrowserWindow } from 'electron'

const isDev = !app.isPackaged

/**
 * Content-Security-Policy applied as a response header. Development relaxes
 * `script-src` and `connect-src` so the Vite dev server and HMR websocket work;
 * production keeps the strict policy.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  isDev ? "connect-src 'self' ws: http: https:" : "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

let sessionConfigured = false

/**
 * Applies the process-wide security policy to a window.
 *
 * Session-level handlers (CSP, permissions) are installed once; window-level
 * handlers (navigation, window open) are installed per window.
 */
export function applySecurityPolicy(window: BrowserWindow): void {
  const ses = window.webContents.session

  if (!sessionConfigured) {
    sessionConfigured = true

    ses.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...(details.responseHeaders ?? {}),
          'Content-Security-Policy': [CONTENT_SECURITY_POLICY]
        }
      })
    })

    ses.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false)
    })

    ses.setPermissionCheckHandler(() => false)
  }

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  window.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })
}
