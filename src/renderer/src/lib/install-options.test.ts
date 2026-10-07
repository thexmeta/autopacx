// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { describe, expect, it } from 'vitest'
import { TrackedApp, type TrackedAppInit } from '@core/models/tracked-app'
import {
  candidateMatchesDir,
  executableName,
  installTargetBasename,
  joinInstallTarget,
  needsInstallTarget
} from './install-options'

function app(overrides: Partial<TrackedAppInit> = {}): TrackedApp {
  return new TrackedApp({
    repoOwner: 'owner',
    repoName: 'MyRepo',
    displayName: 'My App',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides
  })
}

describe('executableName', () => {
  it('uses the basename of the first token of the launch command', () => {
    expect(executableName(app({ launchCommand: '/usr/bin/tool --flag' }))).toBe('tool')
  })

  it('falls back to the package name', () => {
    expect(executableName(app({ packageName: 'my-pkg' }))).toBe('my-pkg')
  })

  it('falls back to the lower-cased repo name', () => {
    expect(executableName(app())).toBe('myrepo')
  })
})

describe('needsInstallTarget', () => {
  it('is true only for a raw binary install', () => {
    expect(needsInstallTarget('binary')).toBe(true)
    expect(needsInstallTarget('deb')).toBe(false)
    expect(needsInstallTarget('appImage')).toBe(false)
    expect(needsInstallTarget(null)).toBe(false)
  })
})

describe('joinInstallTarget', () => {
  it('joins a directory and a binary name into a full path', () => {
    expect(joinInstallTarget('/usr/bin', 'codegraph')).toBe('/usr/bin/codegraph')
  })

  it('tolerates a trailing slash on the directory', () => {
    expect(joinInstallTarget('/usr/bin/', 'codegraph')).toBe('/usr/bin/codegraph')
  })

  it('returns an empty string when the name is blank', () => {
    expect(joinInstallTarget('/usr/bin', '  ')).toBe('')
  })
})

describe('installTargetBasename', () => {
  it('returns the final path component', () => {
    expect(installTargetBasename('/usr/bin/codegraph')).toBe('codegraph')
  })

  it('returns an empty string for a bare directory path', () => {
    expect(installTargetBasename('/usr/bin/')).toBe('')
    expect(installTargetBasename('')).toBe('')
  })
})

describe('candidateMatchesDir', () => {
  it('matches an exact absolute path', () => {
    expect(candidateMatchesDir('/opt/apps/bin', '/opt/apps/bin')).toBe(true)
  })

  it('matches a ~-prefixed configured path against an absolute candidate', () => {
    expect(candidateMatchesDir('/home/u/.local/bin', '~/.local/bin')).toBe(true)
  })

  it('does not match an unrelated or empty configured directory', () => {
    expect(candidateMatchesDir('/usr/bin', '~/.local/bin')).toBe(false)
    expect(candidateMatchesDir('/usr/bin', '')).toBe(false)
  })
})
