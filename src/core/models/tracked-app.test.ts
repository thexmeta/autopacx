// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

// Ported 1:1 from `test/models/tracked_app_test.dart`.

import { describe, expect, it } from 'vitest'
import { TrackedApp } from './tracked-app'
import { isNewerVersion, looksLikeVersion, normalizeVersion } from '../version'

describe('TrackedApp', () => {
  const app = (opts: { installed?: string | null; latest?: string | null } = {}): TrackedApp =>
    new TrackedApp({
      repoOwner: 'owner',
      repoName: 'repo',
      displayName: 'App',
      installedVersion: opts.installed,
      latestVersion: opts.latest,
      createdAt: new Date('2026-01-01T00:00:00Z')
    })

  it('hasUpdate returns true when latest version is newer', () => {
    expect(app({ installed: '1.0.0', latest: '1.0.1' }).hasUpdate).toBe(true)
  })

  it('hasUpdate returns false when versions are equal', () => {
    expect(app({ installed: '1.0.0', latest: '1.0.0' }).hasUpdate).toBe(false)
  })

  it('hasUpdate returns false when installed version is newer', () => {
    expect(app({ installed: '1.0.1', latest: '1.0.0' }).hasUpdate).toBe(false)
  })

  it('hasUpdate handles v-prefix correctly', () => {
    expect(app({ installed: 'v1.0.0', latest: '1.0.1' }).hasUpdate).toBe(true)
    expect(app({ installed: 'v1.0.0', latest: 'v1.0.1' }).hasUpdate).toBe(true)
    expect(app({ installed: '1.0.0', latest: 'v1.0.1' }).hasUpdate).toBe(true)
  })

  it('hasUpdate handles uppercase V-prefix', () => {
    expect(app({ installed: 'V1.0.0', latest: 'V1.0.1' }).hasUpdate).toBe(true)
  })

  it('hasUpdate compares major/minor/patch numerically', () => {
    expect(app({ installed: '1.0.0', latest: '2.0.0' }).hasUpdate).toBe(true)
    expect(app({ installed: '1.0.0', latest: '1.1.0' }).hasUpdate).toBe(true)
    expect(app({ installed: '1.0.2', latest: '1.0.10' }).hasUpdate).toBe(true)
  })

  it('hasUpdate returns false if installedVersion is null', () => {
    expect(app({ installed: null, latest: '1.0.0' }).hasUpdate).toBe(false)
  })

  it('hasUpdate returns false if latestVersion is null', () => {
    expect(app({ installed: '1.0.0', latest: null }).hasUpdate).toBe(false)
  })

  it('hasUpdate treats a release as newer than a prerelease', () => {
    expect(app({ installed: '1.0.0-alpha', latest: '1.0.0' }).hasUpdate).toBe(true)
  })

  it('isInstalled reflects whether installedVersion is set', () => {
    expect(app({ installed: '1.0.0', latest: '1.0.0' }).isInstalled).toBe(true)
    expect(app({ installed: null, latest: '1.0.0' }).isInstalled).toBe(false)
  })

  it('repoUrl is correct', () => {
    const tracked = new TrackedApp({
      repoOwner: 'owner',
      repoName: 'repo',
      displayName: 'App',
      createdAt: new Date()
    })

    expect(tracked.repoUrl).toBe('https://github.com/owner/repo')
  })

  it('hasUpdate is false when a Debian revision is compared against the same upstream version', () => {
    expect(app({ installed: '2.11.10-1', latest: 'v2.11.10' }).hasUpdate).toBe(false)
  })

  it('REVERSED: hasUpdate is true for an npm release tag because it embeds a real version', () => {
    // This previously asserted `false`, which hid a genuine update: the tag
    // `@biomejs/biome@2.5.15` carries the version 2.5.15, so it compares
    // cleanly against the installed 2.5.10 once the npm prefix is stripped.
    // The raw string is still not version-shaped, so the check must run on
    // the normalised value.
    expect(app({ installed: '2.5.10', latest: '@biomejs/biome@2.5.15' }).hasUpdate).toBe(true)
    // A latest value with no version in it at all is still rejected.
    expect(app({ installed: '2.5.10', latest: 'multiplatform#1' }).hasUpdate).toBe(false)
  })

  it('REGRESSION: hasUpdate stays true for a genuine minor bump', () => {
    expect(app({ installed: '0.6.0', latest: 'v0.7.3' }).hasUpdate).toBe(true)
  })

  it('REGRESSION: hasUpdate stays true for a genuine patch bump', () => {
    expect(app({ installed: '0.0.80', latest: '0.0.84' }).hasUpdate).toBe(true)
  })

  it('REGRESSION: hasUpdate is true for a prefixed release tag, so a real update is not hidden', () => {
    // Real case: bitwarden/clients publishes per-client tags such as
    // `desktop-v2026.9.0`, so the stored latest carries a `desktop-` prefix.
    // That was rejected as "not a version" AND parsed as 0.0.0, so the row
    // never highlighted even though 2026.9.0 was available.
    expect(app({ installed: '2026.8.0', latest: 'desktop-v2026.9.0' }).hasUpdate).toBe(true)
    expect(isNewerVersion('desktop-v2026.9.0', '2026.8.0')).toBe(true)
    expect(isNewerVersion('2026.8.0', 'desktop-v2026.9.0')).toBe(false)
  })

  it('REGRESSION: hasUpdate is true for a prefixed tag that also carries a prerelease suffix', () => {
    // Real case: refactoringhq/tolaria tags releases as
    // `alpha-v2026.9.25-alpha.0006`.
    expect(app({ installed: '2026.5.2', latest: 'alpha-v2026.9.25-alpha.0006' }).hasUpdate).toBe(
      true
    )
  })
})

describe('wire round-trip', () => {
  it('fromMap(toMap(x)) preserves the getter-visible values', () => {
    const original = new TrackedApp({
      id: 7,
      repoOwner: 'owner',
      repoName: 'repo',
      displayName: 'App',
      installedVersion: '1.0.0',
      latestVersion: '1.0.1',
      installType: 'deb',
      launchCommand: 'app',
      packageName: 'app',
      lastChecked: new Date('2026-02-01T10:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      latestReleaseDate: new Date('2026-02-02T00:00:00.000Z'),
      architectures: ['amd64'],
      includePrerelease: true
    })

    const rehydrated = TrackedApp.fromMap(original.toMap())

    // Getters lost by Electron's structured clone must work again.
    expect(rehydrated.hasUpdate).toBe(true)
    expect(rehydrated.isInstalled).toBe(true)
    expect(rehydrated.repoUrl).toBe('https://github.com/owner/repo')
    // Data fields survive the snake_case wire form.
    expect(rehydrated.id).toBe(7)
    expect(rehydrated.displayName).toBe('App')
    expect(rehydrated.installedVersion).toBe('1.0.0')
    expect(rehydrated.latestVersion).toBe('1.0.1')
    expect(rehydrated.installType).toBe('deb')
    expect(rehydrated.architectures).toEqual(['amd64'])
    expect(rehydrated.includePrerelease).toBe(true)
    expect(rehydrated.lastChecked?.getTime()).toBe(original.lastChecked?.getTime())
    expect(rehydrated.createdAt.getTime()).toBe(original.createdAt.getTime())
    expect(rehydrated.latestReleaseDate?.getTime()).toBe(original.latestReleaseDate?.getTime())
  })

  it('keeps isInstalled false when there is no installed version', () => {
    const original = new TrackedApp({
      repoOwner: 'owner',
      repoName: 'repo',
      displayName: 'App',
      createdAt: new Date('2026-01-01T00:00:00.000Z')
    })

    expect(TrackedApp.fromMap(original.toMap()).isInstalled).toBe(false)
  })
})

describe('normalizeVersion', () => {
  it('drops an npm specifier prefix so a dist-tag compares as its bare version', () => {
    expect(normalizeVersion('@biomejs/biome@2.5.14')).toBe('2.5.14')
    expect(normalizeVersion('biome@2.5.14')).toBe('2.5.14')
  })
})

describe('looksLikeVersion', () => {
  it('accepts real version shapes so genuine upgrades still compare', () => {
    expect(looksLikeVersion('1')).toBe(true)
    expect(looksLikeVersion('2.5.14')).toBe(true)
    expect(looksLikeVersion('v2.11.10')).toBe(true)
    expect(looksLikeVersion('2.11.10-1')).toBe(true)
  })

  it('accepts a prefixed tag whose version part is dotted', () => {
    // `desktop-v2026.9.0` is a version tag with a product prefix, not a label.
    expect(looksLikeVersion('desktop-v2026.9.0')).toBe(true)
    expect(looksLikeVersion('cli-v2026.9.0')).toBe(true)
    expect(looksLikeVersion('desktop-2026.9.0')).toBe(true)
    // …including when it carries a prerelease suffix.
    expect(looksLikeVersion('alpha-v2026.9.25-alpha.0006')).toBe(true)
  })

  it('rejects non-version labels so they cannot masquerade as an upgrade', () => {
    expect(looksLikeVersion('@biomejs/biome@2.5.14')).toBe(false)
    expect(looksLikeVersion('multiplatform#1')).toBe(false)
    expect(looksLikeVersion('download_cli.sh')).toBe(false)
    expect(looksLikeVersion('latest.json')).toBe(false)
    // A prefix alone is not enough: the version part must be dotted, so a
    // bare-number tag with a junk separator still fails.
    expect(looksLikeVersion('release-build')).toBe(false)
  })
})

describe('isNewerVersion Debian revision semantics', () => {
  it('treats a lone Debian revision as the same upstream version, not a prerelease', () => {
    expect(isNewerVersion('2.11.10', '2.11.10-1')).toBe(false)
    expect(isNewerVersion('2.11.10-1', '2.11.10')).toBe(false)
  })
})
