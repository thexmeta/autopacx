// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { InstallType } from '@core/models/install-type'
import type { TrackedApp } from '@core/models/tracked-app'

/**
 * The executable name a release installs as, ported from `_executableName` in
 * `lib/ui/upgrade_flow.dart`: the basename of the first token of the stored
 * launch command, else the stored package name, else the repo name lower-cased
 * (matching the GitHub binary naming convention).
 */
export function executableName(app: TrackedApp): string {
  const token = firstToken(app.launchCommand)
  if (token !== null && token.length > 0) return basename(token)
  if (app.packageName !== null && app.packageName.length > 0) return app.packageName
  return app.repoName.toLowerCase()
}

/**
 * Whether the user must choose a destination for `type`.
 *
 * Only a raw binary install needs one: the package-managed types (deb, rpm,
 * flatpak) and AppImage place their own files and ignore the path. Mirrors
 * `needsInstallTarget` in `upgrade_flow.dart`.
 */
export function needsInstallTarget(type: string | null): boolean {
  return type === InstallType.binary
}

function firstToken(command: string | null): string | null {
  if (command === null) return null
  const trimmed = command.trim()
  if (trimmed.length === 0) return null
  return trimmed.split(/\s+/)[0]
}

/** Dart's `p.basename`, without pulling `node:path` into the renderer. */
function basename(filePath: string): string {
  const parts = filePath.split('/')
  return parts[parts.length - 1] ?? filePath
}

/** Strips trailing slashes so two spellings of a directory compare equal. */
function trimTrailingSlashes(filePath: string): string {
  return filePath.trim().replace(/\/+$/, '')
}

/**
 * Joins a candidate directory and a binary name into a full target path,
 * without pulling `node:path` into the renderer. A trailing slash on the
 * directory is tolerated; an empty name yields `''` so the caller can fall back
 * to "no explicit target".
 */
export function joinInstallTarget(dir: string, binaryName: string): string {
  const name = binaryName.trim()
  if (name.length === 0) return ''
  const trimmedDir = trimTrailingSlashes(dir)
  return trimmedDir.length === 0 ? name : `${trimmedDir}/${name}`
}

/**
 * The final path component of a POSIX path. A path that ends in a slash (or is
 * empty) has no basename, so it yields `''` — which is how a bare directory is
 * detected.
 */
export function installTargetBasename(filePath: string): string {
  const trimmed = filePath.trim()
  if (trimmed.length === 0) return ''
  return basename(trimmed)
}

/**
 * Whether `candidatePath` is the directory named by `configuredDir`.
 *
 * The renderer has no `HOME`, so a `~`-prefixed configured path (e.g.
 * `~/.local/bin`) matches any absolute candidate ending in that suffix.
 */
export function candidateMatchesDir(candidatePath: string, configuredDir: string): boolean {
  const target = trimTrailingSlashes(configuredDir)
  if (target.length === 0) return false
  const candidate = trimTrailingSlashes(candidatePath)
  if (candidate === target) return true
  if (target.startsWith('~/')) return candidate.endsWith(`/${target.slice(2)}`)
  return false
}
