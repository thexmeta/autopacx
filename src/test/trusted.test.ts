// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { describe, expect, it } from 'vitest'
import { isTrustedFrame, originOf, type TrustedFrameContext } from '../main/trusted'

const base: TrustedFrameContext = {
  senderWebContentsId: 7,
  expectedWebContentsId: 7,
  isMainFrame: true,
  senderFrameUrl: 'http://localhost:5173/',
  allowedOrigins: ['http://localhost:5173', 'file://']
}

describe('originOf', () => {
  it('extracts an http origin', () => {
    expect(originOf('http://localhost:5173/index.html')).toBe('http://localhost:5173')
  })

  it('collapses file URLs to a single origin', () => {
    expect(originOf('file:///opt/app/renderer/index.html')).toBe('file://')
  })

  it('returns null for unparseable input', () => {
    expect(originOf('not a url')).toBeNull()
  })
})

describe('isTrustedFrame', () => {
  it('accepts the main window main frame from an allowed origin', () => {
    expect(isTrustedFrame(base)).toBe(true)
  })

  it('rejects a different webContents (e.g. a devtools or foreign window)', () => {
    expect(isTrustedFrame({ ...base, senderWebContentsId: 8 })).toBe(false)
  })

  it('rejects a subframe of the main window', () => {
    expect(isTrustedFrame({ ...base, isMainFrame: false })).toBe(false)
  })

  it('rejects a frame whose origin is not allowlisted', () => {
    expect(isTrustedFrame({ ...base, senderFrameUrl: 'https://evil.example/' })).toBe(false)
  })

  it('rejects a frame with no URL', () => {
    expect(isTrustedFrame({ ...base, senderFrameUrl: '' })).toBe(false)
  })
})
