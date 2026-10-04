// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { shell } from 'electron'
import type { ExternalLinkLike } from './ports'

/**
 * Hosts this app is willing to hand to the user's browser.
 *
 * The renderer only ever needs to open GitHub repository/release/asset URLs;
 * an allowlist keeps a compromised renderer from turning `openExternal` into a
 * generic URL opener (e.g. `file://`, `mailto:`, an attacker-controlled host).
 */
const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  'github.com',
  'raw.githubusercontent.com',
  'objects.githubusercontent.com'
])

/**
 * Whether `raw` is an `https://` URL on an allowlisted host.
 *
 * `URL` normalises the host to lowercase and strips a trailing dot, so
 * `HTTPS://GitHub.com/…` and `https://github.com./…` are accepted while
 * `http://github.com/…`, `https://github.com.evil.example/…` and
 * `https://user:pass@evil.example/…` are not.
 */
export function isAllowedExternalUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  return ALLOWED_HOSTS.has(url.hostname)
}

/** The Electron `shell.openExternal` signature, injectable for tests. */
export type ShellOpener = (url: string) => Promise<void>

/**
 * Opens an external URL after validating its scheme and host.
 *
 * This is the only place in `src/main/` that calls `shell.openExternal`; the
 * IPC handler delegates here so the allowlist cannot be bypassed.
 */
export class ExternalLinkService implements ExternalLinkLike {
  constructor(private readonly openExternal: ShellOpener = (url) => shell.openExternal(url)) {}

  async open(url: string): Promise<void> {
    if (!isAllowedExternalUrl(url)) {
      throw new Error(`Refusing to open disallowed URL: ${url}`)
    }
    await this.openExternal(url)
  }
}
