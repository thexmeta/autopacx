// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

/**
 * Parser for a pacstall/PKGBUILD `.SRCINFO` file.
 *
 * The format is a flat list of `key = value` lines. Keys may repeat (each
 * occurrence appends to an array) and may carry an architecture suffix such as
 * `source_amd64`, whose value belongs to the base `source` array. The parser is
 * deliberately tolerant: a malformed file yields a best-effort result rather
 * than throwing, because it parses untrusted remote registry data.
 */

/** A parsed `.SRCINFO` document. */
export interface PacstallPackageInfo {
  pkgname: string
  pkgver: string
  pkgdesc: string
  arch: string[]
  depends: string[]
  optdepends: string[]
  makedepends: string[]
  maintainer: string
  url: string
  license: string[]
  source: string[]
  sha256sums: string[]
}

/** The keys that accumulate into an array rather than holding a single value. */
type ArrayKey =
  'arch' | 'depends' | 'optdepends' | 'makedepends' | 'license' | 'source' | 'sha256sums'

const ARRAY_KEYS: readonly ArrayKey[] = [
  'arch',
  'depends',
  'optdepends',
  'makedepends',
  'license',
  'source',
  'sha256sums'
]

function isArrayKey(key: string): key is ArrayKey {
  return (ARRAY_KEYS as readonly string[]).includes(key)
}

/** Parses `.SRCINFO` [text], never throwing on malformed input. */
export function parseSrcInfo(text: string): PacstallPackageInfo {
  const arrays: Record<ArrayKey, string[]> = {
    arch: [],
    depends: [],
    optdepends: [],
    makedepends: [],
    license: [],
    source: [],
    sha256sums: []
  }

  let pkgname = ''
  let pkgbase = ''
  let pkgver = ''
  let pkgdesc = ''
  let maintainer = ''
  let url = ''

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue

    const eq = line.indexOf('=')
    if (eq === -1) continue

    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    if (key.length === 0) continue

    // Architecture-specific key (`source_amd64`): fold into the base array.
    const underscore = key.indexOf('_')
    if (underscore > 0) {
      const base = key.slice(0, underscore)
      if (isArrayKey(base)) {
        if (value.length > 0) arrays[base].push(value)
        continue
      }
    }

    if (isArrayKey(key)) {
      if (value.length > 0) arrays[key].push(value)
      continue
    }

    // Scalars are first-wins: a repeated key does not overwrite the first
    // value, and a blank value does not shadow a later real one.
    switch (key) {
      case 'pkgname':
        if (pkgname.length === 0) pkgname = value
        break
      case 'pkgbase':
        if (pkgbase.length === 0) pkgbase = value
        break
      case 'pkgver':
        if (pkgver.length === 0) pkgver = value
        break
      case 'pkgdesc':
        if (pkgdesc.length === 0) pkgdesc = value
        break
      case 'maintainer':
        if (maintainer.length === 0) maintainer = value
        break
      case 'url':
        if (url.length === 0) url = value
        break
      default:
        break
    }
  }

  // A split package may declare only `pkgbase`; fall back to it.
  if (pkgname.length === 0) pkgname = pkgbase

  return {
    pkgname,
    pkgver,
    pkgdesc,
    maintainer,
    url,
    ...arrays
  }
}
