// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

/**
 * Glob matching and Linux asset selection.
 *
 * Ported 1:1 from `lib/utils/glob_pattern.dart`. Every regex metacharacter is
 * escaped; only `*` and `?` keep their glob meaning.
 */

/**
 * Matches [input] against a comma-separated [pattern] list. An empty pattern
 * matches everything; a non-empty pattern with empty input matches only `*`.
 * A pattern that fails to compile falls back to a case-insensitive substring
 * match instead of throwing.
 */
export function matchesGlobPattern(input: string, pattern: string): boolean {
  if (pattern.length === 0) return true
  if (input.length === 0) return pattern === '*'

  const patterns = pattern
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)

  for (const p of patterns) {
    const regexSource = globToRegex(p)
    let regex: RegExp | null
    try {
      regex = new RegExp(regexSource, 'i')
    } catch {
      // A pattern can never be trusted to compile: fall back to a literal
      // case-insensitive substring match instead of throwing.
      regex = null
    }
    if (regex !== null) {
      if (regex.test(input)) return true
    } else if (input.toLowerCase().includes(p.toLowerCase())) {
      return true
    }
  }
  return false
}

/**
 * OS tokens that identify an asset built for a platform other than Linux.
 *
 * Deliberately excludes `android`, `ios` and `apple`: those words appear in
 * product names far more often than they mark a build target, and a whole-token
 * match on them rejects legitimate Linux artifacts. Mobile artifacts are caught
 * by extension instead.
 */
const FOREIGN_OS_TOKENS = new Set([
  'darwin',
  'macos',
  'osx',
  'win32',
  'win64',
  'windows',
  'mingw',
  'msvc',
  'cygwin',
  'freebsd'
])

/** Extensions that mark an artifact as unusable on Linux, whatever the name. */
const FOREIGN_OS_SUFFIXES = [
  '.exe',
  '.msi',
  '.dmg',
  '.pkg',
  '.app', // desktop, other OS
  '.apk',
  '.aab',
  '.ipa' // mobile
]

/**
 * Returns `true` when [fileName] names an artifact built for an OS other than
 * Linux.
 *
 * A filename is foreign when any whole alphanumeric token is a known
 * non-Linux OS marker, or when it carries a platform-specific extension.
 * Comparison is done on a lowercased, punctuation-split form so
 * `br-0.7.3-darwin_amd64.tar.gz` is recognised as a macOS build even though
 * its architecture token (`amd64`) matches the host.
 */
export function isForeignOsAsset(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  if (FOREIGN_OS_SUFFIXES.some((suffix) => lower.endsWith(suffix))) {
    return true
  }
  const tokens = lower.split(/[^a-z0-9]+/)
  return tokens.some((token) => FOREIGN_OS_TOKENS.has(token))
}

/** Returns `true` when [fileName] matches the requested [architecture]. */
export function matchesArchitecture(fileName: string, architecture: string): boolean {
  // This app targets Linux, so an architecture match on a macOS/Windows (or
  // any other non-Linux) asset is never actionable. Reject foreign-OS
  // artifacts before the architecture switch so a macOS build such as
  // `br-0.7.3-darwin_amd64.tar.gz` is never selected for `amd64`.
  if (isForeignOsAsset(fileName)) return false

  const lowerName = fileName.toLowerCase()
  const lowerArch = architecture.toLowerCase()

  switch (lowerArch) {
    case 'amd64':
    case 'x86_64':
      return (
        lowerName.includes('amd64') ||
        lowerName.includes('x86_64') ||
        lowerName.includes('x64') ||
        lowerName.includes('64-bit')
      )
    case 'arm64':
    case 'aarch64':
      return (
        lowerName.includes('arm64') || lowerName.includes('aarch64') || lowerName.includes('armv8')
      )
    case 'arm':
    case 'armhf':
    case 'armv7':
      return (
        lowerName.includes('armhf') || lowerName.includes('armv7') || lowerName.includes('arm-')
      )
    case 'i386':
    case 'x86':
      return lowerName.includes('i386') || lowerName.includes('x86') || lowerName.includes('32-bit')
    default:
      return lowerName.includes(lowerArch)
  }
}

/** Returns every architecture in [architectures] that [fileName] matches. */
export function findMatchingArchitectures(fileName: string, architectures: string[]): string[] {
  return architectures.filter((arch) => matchesArchitecture(fileName, arch))
}

/** Converts a glob pattern into an anchored, case-insensitive regex source. */
function globToRegex(pattern: string): string {
  let buffer = ''
  const trimmed = pattern.trim()

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i]
    if (char === '*') {
      buffer += '.*'
    } else if (char === '?') {
      buffer += '.'
    } else {
      buffer += escapeRegexChar(char)
    }
  }

  return `^${buffer}$`
}

/** Regex metacharacters escaped by Dart's `RegExp.escape` for a single char. */
const REGEX_SPECIAL = new Set([
  '.',
  '*',
  '+',
  '?',
  '^',
  '$',
  '{',
  '}',
  '(',
  ')',
  '|',
  '[',
  ']',
  '\\'
])

/** Escapes [char] when it is a regex metacharacter. */
function escapeRegexChar(char: string): string {
  return REGEX_SPECIAL.has(char) ? `\\${char}` : char
}
