// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { APP_NAME, APP_VERSION } from '@core/index'
import { matchesArchitecture, matchesGlobPattern } from '@core/glob-pattern'
import type { GithubAssetOption } from '@core/github/asset-options'
import { parseRepoSearch } from '@core/github/repo-search'
import type { RepoSearchResult } from '@core/github/repo-search'
import type { InstallType } from '@core/models/install-type'
import type { Release, ReleaseAsset } from '@core/models/release'
import { parseReleases } from '@core/models/release'
import { createNodeHttpClient } from './http'
import type { HttpClient, HttpResponse } from './http'
import type { DebugLogSink } from './debug-logger'

const BASE_URL = 'https://api.github.com'

/**
 * Descriptive User-Agent. GitHub rejects requests without one, and asks
 * integrators to identify themselves with a product token and a contact URL.
 * The Dart original resolves `AutoNex/<version>` from `PackageInfo` at
 * runtime; here the version is the compile-time core constant.
 */
const DEFAULT_USER_AGENT = `${APP_NAME}/${APP_VERSION} (+https://github.com/thexmeta/autonex)`

/** Default bound for a single GitHub request, enforced with an `AbortController`. */
const DEFAULT_TIMEOUT_MS = 15_000

/** Default number of releases requested when the setting is absent. */
const DEFAULT_RELEASES_PER_PAGE = 100

export interface GitHubServiceOptions {
  /** Transport override for tests; defaults to the Node `fetch` wrapper. */
  readonly httpClient?: HttpClient
  /** Overrides the default descriptive User-Agent. */
  readonly userAgent?: string
  /** Per-request timeout in milliseconds. */
  readonly timeoutMs?: number
  /**
   * Settings source. Mirrors `SettingsService.getGithubToken()` /
   * `getEffectiveReleasesPerPage()`: the token and the per-page count are read
   * from the persisted settings map on every request. Typed as a plain record
   * because the Dart settings file is an untyped map whose numeric fields may
   * have been hand-edited into strings.
   */
  readonly getSettings?: () => Promise<Record<string, unknown>>
  /** Debug sink; a no-op by default so tests stay quiet. */
  readonly debugLog?: DebugLogSink
  /**
   * Classifies an asset filename into an install format. Production wiring
   * passes the installer's `identifyAssetType`; the default rejects everything,
   * so a mis-wired service offers no install options rather than guessing.
   */
  readonly identifyAssetType?: (filename: string) => InstallType | null
}

export interface GetLatestReleaseOptions {
  readonly assetFilterPattern?: string | null
  readonly tagPrefix?: string | null
  readonly architectures?: readonly string[] | null
  readonly includePrerelease?: boolean
}

export interface FilterAssetsOptions {
  readonly assetFilterPattern?: string | null
  readonly architectures?: readonly string[] | null
}

/** Sort keys accepted by `GET /search/repositories`. */
export type RepoSearchSort = 'stars' | 'forks' | 'help-wanted-issues' | 'updated'

export interface SearchRepositoriesOptions {
  readonly sort?: RepoSearchSort | null
  readonly order?: 'asc' | 'desc' | null
  /** Results per page (GitHub caps this at 100). */
  readonly perPage?: number | null
  readonly page?: number | null
}

/**
 * Raised when GitHub answers a search with 403/429, which for an authenticated
 * search means the rate limit was hit. Carries the response's rate-limit hints
 * so the UI can tell the user when to retry.
 */
export class GitHubRateLimitError extends Error {
  readonly status: number
  /** `Retry-After` header in seconds, or `null`. */
  readonly retryAfter: number | null
  /** `x-ratelimit-reset` header (epoch seconds), or `null`. */
  readonly reset: number | null
  /** `x-ratelimit-remaining` header, or `null`. */
  readonly remaining: number | null

  constructor(
    status: number,
    limits: {
      readonly retryAfter: number | null
      readonly reset: number | null
      readonly remaining: number | null
    }
  ) {
    // The reset/retry hints are folded into the message because Electron's
    // structured clone drops custom Error properties when a rejection crosses
    // IPC; the renderer parses them back out to show when to retry.
    const hints = [`status ${status}`]
    if (limits.reset != null) hints.push(`reset ${limits.reset}`)
    if (limits.retryAfter != null) hints.push(`retry-after ${limits.retryAfter}`)
    super(`GitHub search rate limit exceeded (${hints.join(', ')})`)
    this.name = 'GitHubRateLimitError'
    this.status = status
    this.retryAfter = limits.retryAfter
    this.reset = limits.reset
    this.remaining = limits.remaining
  }
}

/** Parses an integer response header, or `null` when absent/unparseable. */
function integerHeader(headers: Readonly<Record<string, string>>, name: string): number | null {
  const raw = headers[name]
  if (raw == null || raw.trim().length === 0) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * The latest release plus the asset chosen to install, ported from the
 * untyped map returned by `GitHubService.getLatestReleaseWithPackageInfo`.
 */
export interface ReleasePackageInfo {
  readonly release: Release
  readonly packageName: string | null
  readonly downloadUrl: string | null
  readonly releaseDate: string | null
}

/** The latest release's installable assets, for the package picker. */
export interface GithubReleaseAssets {
  readonly tagName: string | null
  readonly assets: GithubAssetOption[]
  /** ISO-8601 timestamp of the release, or `null` when it is unknown. */
  readonly publishedAt: string | null
  /**
   * Every asset name that survived the requested glob/architecture filters,
   * including non-installable ones (`.sha256`, `.txt`, …). Present only when a
   * filter was supplied (the full-fidelity preview).
   */
  readonly matchedNames?: string[]
  /** Total number of assets on the release, before any filtering. */
  readonly totalAssets?: number
}

/** Rejects a blank or path-bearing repository owner/name before any request. */
function assertValidRepoPart(value: string, label: 'owner' | 'name'): void {
  if (value.trim().length === 0 || value !== value.trim() || /[/\\\s]/.test(value)) {
    throw new Error(`Invalid repository ${label}: "${value}"`)
  }
}

/**
 * GitHub Releases client, ported from `lib/services/github_service.dart`.
 *
 * `getReleases` issues a single request with `per_page` (capped at 100 by the
 * settings service) and never follows `Link` pagination — the Dart original has
 * no such logic, so none was invented here.
 */
export class GitHubService {
  private readonly http: HttpClient
  private readonly userAgent: string
  private readonly timeoutMs: number
  private readonly getSettings: () => Promise<Record<string, unknown>>
  private readonly debugLog: DebugLogSink
  private readonly identifyAssetType: (filename: string) => InstallType | null

  constructor(options: GitHubServiceOptions = {}) {
    this.http = options.httpClient ?? createNodeHttpClient()
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.getSettings = options.getSettings ?? (async () => ({}))
    this.debugLog = options.debugLog ?? (() => {})
    this.identifyAssetType = options.identifyAssetType ?? (() => null)
  }

  /**
   * Fetches the repository's releases in a single request.
   *
   * `perPage` overrides the persisted setting; when omitted, the value from
   * settings is used (falling back to 100). A malformed 200 body is reported as
   * a load failure rather than surfacing a raw parse error, matching the Dart
   * original.
   */
  async getReleases(
    owner: string,
    repo: string,
    options: { readonly perPage?: number } = {}
  ): Promise<Release[]> {
    const perPage = options.perPage ?? (await this.resolveReleasesPerPage())
    const url =
      `${BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
      `/releases?per_page=${perPage}`

    const response = await this.request(url)
    if (response.status === 200) {
      try {
        return parseReleases(response.body, (reason) => {
          void this.debugLog('GitHubService', `Skipping malformed release entry: ${reason}`)
        })
      } catch (error) {
        throw new Error(
          `Failed to load releases: ${response.status} (malformed response: ${String(error)})`,
          { cause: error }
        )
      }
    }
    throw new Error(`Failed to load releases: ${response.status}`)
  }

  /**
   * Fetches a repository's metadata. Ported from `getRepository` (~:199-216).
   *
   * A non-200 status is reported as a load failure; a 200 whose body is not a
   * JSON object is reported as a malformed response rather than surfacing a
   * raw parse error.
   */
  async getRepository(owner: string, repo: string): Promise<Record<string, unknown>> {
    const url = `${BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`

    const response = await this.request(url)
    if (response.status === 200) {
      try {
        const decoded: unknown = JSON.parse(response.body)
        if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
          throw new Error('Expected a JSON object')
        }
        return decoded as Record<string, unknown>
      } catch (error) {
        throw new Error(
          `Failed to load repository: ${response.status} (malformed response: ${String(error)})`,
          { cause: error }
        )
      }
    }
    throw new Error(`Failed to load repository: ${response.status}`)
  }

  /**
   * Searches GitHub repositories. Ported from the Dart original's repository
   * search, extended with the sort/order/page parameters the UI exposes.
   *
   * The request goes through the same private {@link request} as every other
   * call, so it inherits the descriptive User-Agent, the `Authorization: Bearer`
   * token from settings (when configured) and the `AbortController` timeout. A
   * missing token simply means an unauthenticated, lower-rate-limit request.
   *
   * A 403/429 is mapped to a typed {@link GitHubRateLimitError} carrying the
   * response's rate-limit headers, because GitHub signals throttling that way.
   */
  async searchRepositories(
    query: string,
    options: SearchRepositoriesOptions = {}
  ): Promise<RepoSearchResult> {
    const { sort, order, perPage, page } = options

    const params = [`q=${encodeURIComponent(query)}`]
    if (sort != null) params.push(`sort=${sort}`)
    if (order != null) params.push(`order=${order}`)
    if (perPage != null) params.push(`per_page=${perPage}`)
    if (page != null) params.push(`page=${page}`)
    const url = `${BASE_URL}/search/repositories?${params.join('&')}`

    const response = await this.request(url)

    if (response.status === 403 || response.status === 429) {
      throw new GitHubRateLimitError(response.status, {
        retryAfter: integerHeader(response.headers, 'retry-after'),
        reset: integerHeader(response.headers, 'x-ratelimit-reset'),
        remaining: integerHeader(response.headers, 'x-ratelimit-remaining')
      })
    }

    if (response.status !== 200) {
      throw new Error(`Failed to search repositories: ${response.status}`)
    }

    try {
      return parseRepoSearch(JSON.parse(response.body))
    } catch (error) {
      throw new Error(
        `Failed to search repositories: ${response.status} (malformed response: ${String(error)})`,
        { cause: error }
      )
    }
  }

  /**
   * Returns the newest release that survives the release filters and has at
   * least one asset surviving the asset filters, with `assets` narrowed to the
   * matching subset. Returns `null` when nothing matches.
   */
  async getLatestRelease(
    owner: string,
    repo: string,
    options: GetLatestReleaseOptions = {}
  ): Promise<Release | null> {
    return (await this.findLatestMatchingRelease(owner, repo, options))?.release ?? null
  }

  /**
   * The newest release surviving the release filters that has at least one
   * asset surviving the asset filters, together with the release's *pre-filter*
   * asset count (which the narrowed copy loses).
   */
  private async findLatestMatchingRelease(
    owner: string,
    repo: string,
    options: GetLatestReleaseOptions
  ): Promise<{ release: Release; totalAssets: number } | null> {
    const { assetFilterPattern, tagPrefix, architectures, includePrerelease = false } = options

    const releases = await this.getReleases(owner, repo)

    const filteredReleases = releases.filter((release) => {
      if (!includePrerelease && release.prerelease) return false
      if (tagPrefix != null && tagPrefix.trim().length > 0) {
        const searchPrefix = tagPrefix.trim().toLowerCase()
        if (!release.tagName.toLowerCase().startsWith(searchPrefix)) return false
      }
      return true
    })

    for (const release of filteredReleases) {
      const filteredAssets = this.filterAssets(release, { assetFilterPattern, architectures })
      if (filteredAssets.length > 0) {
        return {
          release: release.copyWith({ assets: filteredAssets }),
          totalAssets: release.assets.length
        }
      }
    }

    return null
  }

  /**
   * Returns the latest matching release together with the asset chosen to
   * install. Ported from `getLatestReleaseWithPackageInfo` (~:95-141).
   *
   * The asset is the first one matching any requested architecture; when no
   * architecture filter is set, or none matches, it falls back to the first
   * asset in the (already asset-filtered) release. Returns `null` when there is
   * no matching release.
   */
  async getLatestReleaseWithPackageInfo(
    owner: string,
    repo: string,
    options: GetLatestReleaseOptions = {}
  ): Promise<ReleasePackageInfo | null> {
    const { architectures } = options

    const release = await this.getLatestRelease(owner, repo, options)
    if (release === null) return null

    // Find the best matching asset.
    let bestAsset: ReleaseAsset | null = null
    for (const asset of release.assets) {
      if (architectures != null && architectures.length > 0) {
        for (const arch of architectures) {
          if (matchesArchitecture(asset.name, arch)) {
            bestAsset = asset
            break
          }
        }
      } else {
        bestAsset = asset
        break
      }
      if (bestAsset !== null) break
    }

    if (bestAsset === null && release.assets.length > 0) {
      bestAsset = release.assets[0]
    }

    return {
      release,
      packageName: bestAsset?.name ?? null,
      downloadUrl: bestAsset?.browserDownloadUrl ?? null,
      releaseDate: release.publishedAt?.toISOString() ?? null
    }
  }

  /**
   * Fetches the latest release's installable assets for the package picker.
   *
   * Without filters this applies no asset or architecture narrowing: the
   * renderer lists every installable asset and the user (or the auto-pick)
   * chooses one. Assets whose format the installer does not recognise are
   * omitted, so every returned option is installable.
   *
   * With filters (`assetFilterPattern`/`tagPrefix`/`architectures`) the release
   * is resolved through the same glob+architecture logic the installer uses
   * ({@link getLatestRelease}), and the result additionally carries
   * `matchedNames` (every asset surviving the filters, installable or not) and
   * `totalAssets` (the release's asset count before filtering) for a
   * full-fidelity preview.
   */
  async getGithubReleaseAssets(
    owner: string,
    repo: string,
    options: {
      readonly includePrerelease?: boolean
      readonly assetFilterPattern?: string
      readonly tagPrefix?: string
      readonly architectures?: readonly string[]
    } = {}
  ): Promise<GithubReleaseAssets> {
    assertValidRepoPart(owner, 'owner')
    assertValidRepoPart(repo, 'name')

    const hasFilters =
      (options.assetFilterPattern != null && options.assetFilterPattern.length > 0) ||
      (options.tagPrefix != null && options.tagPrefix.trim().length > 0) ||
      (options.architectures != null && options.architectures.length > 0)

    if (hasFilters) {
      const match = await this.findLatestMatchingRelease(owner, repo, {
        assetFilterPattern: options.assetFilterPattern ?? null,
        tagPrefix: options.tagPrefix ?? null,
        architectures: options.architectures ?? null,
        includePrerelease: options.includePrerelease === true
      })
      if (match === null) return { tagName: null, assets: [], publishedAt: null }

      const { release, totalAssets } = match
      const assets = this.installableAssets(release)
      return {
        tagName: release.tagName,
        assets,
        publishedAt: release.publishedAt?.toISOString() ?? null,
        matchedNames: release.assets.map((asset) => asset.name),
        totalAssets
      }
    }

    const releases = await this.getReleases(owner, repo)
    const release =
      releases.find((entry) => options.includePrerelease === true || !entry.prerelease) ?? null
    if (release === null) return { tagName: null, assets: [], publishedAt: null }

    return {
      tagName: release.tagName,
      assets: this.installableAssets(release),
      publishedAt: release.publishedAt?.toISOString() ?? null
    }
  }

  /** The release's assets whose format the installer recognises, as wire options. */
  private installableAssets(release: Release): GithubAssetOption[] {
    const assets: GithubAssetOption[] = []
    for (const asset of release.assets) {
      const installType = this.identifyAssetType(asset.name)
      if (installType === null) continue
      assets.push({
        name: asset.name,
        size: asset.size,
        downloadUrl: asset.browserDownloadUrl,
        installType
      })
    }
    return assets
  }

  /**
   * Applies the asset glob pattern and architecture filters to a release's
   * assets. An empty/absent filter matches everything.
   */
  filterAssets(release: Release, options: FilterAssetsOptions = {}): ReleaseAsset[] {
    const { assetFilterPattern, architectures } = options

    return release.assets.filter((asset) => {
      const name = asset.name

      if (assetFilterPattern != null && assetFilterPattern.length > 0) {
        if (!matchesGlobPattern(name, assetFilterPattern)) return false
      }

      if (architectures != null && architectures.length > 0) {
        if (!architectures.some((arch) => matchesArchitecture(name, arch))) return false
      }

      return true
    })
  }

  /** Builds the request headers, adding the bearer token when configured. */
  private async buildHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'User-Agent': this.userAgent,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
    const token = await this.resolveToken()
    if (token !== null) {
      headers['Authorization'] = `Bearer ${token}`
    }
    return headers
  }

  /** The configured GitHub token, or `null` when unset/blank. */
  private async resolveToken(): Promise<string | null> {
    const settings = await this.getSettings()
    const token = settings['github_token']
    return typeof token === 'string' && token.length > 0 ? token : null
  }

  /** The effective `per_page` count, mirroring `int.tryParse(...) ?? 100`. */
  private async resolveReleasesPerPage(): Promise<number> {
    const settings = await this.getSettings()
    const raw = settings['github_releases_per_page']
    if (raw == null) return DEFAULT_RELEASES_PER_PAGE
    const parsed = Number.parseInt(String(raw), 10)
    return Number.isNaN(parsed) ? DEFAULT_RELEASES_PER_PAGE : parsed
  }

  /** Issues a GET with an `AbortController`-enforced timeout. */
  private async request(url: string): Promise<HttpResponse> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      return await this.http.request(url, {
        method: 'GET',
        headers: await this.buildHeaders(),
        signal: controller.signal
      })
    } finally {
      clearTimeout(timer)
    }
  }
}
