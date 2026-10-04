// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { TrackedDebPackage } from '@core/models/tracked-deb-package'
import { createNodeHttpClient } from './http'
import type { HttpClient, HttpResponse } from './http'
import type { DebugLogSink } from './debug-logger'

/** Default bound for a single deb probe request, enforced with an `AbortController`. */
const DEFAULT_TIMEOUT_MS = 15_000

/** Status codes that mean the host refused the `HEAD` method. */
const HEAD_REJECTED = new Set([403, 405, 501])

/**
 * Metadata harvested from a single HTTP probe of a direct deb URL, ported from
 * the private `_DebRemoteInfo` in `lib/services/database_service.dart`.
 */
export interface DebRemoteInfo {
  /** Version parsed from the response, or `null` when it could not be derived. */
  readonly version: string | null
  /** Size of the remote file in bytes (as advertised), or `null`. */
  readonly fileSize: string | null
  /** Value of the `Last-Modified` header, or `null` when absent/unparseable. */
  readonly fileDate: Date | null
}

export interface DatabaseServiceOptions {
  /** Transport override for tests; defaults to the Node `fetch` wrapper. */
  readonly httpClient?: HttpClient
  /** Per-request timeout in milliseconds. */
  readonly timeoutMs?: number
  /** Debug sink; a no-op by default so tests stay quiet. */
  readonly debugLog?: DebugLogSink
}

/** The all-`null` result returned when a probe cannot derive anything. */
function emptyDebRemoteInfo(): DebRemoteInfo {
  return { version: null, fileSize: null, fileDate: null }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Remote deb metadata probe, ported from `DatabaseService._fetchDebInfo`.
 *
 * Persistence (atomic writes, corrupt-file backup) lives in
 * `src/main/store/json-store.ts`; this service only performs the HTTP probe
 * that `addDebPackage` and `checkDebPackageUpdate` depend on.
 *
 * The probe sends a `HEAD` request, falling back to a 1-byte ranged `GET` when
 * the host rejects `HEAD`, and derives the version from the
 * `Content-Disposition` filename, the final (redirected) URL or the `Location`
 * header. It never throws on a transport or parse error: an update sweep must
 * stay non-fatal even when a host is unreachable. It DOES throw for a
 * non-`https:` URL, because the downloaded bytes are installed as root.
 */
export class DatabaseService {
  private readonly http: HttpClient
  private readonly timeoutMs: number
  private readonly debugLog: DebugLogSink

  constructor(options: DatabaseServiceOptions = {}) {
    this.http = options.httpClient ?? createNodeHttpClient()
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.debugLog = options.debugLog ?? (() => {})
  }

  async fetchDebInfo(url: string): Promise<DebRemoteInfo> {
    let uri: URL
    try {
      uri = new URL(url)
    } catch (error) {
      await this.debugLog(
        'DatabaseService',
        `Invalid deb package URL "${url}": ${errorMessage(error)}`
      )
      return emptyDebRemoteInfo()
    }

    // The probed package is later downloaded and installed as root, so a
    // plaintext URL is refused outright rather than silently accepted.
    if (uri.protocol !== 'https:') {
      throw new Error(`Refusing to probe non-HTTPS deb URL: ${url}`)
    }

    try {
      let response = await this.request(uri, 'HEAD')

      // Hosts that disallow HEAD answer 405/403/501 — retry with a tiny GET.
      if (HEAD_REJECTED.has(response.status)) {
        response = await this.request(uri, 'GET', { Range: 'bytes=0-0' })
      }

      if (response.status >= 400) {
        await this.debugLog(
          'DatabaseService',
          `Deb version check for ${url} returned ${response.status}`
        )
        return { version: versionFromUrl(uri), fileSize: null, fileDate: null }
      }

      const fileSize = fileSizeFromResponse(response.headers)
      const fileDate = fileDateFromHeaders(response.headers, (lastModified) => {
        void this.debugLog(
          'DatabaseService',
          `Invalid Last-Modified header "${lastModified}": invalid date`
        )
      })

      const candidates = [
        filenameFromContentDisposition(response.headers['content-disposition'] ?? null),
        filenameFromUrl(response.url),
        filenameFromUrl(response.headers['location'] ?? null)
      ]
      for (const candidate of candidates) {
        if (candidate.length === 0) continue
        const version = TrackedDebPackage.extractVersionFromFilename(candidate)
        if (version !== null) {
          return { version, fileSize, fileDate }
        }
      }

      return { version: versionFromUrl(uri), fileSize, fileDate }
    } catch (error) {
      await this.debugLog(
        'DatabaseService',
        `Error fetching deb version for ${url}: ${errorMessage(error)}`
      )
      return { version: versionFromUrl(uri), fileSize: null, fileDate: null }
    }
  }

  /** Issues a request with an `AbortController`-enforced timeout. */
  private async request(
    uri: URL,
    method: 'GET' | 'HEAD',
    headers?: Record<string, string>
  ): Promise<HttpResponse> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      return await this.http.request(uri.toString(), {
        method,
        headers,
        signal: controller.signal
      })
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * The full size of the remote file, as a byte-count string.
 *
 * A `HEAD` response carries it in `Content-Length`; a ranged `GET` only
 * transfers one byte, so its `Content-Range` (`bytes 0-0/12345`) holds the
 * total. Returns `null` when neither header is usable.
 */
export function fileSizeFromResponse(headers: Readonly<Record<string, string>>): string | null {
  const contentRange = headers['content-range']
  if (contentRange != null) {
    const slash = contentRange.lastIndexOf('/')
    if (slash !== -1) {
      const total = contentRange.slice(slash + 1).trim()
      if (total.length > 0 && total !== '*') return total
    }
  }
  const contentLength = headers['content-length']
  if (contentLength == null || contentLength.length === 0) return null
  return contentLength
}

/** Parses the HTTP `Last-Modified` header, or `null` when absent/invalid. */
export function fileDateFromHeaders(
  headers: Readonly<Record<string, string>>,
  onInvalid?: (lastModified: string) => void
): Date | null {
  const lastModified = headers['last-modified']
  if (lastModified == null || lastModified.length === 0) return null
  const parsed = new Date(lastModified)
  if (Number.isNaN(parsed.getTime())) {
    onInvalid?.(lastModified)
    return null
  }
  return parsed
}

/** The last path segment of [url], or `''` when there is none / it is unparseable. */
export function filenameFromUrl(url: string | null): string {
  if (url == null || url.length === 0) return ''
  try {
    return filenameFromPathname(new URL(url).pathname)
  } catch {
    return ''
  }
}

/** The version embedded in [uri]'s filename, or `null` when none is found. */
export function versionFromUrl(uri: URL | null): string | null {
  if (uri === null) return null
  const filename = filenameFromPathname(uri.pathname)
  if (filename.length === 0) return null
  return TrackedDebPackage.extractVersionFromFilename(filename)
}

/**
 * Pulls the filename out of a `Content-Disposition` header value such as
 * `attachment; filename="app_1.2.3_amd64.deb"`. Handles the unquoted form and
 * strips any directory component. The RFC 5987 `filename*=UTF-8''...` form is
 * recognised but, like the Dart original, the `UTF-8` prefix is left in place
 * because quotes are stripped before the prefix is searched for.
 */
export function filenameFromContentDisposition(header: string | null): string {
  if (header == null || header.length === 0) return ''
  for (const part of header.split(';')) {
    const trimmed = part.trim()
    if (!trimmed.toLowerCase().startsWith('filename')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    let value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/"/g, '')
      .replace(/'/g, '')
    // RFC 5987 encoded form: filename*=UTF-8''app_1.2.3.deb
    const prefix = value.toLowerCase().indexOf("utf-8''")
    if (prefix !== -1) value = value.slice(prefix + 7)
    const name = value.split('/').pop()?.split('\\').pop()?.trim() ?? ''
    if (name.length > 0) return name
  }
  return ''
}

/**
 * Dart's `Uri.pathSegments.last`: drops the leading empty segment of an
 * absolute path, and returns `''` for a root path or a trailing slash.
 */
function filenameFromPathname(pathname: string): string {
  if (pathname.length === 0) return ''
  const segments = pathname.split('/')
  const parts = pathname.startsWith('/') ? segments.slice(1) : segments
  return parts.length > 0 ? (parts[parts.length - 1] ?? '') : ''
}
