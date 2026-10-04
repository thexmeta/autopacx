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
