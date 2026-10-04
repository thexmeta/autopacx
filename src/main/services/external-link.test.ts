// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { describe, expect, it, vi } from 'vitest'
import { ExternalLinkService, isAllowedExternalUrl } from './external-link'

describe('isAllowedExternalUrl', () => {
  it('accepts https URLs on the allowlisted hosts', () => {
    expect(isAllowedExternalUrl('https://github.com/owner/repo')).toBe(true)
    expect(isAllowedExternalUrl('https://raw.githubusercontent.com/o/r/main/f')).toBe(true)
    expect(isAllowedExternalUrl('https://objects.githubusercontent.com/asset')).toBe(true)
  })

  it('is case-insensitive about the scheme and host', () => {
    expect(isAllowedExternalUrl('HTTPS://GitHub.com/owner/repo')).toBe(true)
  })

  it('rejects plaintext http', () => {
    expect(isAllowedExternalUrl('http://github.com/owner/repo')).toBe(false)
  })

  it('rejects non-http schemes', () => {
    expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isAllowedExternalUrl('mailto:someone@example.com')).toBe(false)
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false)
  })

  it('rejects hosts that merely contain an allowlisted host', () => {
    expect(isAllowedExternalUrl('https://github.com.evil.example/x')).toBe(false)
    expect(isAllowedExternalUrl('https://evil.example/github.com')).toBe(false)
  })

  it('rejects a malformed URL', () => {
    expect(isAllowedExternalUrl('not a url')).toBe(false)
    expect(isAllowedExternalUrl('')).toBe(false)
  })
})

describe('ExternalLinkService', () => {
  it('opens an allowlisted URL through the injected opener', async () => {
    const opener = vi.fn(async () => undefined)
    const service = new ExternalLinkService(opener)

    await service.open('https://github.com/owner/repo')

    expect(opener).toHaveBeenCalledWith('https://github.com/owner/repo')
  })

  it('refuses a disallowed URL without calling the opener', async () => {
    const opener = vi.fn(async () => undefined)
    const service = new ExternalLinkService(opener)

    await expect(service.open('https://evil.example/x')).rejects.toThrow(/disallowed/)
    await expect(service.open('http://github.com/o/r')).rejects.toThrow(/disallowed/)
    expect(opener).not.toHaveBeenCalled()
  })
})
