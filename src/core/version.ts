// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

/**
 * Version comparison shared by `TrackedApp.hasUpdate` and
 * `TrackedDebPackage.hasUpdate`.
 *
 * Ported 1:1 from `lib/models/tracked_app.dart`. The rules below are load
 * bearing and must not be "simplified":
 *
 * - A numeric Debian revision present on exactly one side is NOT a newer
 *   version (`2.11.10-1` is a packaging revision of `2.11.10`).
 * - Prerelease suffixes compare chunk-by-chunk so `rc9 < rc10`.
 * - The numeric core is the first dotted numeric run, so `desktop-v2026.9.0`
 *   parses as `2026.9.0`.
 */

/**
 * Strips an npm package specifier prefix (`@scope/name@` or `name@`), a
 * leading `v`/`V`, trims and lowercases [version] so that
 * `@biomejs/biome@2.5.14`, `V1.0.0` and `1.0.0` all reduce to their bare
 * version.
 */
export function normalizeVersion(version: string): string {
  let v = version.trim()
  // npm dist-tags are published as `@scope/name@<version>` (or
  // `name@<version>`); only the part after the final `@` is the version.
  const at = v.lastIndexOf('@')
  if (at !== -1) {
    v = v.slice(at + 1)
  }
  if (v.startsWith('v') || v.startsWith('V')) {
    v = v.slice(1)
  }
  return v.toLowerCase()
}

/**
 * Returns `true` when [s] is shaped like a version number rather than an
 * arbitrary label.
 *
 * Accepts `1`, `2.5.14`, `v2.11.10`, `2.11.10-1`, and a prefixed release tag
 * whose version part is dotted (`desktop-v2026.9.0`). Rejects npm specifiers
 * (`@biomejs/biome@2.5.14`), junk tags (`multiplatform#1`) and filenames
 * (`download_cli.sh`, `latest.json`) so a non-version latest value can never be
 * mistaken for an upgrade.
 */
export function looksLikeVersion(s: string): boolean {
  const trimmed = s.trim()
  if (!/\d/.test(trimmed)) return false
  if (/^[vV]?\d+(\.\d+)*(-.+)?$/.test(trimmed)) return true
  // A product prefix in front of the version, e.g. Bitwarden's per-client tags
  // `desktop-v2026.9.0` / `cli-v2026.9.0`, optionally followed by a prerelease
  // suffix as in tolaria's `alpha-v2026.9.25-alpha.0006`. The prefix is only
  // accepted when the version part is DOTTED, so a bare-number tag such as
  // `multiplatform#1` still fails — `#` is not part of a product prefix.
  return /^[A-Za-z][\w.-]*[-_]v?\d+(\.\d+)+(-.+)?$/.test(trimmed)
}

/** Returns `true` when [newVersion] is strictly newer than [oldVersion]. */
export function isNewerVersion(newVersion: string, oldVersion: string): boolean {
  const newParts = parseVersion(newVersion)
  const oldParts = parseVersion(oldVersion)

  for (let i = 0; i < 3; i++) {
    if (newParts[i] > oldParts[i]) return true
    if (newParts[i] < oldParts[i]) return false
  }

  // Debian revisions (`1.0.0-1` vs `1.0.0-2`) only decide the comparison when
  // both sides carry one. A numeric revision on exactly ONE side means the two
  // strings are the same upstream version (`2.11.10-1` is a packaging revision
  // of `2.11.10`), so neither is newer. This must run before the prerelease
  // logic, where a lone `-1` would otherwise look like a prerelease.
  const newRevision = parseRevision(newVersion)
  const oldRevision = parseRevision(oldVersion)

  if ((newRevision == null) !== (oldRevision == null)) return false

  if (newRevision != null && oldRevision != null) {
    if (newRevision > oldRevision) return true
    if (newRevision < oldRevision) return false
  }

  // If major.minor.patch are equal, check if one is a prerelease.
  // A release version (no dash) is newer than a prerelease (has dash).
  const newIsPrerelease = newVersion.includes('-')
  const oldIsPrerelease = oldVersion.includes('-')

  if (!newIsPrerelease && oldIsPrerelease) return true
  if (newIsPrerelease && !oldIsPrerelease) return false

  // If both are prereleases, compare the suffixes chunk by chunk so that
  // `rc10` sorts after `rc9` instead of ordering lexicographically.
  return comparePrerelease(prereleaseSuffix(newVersion), prereleaseSuffix(oldVersion)) > 0
}

/**
 * Parses the numeric `major.minor.patch` part of [version] into exactly three
 * numbers.
 *
 * The version core is the first dotted numeric run. Splitting at the first `-`
 * instead used to truncate inside a product prefix: `desktop-v2026.9.0` has its
 * dash at index 7, so the "numeric part" came out as `desktop`, every digit was
 * stripped, and the version parsed as `[0, 0, 0]`.
 */
function parseVersion(version: string): [number, number, number] {
  const match = /\d+(?:\.\d+)*/.exec(version)
  const parts = (match?.[0] ?? '0').split('.').map((part) => {
    const parsed = Number.parseInt(part, 10)
    return Number.isNaN(parsed) ? 0 : parsed
  })
  while (parts.length < 3) {
    parts.push(0)
  }
  return [parts[0], parts[1], parts[2]]
}

/**
 * Returns the Debian revision of [version] (the leading digits after the first
 * `-`), or `null` when there is no numeric revision.
 */
function parseRevision(version: string): number | null {
  const dash = version.indexOf('-')
  if (dash === -1) return null
  const match = /^\d+/.exec(version.slice(dash + 1))
  if (match == null) return null
  const parsed = Number.parseInt(match[0], 10)
  return Number.isNaN(parsed) ? null : parsed
}

/** Returns the substring after the first `-`, or `''` when there is none. */
function prereleaseSuffix(version: string): string {
  const dash = version.indexOf('-')
  return dash === -1 ? '' : version.slice(dash + 1)
}

/**
 * Compares two prerelease suffixes, ordering digit runs numerically
 * (`rc9 < rc10`).
 */
function comparePrerelease(a: string, b: string): number {
  const aChunks = naturalChunks(a)
  const bChunks = naturalChunks(b)
  const length = Math.min(aChunks.length, bChunks.length)

  for (let i = 0; i < length; i++) {
    const aChunk = aChunks[i]
    const bChunk = bChunks[i]
    const aNum = /^\d+$/.test(aChunk) ? Number.parseInt(aChunk, 10) : null
    const bNum = /^\d+$/.test(bChunk) ? Number.parseInt(bChunk, 10) : null
    if (aNum != null && bNum != null) {
      if (aNum !== bNum) return aNum < bNum ? -1 : 1
    } else {
      const cmp = aChunk < bChunk ? -1 : aChunk > bChunk ? 1 : 0
      if (cmp !== 0) return cmp
    }
  }

  if (aChunks.length === bChunks.length) return 0
  return aChunks.length < bChunks.length ? -1 : 1
}

/** Splits [value] into alternating digit / non-digit runs. */
function naturalChunks(value: string): string[] {
  return value.match(/\d+|\D+/g) ?? []
}
