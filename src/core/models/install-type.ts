// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

/**
 * How a tracked app is installed.
 *
 * Ported from `lib/models/install_type.dart`. The wire values match Dart's
 * enum `.name`, so `appImage` keeps its camel-case spelling in `toMap`.
 */
export const InstallType = {
  deb: 'deb',
  rpm: 'rpm',
  appImage: 'appImage',
  flatpak: 'flatpak',
  snap: 'snap',
  binary: 'binary',
  source: 'source'
} as const

export type InstallType = (typeof InstallType)[keyof typeof InstallType]

/** Parses [value] (case-insensitively) into an `InstallType`, or `null`. */
export function installTypeFromString(value: string | null | undefined): InstallType | null {
  if (value == null) return null
  switch (value.toLowerCase()) {
    case 'deb':
      return InstallType.deb
    case 'rpm':
      return InstallType.rpm
    case 'appimage':
      return InstallType.appImage
    case 'flatpak':
      return InstallType.flatpak
    case 'snap':
      return InstallType.snap
    case 'binary':
      return InstallType.binary
    case 'source':
      return InstallType.source
    default:
      return null
  }
}

/** Human-readable label for [type] (Dart `InstallType.displayName`). */
export function installTypeDisplayName(type: InstallType): string {
  switch (type) {
    case InstallType.deb:
      return 'DEB'
    case InstallType.rpm:
      return 'RPM'
    case InstallType.appImage:
      return 'AppImage'
    case InstallType.flatpak:
      return 'Flatpak'
    case InstallType.snap:
      return 'Snap'
    case InstallType.binary:
      return 'Binary'
    case InstallType.source:
      return 'Source'
  }
}
