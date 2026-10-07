// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import * as path from 'node:path'
import { APP_NAME } from '@core/index'
import { parseSrcInfo } from '@core/pacstall/srcinfo'
import type { PacstallPackageInfo } from '@core/pacstall/srcinfo'
import { createNodeHttpClient } from './http'
import type { HttpClient, HttpResponse } from './http'
import { PACKAGE_NAME_PATTERN } from './privileged-helper'
import type { DebugLogSink } from './debug-logger'

/**
 * Client for the pacstall package registry (a GitHub repository, by default
 * `pacstall/pacstall-programs`).
 *
 * The registry exposes three plain-text resources over
 * `raw.githubusercontent.com`:
 *
 * - `packagelist` — one package name per line (the index).
 * - `srclist` — concatenated `.SRCINFO` blocks, used for description search.
 * - `packages/<name>/.SRCINFO` — a single package's metadata.
 *
 * The index and srclist are cached on disk under the app-data directory with a
 * TTL and ETag revalidation; package info is cached in memory for a shorter
 * TTL. All transport goes through an injectable {@link HttpClient}, so no test
 * touches the network.
 */

/** Default registry repository (`<owner>/<repo>`). */
export const DEFAULT_REGISTRY_REPO = 'pacstall/pacstall-programs'

/** Default registry branch. */
export const DEFAULT_REGISTRY_BRANCH = 'master'

/** Default index/srclist cache TTL, in hours, when the setting is absent. */
export const DEFAULT_INDEX_TTL_HOURS = 24

/** Per-package `.SRCINFO` in-memory cache TTL: 6 hours. */
const PACKAGE_INFO_TTL_MS = 6 * 60 * 60 * 1000

/** Default bound for a single registry request. */
const DEFAULT_TIMEOUT_MS = 15_000

const RAW_BASE_URL = 'https://raw.githubusercontent.com'

export const REGISTRY_INDEX_CACHE_FILE = 'pacstall-registry-cache.json'
export const REGISTRY_SRCLIST_CACHE_FILE = 'pacstall-srclist-cache.json'

/** Narrow seam consumed by `PacstallService.checkUpdate`. */
export interface PacstallRegistryLike {
  fetchPackageInfo(name: string): Promise<PacstallPackageInfo>
}

export interface PacstallRegistryOptions {
  /** Transport override for tests; defaults to the Node `fetch` wrapper. */
  readonly httpClient?: HttpClient
  /** App-data directory holding the cache files; injectable for tests. */
  readonly appSupportDirectory?: () => Promise<string>
  /** Per-request timeout in milliseconds. */
  readonly timeoutMs?: number
  /** Registry repository as `<owner>/<repo>`. */
  readonly registryRepo?: string
  /** Registry branch. */
  readonly registryBranch?: string
  /** Settings source for `pacstall_index_ttl_hours`. */
  readonly getSettings?: () => Promise<Record<string, unknown>>
  /** Debug sink; a no-op by default so tests stay quiet. */
  readonly debugLog?: DebugLogSink
}

export interface PacstallIndexResult {
  readonly names: string[]
  readonly fetchedAt: string
  readonly fromCache: boolean
}

export interface PacstallSrcListResult {
  readonly content: string
  readonly fetchedAt: string
  readonly fromCache: boolean
}

interface IndexCacheFile {
  readonly fetchedAt: string
  readonly etag?: string
  readonly names: string[]
}

interface SrcListCacheFile {
  readonly fetchedAt: string
  readonly etag?: string
  readonly content: string
}

interface CachedPackageInfo {
  readonly info: PacstallPackageInfo
  readonly at: number
}

/**
 * Default app-data directory, mirroring path_provider's Linux behaviour
 * (`$XDG_DATA_HOME/<app>` or `~/.local/share/<app>`).
 */
function defaultAppSupportDirectory(): Promise<string> {
  const xdg = process.env['XDG_DATA_HOME']
  const base = xdg != null && xdg.length > 0 ? xdg : path.join(homedir(), '.local', 'share')
  return Promise.resolve(path.join(base, APP_NAME))
}

/** Splits a plain newline-delimited list into non-empty, non-comment entries. */
export function parseNameList(body: string): string[] {
  const names: string[] = []
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    names.push(line)
  }
  return names
}

export class PacstallRegistry implements PacstallRegistryLike {
  private readonly http: HttpClient
  private readonly appSupportDirectory: () => Promise<string>
  private readonly timeoutMs: number
  private readonly registryRepo: string
  private readonly registryBranch: string
  private readonly getSettings: () => Promise<Record<string, unknown>>
  private readonly debugLog: DebugLogSink
  private readonly packageInfoCache = new Map<string, CachedPackageInfo>()

  constructor(options: PacstallRegistryOptions = {}) {
    this.http = options.httpClient ?? createNodeHttpClient()
    this.appSupportDirectory = options.appSupportDirectory ?? defaultAppSupportDirectory
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.registryRepo = options.registryRepo ?? DEFAULT_REGISTRY_REPO
    this.registryBranch = options.registryBranch ?? DEFAULT_REGISTRY_BRANCH
    this.getSettings = options.getSettings ?? (async () => ({}))
    this.debugLog = options.debugLog ?? (() => {})
  }

  /**
   * Fetches the package-name index, preferring the on-disk cache while it is
   * fresh. `force` bypasses the TTL (an ETag revalidation still runs, so an
   * unchanged upstream answers 304 and refreshes `fetchedAt` without a
   * re-download).
   */
  async fetchIndex(options: { readonly force?: boolean } = {}): Promise<PacstallIndexResult> {
    const cached = await this.readCacheFile<IndexCacheFile>(REGISTRY_INDEX_CACHE_FILE)
    const ttlMs = await this.resolveTtlMs()

    if (!options.force && cached != null && this.isFresh(cached.fetchedAt, ttlMs)) {
      return { names: cached.names, fetchedAt: cached.fetchedAt, fromCache: true }
    }

    const headers = conditionalHeaders(cached?.etag)
    const response = await this.request(`${await this.rawBase()}/packagelist`, headers)

    if (response.status === 304 && cached != null) {
      const fetchedAt = new Date().toISOString()
      await this.writeCacheFile(REGISTRY_INDEX_CACHE_FILE, { ...cached, fetchedAt })
      return { names: cached.names, fetchedAt, fromCache: true }
    }

    if (response.status !== 200) {
      throw new Error(`Failed to fetch pacstall registry index: ${response.status}`)
    }

    const names = parseNameList(response.body)
    const fetchedAt = new Date().toISOString()
    const etag = response.headers['etag']
    await this.writeCacheFile(
      REGISTRY_INDEX_CACHE_FILE,
      etag != null && etag.length > 0 ? { fetchedAt, etag, names } : { fetchedAt, names }
    )
    return { names, fetchedAt, fromCache: false }
  }

  /**
   * Fetches the `srclist` (concatenated `.SRCINFO` blocks) used for description
   * search. Cached like the index, with its own file and the same TTL.
   */
  async fetchSrcList(options: { readonly force?: boolean } = {}): Promise<PacstallSrcListResult> {
    const cached = await this.readCacheFile<SrcListCacheFile>(REGISTRY_SRCLIST_CACHE_FILE)
    const ttlMs = await this.resolveTtlMs()

    if (!options.force && cached != null && this.isFresh(cached.fetchedAt, ttlMs)) {
      return { content: cached.content, fetchedAt: cached.fetchedAt, fromCache: true }
    }

    const headers = conditionalHeaders(cached?.etag)
    const response = await this.request(`${await this.rawBase()}/srclist`, headers)

    if (response.status === 304 && cached != null) {
      const fetchedAt = new Date().toISOString()
      await this.writeCacheFile(REGISTRY_SRCLIST_CACHE_FILE, { ...cached, fetchedAt })
      return { content: cached.content, fetchedAt, fromCache: true }
    }

    if (response.status !== 200) {
      throw new Error(`Failed to fetch pacstall srclist: ${response.status}`)
    }

    const content = response.body
    const fetchedAt = new Date().toISOString()
    const etag = response.headers['etag']
    await this.writeCacheFile(
      REGISTRY_SRCLIST_CACHE_FILE,
      etag != null && etag.length > 0 ? { fetchedAt, etag, content } : { fetchedAt, content }
    )
    return { content, fetchedAt, fromCache: false }
  }

  /**
   * Fetches and parses a single package's `.SRCINFO`, served from a short-lived
   * in-memory cache when possible. The name is validated with the shared
   * package-name grammar before it is interpolated into the URL, so a crafted
   * name cannot escape the `packages/<name>/.SRCINFO` path.
   */
  async fetchPackageInfo(name: string): Promise<PacstallPackageInfo> {
    if (!PACKAGE_NAME_PATTERN.test(name)) {
      throw new Error(`Invalid pacstall package name: ${name}`)
    }

    const cached = this.packageInfoCache.get(name)
    if (cached != null && Date.now() - cached.at < PACKAGE_INFO_TTL_MS) {
      return cached.info
    }

    const url = `${await this.rawBase()}/packages/${encodeURIComponent(name)}/.SRCINFO`
    const response = await this.request(url)
    if (response.status !== 200) {
      throw new Error(`Failed to fetch pacstall package info for ${name}: ${response.status}`)
    }

    const info = parseSrcInfo(response.body)
    this.packageInfoCache.set(name, { info, at: Date.now() })
    return info
  }

  /**
   * Base URL of the raw registry content.
   *
   * The repo/branch come from the `pacstall_registry_repo` /
   * `pacstall_registry_branch` settings when present (resolved on every call,
   * like the index TTL), falling back to the constructor values. Reading them
   * live means a mirror change made through `setSettings` takes effect without
   * reconstructing the registry.
   */
  private async rawBase(): Promise<string> {
    const settings = await this.getSettings()
    const repo = nonEmptyString(settings['pacstall_registry_repo']) ?? this.registryRepo
    const branch = nonEmptyString(settings['pacstall_registry_branch']) ?? this.registryBranch
    const encodedRepo = repo
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/')
    return `${RAW_BASE_URL}/${encodedRepo}/${encodeURIComponent(branch)}`
  }

  /** The effective index/srclist TTL, in milliseconds. */
  private async resolveTtlMs(): Promise<number> {
    const settings = await this.getSettings()
    const raw = settings['pacstall_index_ttl_hours']
    const hours = typeof raw === 'number' ? raw : Number.parseFloat(String(raw))
    const effective = Number.isFinite(hours) ? hours : DEFAULT_INDEX_TTL_HOURS
    return Math.max(0, effective) * 60 * 60 * 1000
  }

  private isFresh(fetchedAt: string, ttlMs: number): boolean {
    const timestamp = Date.parse(fetchedAt)
    if (Number.isNaN(timestamp)) return false
    return Date.now() - timestamp < ttlMs
  }

  private async readCacheFile<T>(fileName: string): Promise<T | null> {
    try {
      const directory = await this.appSupportDirectory()
      const raw = await fs.readFile(path.join(directory, fileName), 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
      return parsed as T
    } catch (error) {
      await this.debugLog('PacstallRegistry', `Could not read ${fileName}: ${String(error)}`)
      return null
    }
  }

  /** Atomically writes a cache file (temp file + `rename`). */
  private async writeCacheFile(fileName: string, value: unknown): Promise<void> {
    const directory = await this.appSupportDirectory()
    await fs.mkdir(directory, { recursive: true })
    const target = path.join(directory, fileName)
    const tmp = `${target}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
    await fs.writeFile(tmp, JSON.stringify(value), 'utf8')
    try {
      await fs.rename(tmp, target)
    } catch (error) {
      await fs.rm(tmp, { force: true })
      throw error
    }
  }

  /** Issues a GET with an `AbortController`-enforced timeout. */
  private async request(
    url: string,
    headers?: Readonly<Record<string, string>>
  ): Promise<HttpResponse> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      return await this.http.request(url, {
        method: 'GET',
        headers,
        signal: controller.signal
      })
    } finally {
      clearTimeout(timer)
    }
  }
}

/** Adds `If-None-Match` when a cached ETag is available. */
function conditionalHeaders(etag: string | undefined): Record<string, string> | undefined {
  if (etag == null || etag.length === 0) return undefined
  return { 'If-None-Match': etag }
}

/** Returns a trimmed non-empty string value, or `null` for anything else. */
function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
