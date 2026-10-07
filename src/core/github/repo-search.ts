// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { optionalBoolean, optionalNumber, optionalString } from '../internal/json'

/** The license object nested inside a GitHub repository search result. */
export interface GitHubRepoLicense {
  spdx_id: string | null
  name: string | null
}

/** One repository from a GitHub repository search response. */
export interface GitHubRepoSummary {
  full_name: string
  description: string | null
  stargazers_count: number
  language: string | null
  license: GitHubRepoLicense | null
  default_branch: string
  html_url: string
  updated_at: string
}

/** The decoded `GET /search/repositories` response. */
export interface RepoSearchResult {
  total_count: number
  incomplete_results: boolean
  items: GitHubRepoSummary[]
}

/**
 * Decodes a GitHub repository search payload.
 *
 * Mirrors `parseReleases`: a non-object payload is treated as an empty result,
 * and malformed *items* (non-objects, or objects with wrong-typed fields) are
 * skipped rather than aborting the whole list. Never throws, so a bad response
 * cannot crash the search UI.
 */
export function parseRepoSearch(json: unknown): RepoSearchResult {
  if (!isRecord(json)) {
    return { total_count: 0, incomplete_results: false, items: [] }
  }

  const items = Array.isArray(json['items']) ? json['items'].filter(isRepoEntry) : []

  return {
    total_count: optionalNumber(json['total_count']) ?? 0,
    incomplete_results: optionalBoolean(json['incomplete_results']) ?? false,
    items: items.map(repoFromJson)
  }
}

/** Returns `true` for a plain (non-array, non-null) object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Dart accepts a JSON value for a `String?` field only when it is a string or null. */
function isStringOrNull(value: unknown): boolean {
  return value == null || typeof value === 'string'
}

/** Dart accepts a JSON value for an `int?` field only when it is an integer or null. */
function isIntegerOrNull(value: unknown): boolean {
  return value == null || (typeof value === 'number' && Number.isInteger(value))
}

/** Whether an item's `license` is null or an object with string-or-null fields. */
function isLicenseOrNull(value: unknown): boolean {
  if (value == null) return true
  if (!isRecord(value)) return false
  return isStringOrNull(value['spdx_id']) && isStringOrNull(value['name'])
}

/**
 * Returns `true` when `entry` is a well-formed repository item. Mirrors the
 * explicit type checks `parseReleases` performs before it hands an entry to the
 * model.
 */
function isRepoEntry(entry: unknown): entry is Record<string, unknown> {
  if (!isRecord(entry)) return false
  if (!isStringOrNull(entry['full_name'])) return false
  if (!isStringOrNull(entry['description'])) return false
  if (!isIntegerOrNull(entry['stargazers_count'])) return false
  if (!isStringOrNull(entry['language'])) return false
  if (!isStringOrNull(entry['default_branch'])) return false
  if (!isStringOrNull(entry['html_url'])) return false
  if (!isStringOrNull(entry['updated_at'])) return false
  if (!isLicenseOrNull(entry['license'])) return false
  return true
}

/** Coerces a validated repository entry into a {@link GitHubRepoSummary}. */
function repoFromJson(json: Record<string, unknown>): GitHubRepoSummary {
  const license = json['license']

  return {
    full_name: optionalString(json['full_name']) ?? '',
    description: optionalString(json['description']),
    stargazers_count: optionalNumber(json['stargazers_count']) ?? 0,
    language: optionalString(json['language']),
    license: isRecord(license)
      ? { spdx_id: optionalString(license['spdx_id']), name: optionalString(license['name']) }
      : null,
    default_branch: optionalString(json['default_branch']) ?? '',
    html_url: optionalString(json['html_url']) ?? '',
    updated_at: optionalString(json['updated_at']) ?? ''
  }
}
