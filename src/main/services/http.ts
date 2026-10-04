// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

/**
 * A minimal, injectable HTTP client shared by the main-process services.
 *
 * The Dart originals call `package:http` directly, which makes them untestable
 * without a live network. Here the transport is an interface so every test can
 * stub it, and the default implementation is a thin wrapper over Node's global
 * `fetch` (available since Node 18) that normalises the response into a plain
 * shape: lowercased header names, the body as text, and the final URL after
 * redirects (which the deb probe needs).
 *
 * Timeouts are owned by the callers, which pass an `AbortSignal` created from
 * an `AbortController` — never by this module.
 */

export interface HttpRequestInit {
  readonly method?: 'GET' | 'HEAD'
  readonly headers?: Readonly<Record<string, string>>
  readonly signal?: AbortSignal
}

export interface HttpResponse {
  readonly status: number
  /** Header names are lowercased so lookups are case-insensitive. */
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
  /** Final URL after redirects; equals the request URL when none occurred. */
  readonly url: string
}

export interface HttpClient {
  request(url: string, init?: HttpRequestInit): Promise<HttpResponse>
}

/**
 * Wraps the global `fetch` into the {@link HttpClient} contract.
 *
 * A `HEAD` response has no body, so it is not read (and never awaited); this
 * also avoids Node throwing on an empty body stream.
 */
export function createNodeHttpClient(): HttpClient {
  return {
    async request(url, init = {}) {
      const method = init.method ?? 'GET'
      const response = await fetch(url, {
        method,
        headers: init.headers,
        redirect: 'follow',
        signal: init.signal
      })

      const headers: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value
      })

      return {
        status: response.status,
        headers,
        body: method === 'HEAD' ? '' : await response.text(),
        url: response.url.length > 0 ? response.url : url
      }
    }
  }
}
