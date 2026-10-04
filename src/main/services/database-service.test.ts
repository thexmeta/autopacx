// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { describe, expect, it, vi } from 'vitest'
import {
  DatabaseService,
  fileDateFromHeaders,
  fileSizeFromResponse,
  filenameFromContentDisposition,
  filenameFromUrl,
  versionFromUrl
} from './database-service'
import type { HttpClient, HttpRequestInit, HttpResponse } from './http'

/**
 * The Dart `test/services/database_service_test.dart` file does not exist, and
 * the integration suite exercises the deb update sweep through a mock rather
 * than HTTP. These tests were authored to cover the ported `_fetchDebInfo`
 * probe directly: the HEAD path, the ranged-GET fallback, and the
 * `Content-Disposition` / URL / `Location` filename derivation.
 */

function stubHttp(handler: (url: string, init?: HttpRequestInit) => Promise<HttpResponse>) {
  const request = vi.fn<(url: string, init?: HttpRequestInit) => Promise<HttpResponse>>(handler)
  const client: HttpClient = { request }
  return { request, client }
}

function response(init: Partial<HttpResponse> & { status: number }): HttpResponse {
  return { headers: {}, body: '', url: '', ...init }
}

describe('DatabaseService.fetchDebInfo', () => {
  it('reads version, size and date from a HEAD response', async () => {
    const { request, client } = stubHttp(async () =>
      response({
        status: 200,
        url: 'https://example.com/downloads/app_1.2.3_amd64.deb',
        headers: {
          'content-length': '12345',
          'last-modified': 'Wed, 21 Oct 2015 07:28:00 GMT',
          'content-disposition': 'attachment; filename="app_1.2.3_amd64.deb"'
        }
      })
    )
    const service = new DatabaseService({ httpClient: client })

    const info = await service.fetchDebInfo('https://example.com/app.deb')

    expect(info.version).toBe('1.2.3')
    expect(info.fileSize).toBe('12345')
    expect(info.fileDate?.toISOString()).toBe('2015-10-21T07:28:00.000Z')
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][1]?.method).toBe('HEAD')
    expect(request.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('falls back to a 1-byte ranged GET when the host rejects HEAD', async () => {
    const { request, client } = stubHttp(async (url, init) => {
      if (init?.method === 'HEAD') return response({ status: 405, url })
      return response({
        status: 206,
        url,
        headers: {
          'content-range': 'bytes 0-0/987654',
          'content-disposition': 'attachment; filename="thing_2.0.0_arm64.deb"'
        }
      })
    })
    const service = new DatabaseService({ httpClient: client })

    const info = await service.fetchDebInfo('https://example.com/thing.deb')

    expect(info.version).toBe('2.0.0')
    // The ranged GET only transfers one byte; the total comes from Content-Range.
    expect(info.fileSize).toBe('987654')
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[1][1]?.method).toBe('GET')
    expect(request.mock.calls[1][1]?.headers?.['Range']).toBe('bytes=0-0')
  })

  it('derives the version from the final (redirected) URL', async () => {
    const { client } = stubHttp(async () =>
      response({
        status: 200,
        url: 'https://cdn.example.com/releases/tool_3.4.5_amd64.deb',
        headers: { 'content-length': '10' }
      })
    )
    const service = new DatabaseService({ httpClient: client })

    const info = await service.fetchDebInfo('https://example.com/tool.deb')

    expect(info.version).toBe('3.4.5')
    expect(info.fileSize).toBe('10')
  })

  it('derives the version from the Location header as a last resort', async () => {
    const { client } = stubHttp(async (url) =>
      response({
        status: 302,
        url,
        headers: { location: 'https://cdn.example.com/tool_4.5.6_amd64.deb' }
      })
    )
    const service = new DatabaseService({ httpClient: client })

    const info = await service.fetchDebInfo('https://example.com/download')

    expect(info.version).toBe('4.5.6')
  })

  it('falls back to the version in the request URL when no filename is advertised', async () => {
    const { client } = stubHttp(async (url) =>
      response({ status: 200, url, headers: { 'content-length': '10' } })
    )
    const service = new DatabaseService({ httpClient: client })

    const info = await service.fetchDebInfo('https://example.com/path/app_7.8.9_amd64.deb')

    expect(info.version).toBe('7.8.9')
    expect(info.fileSize).toBe('10')
  })

  it('returns only the URL version when the probe answers 4xx/5xx', async () => {
    const { client } = stubHttp(async (url) => response({ status: 404, url }))
    const service = new DatabaseService({ httpClient: client })

    const info = await service.fetchDebInfo('https://example.com/app_1.0.0_amd64.deb')

    expect(info.version).toBe('1.0.0')
    expect(info.fileSize).toBeNull()
    expect(info.fileDate).toBeNull()
  })

  it('returns empty info for an unparseable URL without issuing a request', async () => {
    const { request, client } = stubHttp(async () => response({ status: 200 }))
    const service = new DatabaseService({ httpClient: client })

    const info = await service.fetchDebInfo('not a url')

    expect(info).toEqual({ version: null, fileSize: null, fileDate: null })
    expect(request).not.toHaveBeenCalled()
  })

  it('refuses a non-HTTPS URL and issues no request', async () => {
    const { request, client } = stubHttp(async () => response({ status: 200 }))
    const service = new DatabaseService({ httpClient: client })

    await expect(service.fetchDebInfo('http://example.com/app_1.0.0_amd64.deb')).rejects.toThrow(
      'non-HTTPS'
    )
    await expect(service.fetchDebInfo('ftp://example.com/app_1.0.0_amd64.deb')).rejects.toThrow(
      'non-HTTPS'
    )
    expect(request).not.toHaveBeenCalled()
  })

  it('never throws on a transport error and falls back to the URL version', async () => {
    const { client } = stubHttp(async () => {
      throw new Error('ECONNREFUSED')
    })
    const service = new DatabaseService({ httpClient: client })

    const info = await service.fetchDebInfo('https://example.com/app_2.0.0_amd64.deb')

    expect(info.version).toBe('2.0.0')
    expect(info.fileSize).toBeNull()
  })
})

describe('fileSizeFromResponse', () => {
  it('prefers the total in Content-Range', () => {
    expect(
      fileSizeFromResponse({ 'content-range': 'bytes 0-0/987654', 'content-length': '1' })
    ).toBe('987654')
  })

  it('ignores an unknown Content-Range total', () => {
    expect(fileSizeFromResponse({ 'content-range': 'bytes 0-0/*', 'content-length': '42' })).toBe(
      '42'
    )
  })

  it('falls back to Content-Length', () => {
    expect(fileSizeFromResponse({ 'content-length': '42' })).toBe('42')
  })

  it('returns null when neither header is usable', () => {
    expect(fileSizeFromResponse({})).toBeNull()
  })
})

describe('fileDateFromHeaders', () => {
  it('parses an RFC 1123 Last-Modified value', () => {
    expect(
      fileDateFromHeaders({ 'last-modified': 'Wed, 21 Oct 2015 07:28:00 GMT' })?.toISOString()
    ).toBe('2015-10-21T07:28:00.000Z')
  })

  it('returns null for a missing or invalid value', () => {
    expect(fileDateFromHeaders({})).toBeNull()
    expect(fileDateFromHeaders({ 'last-modified': 'not a date' })).toBeNull()
  })
})

describe('filenameFromContentDisposition', () => {
  it('parses a quoted filename', () => {
    expect(filenameFromContentDisposition('attachment; filename="app_1.2.3_amd64.deb"')).toBe(
      'app_1.2.3_amd64.deb'
    )
  })

  it('parses an unquoted filename', () => {
    expect(filenameFromContentDisposition('attachment; filename=app_1.2.3_amd64.deb')).toBe(
      'app_1.2.3_amd64.deb'
    )
  })

  it('strips any directory component', () => {
    expect(filenameFromContentDisposition('attachment; filename="/srv/files/app_1.2.3.deb"')).toBe(
      'app_1.2.3.deb'
    )
  })

  it('leaves the RFC 5987 prefix in place, matching the Dart operation order', () => {
    // The Dart original strips quotes before searching for `utf-8''`, so the
    // prefix survives. Reproduced verbatim rather than "fixed" here.
    expect(filenameFromContentDisposition("attachment; filename*=UTF-8''app_1.2.3.deb")).toBe(
      'UTF-8app_1.2.3.deb'
    )
  })

  it('returns an empty string for a missing header', () => {
    expect(filenameFromContentDisposition(null)).toBe('')
    expect(filenameFromContentDisposition('')).toBe('')
  })
})

describe('filenameFromUrl', () => {
  it('returns the last path segment', () => {
    expect(filenameFromUrl('https://example.com/a/b.deb')).toBe('b.deb')
  })

  it('returns empty for a root path, a trailing slash or a bad URL', () => {
    expect(filenameFromUrl('https://example.com/')).toBe('')
    expect(filenameFromUrl('https://example.com/a/')).toBe('')
    expect(filenameFromUrl('not a url')).toBe('')
    expect(filenameFromUrl(null)).toBe('')
  })
})

describe('versionFromUrl', () => {
  it('extracts the version from the URL filename', () => {
    expect(versionFromUrl(new URL('https://example.com/app_5.6.7_amd64.deb'))).toBe('5.6.7')
  })

  it('returns null when the URL carries no version', () => {
    expect(versionFromUrl(new URL('https://example.com/download'))).toBeNull()
    expect(versionFromUrl(null)).toBeNull()
  })
})
