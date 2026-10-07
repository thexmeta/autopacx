// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

/**
 * Parsing helpers for GitHub `owner/repo` references.
 *
 * This module is part of the framework-free core: it imports nothing from
 * Electron, Node.js or the DOM. The only ambient global it relies on is the
 * WHATWG `URL`, which exists in every process (the same global is already used
 * by `TrackedDebPackage.filename`).
 */

/** A parsed GitHub repository reference. */
export interface RepoReference {
  readonly owner: string
  readonly name: string
}

/**
 * A single GitHub slug part. Mirrors `assertValidRepoPart` in
 * `github-service.ts`: a part may not be blank, may not contain a slash,
 * backslash or whitespace, and must be already trimmed. The allowed character
 * set is the GitHub slug alphabet (alphanumerics plus `.`, `_` and `-`).
 */
const REPO_PART_PATTERN = /^[A-Za-z0-9._-]+$/

/** Hosts accepted for a full URL reference. */
const REPO_HOSTS = new Set(['github.com', 'www.github.com'])

/**
 * Parses a repository reference into its `{ owner, name }` parts.
 *
 * Accepts a bare `owner/repo` slug as well as a full `https://github.com/...`
 * URL, and tolerates the shapes a user may paste: a trailing slash, a trailing
 * `.git`, a `?query`, a `#fragment`, and any deeper path such as `/releases` or
 * `/releases/tag/<x>`. Only the first two path segments are used.
 *
 * Returns `null` for anything that is not a well-formed GitHub repository
 * reference (a non-GitHub host, a single segment, or a part that fails the slug
 * check).
 */
export function parseRepoReference(input: string): RepoReference | null {
  const trimmed = input.trim()
  if (trimmed.length === 0) return null

  let pathname: string
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    let url: URL
    try {
      url = new URL(trimmed)
    } catch {
      return null
    }
    if (!REPO_HOSTS.has(url.hostname.toLowerCase())) return null
    pathname = url.pathname
  } else {
    // Not a URL: drop the query string and fragment manually.
    pathname = trimmed.split('#')[0].split('?')[0]
  }

  const segments = pathname
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)

  if (segments.length < 2) return null

  const owner = segments[0]
  const rawName = segments[1]
  const name = rawName.toLowerCase().endsWith('.git') ? rawName.slice(0, -'.git'.length) : rawName

  if (!REPO_PART_PATTERN.test(owner) || !REPO_PART_PATTERN.test(name)) return null

  return { owner, name }
}

/** Formats an `owner`/`name` pair as a canonical `owner/name` reference. */
export function formatRepoReference(owner: string, name: string): string {
  return `${owner}/${name}`
}
