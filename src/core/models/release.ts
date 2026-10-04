// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { optionalBoolean, optionalNumber, optionalString } from '../internal/json'

export interface ReleaseAssetInit {
  name: string
  browserDownloadUrl: string
  contentType: string
  size: number
}

/** A downloadable file attached to a GitHub release. */
export class ReleaseAsset {
  readonly name: string
  readonly browserDownloadUrl: string
  readonly contentType: string
  readonly size: number

  constructor(init: ReleaseAssetInit) {
    this.name = init.name
    this.browserDownloadUrl = init.browserDownloadUrl
    this.contentType = init.contentType
    this.size = init.size
  }

  static fromJson(json: Record<string, unknown>): ReleaseAsset {
    return new ReleaseAsset({
      name: optionalString(json['name']) ?? '',
      browserDownloadUrl: optionalString(json['browser_download_url']) ?? '',
      contentType: optionalString(json['content_type']) ?? '',
      size: optionalNumber(json['size']) ?? 0
    })
  }
}

export interface ReleaseInit {
  tagName: string
  name?: string | null
  body?: string | null
  publishedAt?: Date | null
  prerelease: boolean
  draft: boolean
  assets: ReleaseAsset[]
}

/** A GitHub release. */
export class Release {
  readonly tagName: string
  readonly name: string | null
  readonly body: string | null
  readonly publishedAt: Date | null
  readonly prerelease: boolean
  readonly draft: boolean
  readonly assets: ReleaseAsset[]

  constructor(init: ReleaseInit) {
    this.tagName = init.tagName
    this.name = init.name ?? null
    this.body = init.body ?? null
    this.publishedAt = init.publishedAt ?? null
    this.prerelease = init.prerelease
    this.draft = init.draft
    this.assets = init.assets
  }

  /** Returns a copy with the supplied fields replaced; `null` keeps the old value. */
  copyWith(
    init: {
      tagName?: string
      name?: string | null
      body?: string | null
      publishedAt?: Date | null
      prerelease?: boolean
      draft?: boolean
      assets?: ReleaseAsset[]
    } = {}
  ): Release {
    return new Release({
      tagName: init.tagName ?? this.tagName,
      name: init.name ?? this.name,
      body: init.body ?? this.body,
      publishedAt: init.publishedAt ?? this.publishedAt,
      prerelease: init.prerelease ?? this.prerelease,
      draft: init.draft ?? this.draft,
      assets: init.assets ?? this.assets
    })
  }

  static fromJson(json: Record<string, unknown>): Release {
    const rawPublishedAt = json['published_at']
    const rawAssets = json['assets']

    let publishedAt: Date | null = null
    if (typeof rawPublishedAt === 'string') {
      const parsed = new Date(rawPublishedAt)
      publishedAt = Number.isNaN(parsed.getTime()) ? new Date(0) : parsed
    }

    const assets = Array.isArray(rawAssets)
      ? rawAssets
          .filter(
            (asset): asset is Record<string, unknown> => typeof asset === 'object' && asset !== null
          )
          .map((asset) => ReleaseAsset.fromJson(asset))
      : []

    return new Release({
      tagName: optionalString(json['tag_name']) ?? '',
      name: optionalString(json['name']),
      body: optionalString(json['body']),
      publishedAt,
      prerelease: optionalBoolean(json['prerelease']) ?? false,
      draft: optionalBoolean(json['draft']) ?? false,
      assets
    })
  }
}

/**
 * Parses a GitHub releases response body into {@link Release} objects.
 *
 * Ported from `GitHubService.parseReleases` in
 * `lib/services/github_service.dart`. A body that is not a JSON array throws,
 * so the caller can surface a genuinely malformed response. Malformed *entries*
 * — a non-object element, or one whose fields are the wrong type — are skipped
 * rather than aborting the whole list; when `onSkip` is supplied it is invoked
 * with a short reason so the caller can log the skip (the Dart original calls
 * `dlog('GitHubService', 'Skipping malformed release entry: $e')`).
 *
 * The Dart original relies on `Release.fromJson`'s hard casts (`as String?`,
 * `as bool?`) to throw on a wrong-typed field; the TypeScript model coerces
 * leniently instead, so the type checks are made explicit here to keep the same
 * skip semantics.
 */
export function parseReleases(body: string, onSkip?: (reason: string) => void): Release[] {
  const decoded: unknown = JSON.parse(body)
  if (!Array.isArray(decoded)) {
    throw new SyntaxError('Expected a JSON list of releases')
  }

  const releases: Release[] = []
  for (const entry of decoded) {
    if (!isReleaseEntry(entry)) {
      onSkip?.(summarizeReleaseEntry(entry))
      continue
    }
    releases.push(Release.fromJson(entry))
  }
  return releases
}

/** A short, bounded description of an entry that failed validation. */
function summarizeReleaseEntry(entry: unknown): string {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return `unexpected entry: ${Array.isArray(entry) ? 'List' : typeof entry}`
  }
  try {
    const json = JSON.stringify(entry)
    return json.length > 200 ? `${json.slice(0, 200)}…` : json
  } catch {
    return 'unserialisable entry'
  }
}

/** Dart accepts a JSON value for a `String?` field only when it is a string or null. */
function isStringOrNull(value: unknown): boolean {
  return value == null || typeof value === 'string'
}

/** Dart accepts a JSON value for a `bool?` field only when it is a boolean or null. */
function isBooleanOrNull(value: unknown): boolean {
  return value == null || typeof value === 'boolean'
}

/** Dart accepts a JSON value for an `int?` field only when it is an integer or null. */
function isIntegerOrNull(value: unknown): boolean {
  return value == null || (typeof value === 'number' && Number.isInteger(value))
}

/**
 * Returns `true` when `entry` would survive Dart's `Release.fromJson` casts.
 * A non-list `assets` value is tolerated (Dart coerces it to an empty list), as
 * are non-object asset elements (Dart drops them with `whereType`).
 */
function isReleaseEntry(entry: unknown): entry is Record<string, unknown> {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return false
  const record = entry as Record<string, unknown>

  if (!isStringOrNull(record['tag_name'])) return false
  if (!isStringOrNull(record['name'])) return false
  if (!isStringOrNull(record['body'])) return false
  if (!isBooleanOrNull(record['prerelease'])) return false
  if (!isBooleanOrNull(record['draft'])) return false

  const assets = record['assets']
  if (Array.isArray(assets)) {
    for (const asset of assets) {
      if (typeof asset !== 'object' || asset === null || Array.isArray(asset)) continue
      const fields = asset as Record<string, unknown>
      if (!isStringOrNull(fields['name'])) return false
      if (!isStringOrNull(fields['browser_download_url'])) return false
      if (!isStringOrNull(fields['content_type'])) return false
      if (!isIntegerOrNull(fields['size'])) return false
    }
  }

  return true
}
