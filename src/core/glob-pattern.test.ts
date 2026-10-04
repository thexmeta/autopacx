// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

// Ported 1:1 from `test/utils/glob_pattern_test.dart`.

import { describe, expect, it } from 'vitest'
import {
  findMatchingArchitectures,
  isForeignOsAsset,
  matchesArchitecture,
  matchesGlobPattern
} from './glob-pattern'

describe('matchesGlobPattern', () => {
  it('exact match', () => {
    expect(matchesGlobPattern('app.deb', 'app.deb')).toBe(true)
    expect(matchesGlobPattern('MyApp.tar.gz', 'MyApp.tar.gz')).toBe(true)
  })

  it('wildcard at end', () => {
    expect(matchesGlobPattern('app.deb', 'app*')).toBe(true)
    expect(matchesGlobPattern('application.deb', 'app*')).toBe(true)
    expect(matchesGlobPattern('app', 'app*')).toBe(true)
  })

  it('wildcard at start', () => {
    expect(matchesGlobPattern('app.deb', '*.deb')).toBe(true)
    expect(matchesGlobPattern('MyApp.deb', '*.deb')).toBe(true)
    expect(matchesGlobPattern('app.tar.gz', '*.tar.gz')).toBe(true)
  })

  it('wildcard in middle', () => {
    expect(matchesGlobPattern('app.deb', 'app*.deb')).toBe(true)
    expect(matchesGlobPattern('application.deb', 'app*.deb')).toBe(true)
    expect(matchesGlobPattern('app.deb', 'app.*')).toBe(true)
  })

  it('multiple wildcards', () => {
    expect(matchesGlobPattern('app.deb', '*.*')).toBe(true)
    expect(matchesGlobPattern('MyApp.tar.gz', '*.*.*')).toBe(true)
    expect(matchesGlobPattern('anything', '*')).toBe(true)
  })

  it('question mark single char', () => {
    expect(matchesGlobPattern('app1.deb', 'app?.deb')).toBe(true)
    expect(matchesGlobPattern('appA.deb', 'app?.deb')).toBe(true)
    expect(matchesGlobPattern('app.deb', 'app?.deb')).toBe(false)
  })

  it('question mark multiple', () => {
    expect(matchesGlobPattern('app12.deb', 'app??.deb')).toBe(true)
    expect(matchesGlobPattern('app1.deb', 'app??.deb')).toBe(false)
  })

  it('case insensitive', () => {
    expect(matchesGlobPattern('APP.DEB', 'app.deb')).toBe(true)
    expect(matchesGlobPattern('app.deb', 'APP.DEB')).toBe(true)
    expect(matchesGlobPattern('App.Deb', 'app.deb')).toBe(true)
  })

  it('empty pattern matches everything', () => {
    expect(matchesGlobPattern('anything', '')).toBe(true)
    expect(matchesGlobPattern('app.deb', '')).toBe(true)
  })

  it('empty input handling', () => {
    expect(matchesGlobPattern('', '')).toBe(true)
    expect(matchesGlobPattern('', '*')).toBe(true)
    expect(matchesGlobPattern('', 'app')).toBe(false)
  })

  it('special characters in filename', () => {
    expect(matchesGlobPattern('my-app_v1.0.deb', 'my-app_v*.deb')).toBe(true)
    expect(matchesGlobPattern('app-name.deb', 'app-*.deb')).toBe(true)
  })

  it('no match cases', () => {
    expect(matchesGlobPattern('app.deb', 'other.deb')).toBe(false)
    expect(matchesGlobPattern('app.deb', '*.rpm')).toBe(false)
    expect(matchesGlobPattern('app.deb', 'app*.rpm')).toBe(false)
  })

  it('regex metacharacters are matched literally', () => {
    expect(matchesGlobPattern('app+1.deb', 'app+1.deb')).toBe(true)
    expect(matchesGlobPattern('app(1).deb', 'app(1).deb')).toBe(true)
    expect(matchesGlobPattern('app[1].deb', 'app[1].deb')).toBe(true)
    expect(matchesGlobPattern('app{1}.deb', 'app{1}.deb')).toBe(true)
    expect(matchesGlobPattern('app|1.deb', 'app|1.deb')).toBe(true)
    expect(matchesGlobPattern('^app.deb', '^app.deb')).toBe(true)
    expect(matchesGlobPattern('app$.deb', 'app$.deb')).toBe(true)
    expect(matchesGlobPattern(String.raw`app\1.deb`, String.raw`app\1.deb`)).toBe(true)
  })

  it('regex metacharacters combined with wildcards', () => {
    expect(matchesGlobPattern('app+1.deb', 'app+*')).toBe(true)
    expect(matchesGlobPattern('app(1).deb', 'app(*.deb')).toBe(true)
    expect(matchesGlobPattern('app[1].deb', 'app[?]*')).toBe(true)
    expect(matchesGlobPattern('app{1}.deb', 'app{*}*')).toBe(true)
    expect(matchesGlobPattern('app|1.deb', 'app|?.deb')).toBe(true)
    expect(matchesGlobPattern('^app.deb', '^*')).toBe(true)
    expect(matchesGlobPattern('app$.deb', '*$*')).toBe(true)
  })

  it('metacharacters do not match other strings', () => {
    expect(matchesGlobPattern('app.deb', 'app+.deb')).toBe(false)
    expect(matchesGlobPattern('app.deb', 'app(1)*')).toBe(false)
    expect(matchesGlobPattern('app.deb', '*|*')).toBe(false)
  })

  it('metacharacters in comma separated patterns', () => {
    expect(matchesGlobPattern('app.deb', '*.rpm, app(1)*')).toBe(false)
    expect(matchesGlobPattern('app(1).deb', '*.rpm, app(*')).toBe(true)
  })

  it('malformed patterns never throw', () => {
    expect(() => matchesGlobPattern('app.deb', 'app+([')).not.toThrow()
    expect(() => matchesGlobPattern('app.deb', '[a-')).not.toThrow()
    expect(() => matchesGlobPattern('app.deb', '***(unclosed')).not.toThrow()
    expect(matchesGlobPattern('app.deb', 'app+([')).toBe(false)
    expect(matchesGlobPattern('app.deb', '[a-')).toBe(false)
  })
})

describe('matchesArchitecture', () => {
  it('amd64 detection', () => {
    expect(matchesArchitecture('app-amd64.deb', 'amd64')).toBe(true)
    expect(matchesArchitecture('app-x86_64.deb', 'x86_64')).toBe(true)
    expect(matchesArchitecture('app-x64.deb', 'x64')).toBe(true)
    expect(matchesArchitecture('app-64-bit.deb', '64-bit')).toBe(true)
  })

  it('amd64 cross detection', () => {
    expect(matchesArchitecture('app-x86_64.deb', 'amd64')).toBe(true)
    expect(matchesArchitecture('app-amd64.deb', 'x86_64')).toBe(true)
    expect(matchesArchitecture('app-x64.deb', 'amd64')).toBe(true)
    expect(matchesArchitecture('app-64-bit.deb', 'amd64')).toBe(true)
  })

  it('arm64 detection', () => {
    expect(matchesArchitecture('app-arm64.deb', 'arm64')).toBe(true)
    expect(matchesArchitecture('app-aarch64.deb', 'aarch64')).toBe(true)
    expect(matchesArchitecture('app-armv8.deb', 'armv8')).toBe(true)
  })

  it('arm64 cross detection', () => {
    expect(matchesArchitecture('app-arm64.deb', 'aarch64')).toBe(true)
    expect(matchesArchitecture('app-aarch64.deb', 'arm64')).toBe(true)
  })

  it('arm detection', () => {
    expect(matchesArchitecture('app-armhf.deb', 'armhf')).toBe(true)
    expect(matchesArchitecture('app-armv7.deb', 'armv7')).toBe(true)
    expect(matchesArchitecture('app-arm-.deb', 'arm')).toBe(true)
  })

  it('i386 detection', () => {
    expect(matchesArchitecture('app-i386.deb', 'i386')).toBe(true)
    expect(matchesArchitecture('app-x86.deb', 'x86')).toBe(true)
    expect(matchesArchitecture('app-32-bit.deb', '32-bit')).toBe(true)
  })

  it('i386 cross detection', () => {
    expect(matchesArchitecture('app-i386.deb', 'x86')).toBe(true)
    expect(matchesArchitecture('app-x86.deb', 'i386')).toBe(true)
  })

  it('case insensitive', () => {
    expect(matchesArchitecture('app-AMD64.deb', 'amd64')).toBe(true)
    expect(matchesArchitecture('app-ARM64.deb', 'arm64')).toBe(true)
    expect(matchesArchitecture('app-Amd64.deb', 'amd64')).toBe(true)
  })

  it('custom architecture string', () => {
    expect(matchesArchitecture('app-linux-musl-x64.deb', 'musl')).toBe(true)
    // FreeBSD is not Linux, so a `freebsd`-tagged asset is rejected as a
    // foreign-OS build even when `freebsd` is the requested architecture.
    expect(matchesArchitecture('app-freebsd.deb', 'freebsd')).toBe(false)
  })

  it('no match', () => {
    expect(matchesArchitecture('app-amd64.deb', 'arm64')).toBe(false)
    expect(matchesArchitecture('app-arm64.deb', 'amd64')).toBe(false)
    expect(matchesArchitecture('app.deb', 'amd64')).toBe(false)
  })

  it('rejects a macOS asset even when its architecture token matches', () => {
    expect(matchesArchitecture('br-0.7.3-darwin_amd64.tar.gz', 'amd64')).toBe(false)
  })

  it('accepts a Linux asset when its architecture token matches', () => {
    expect(matchesArchitecture('ty-x86_64-unknown-linux-musl.tar.gz', 'amd64')).toBe(true)
  })

  it('keeps matching an OS-neutral Linux package name', () => {
    expect(matchesArchitecture('app-amd64.deb', 'amd64')).toBe(true)
  })
})

describe('isForeignOsAsset', () => {
  it('flags a macOS asset so a Linux host never selects it', () => {
    expect(isForeignOsAsset('br-0.7.3-darwin_amd64.tar.gz')).toBe(true)
  })

  it('leaves Linux assets selectable because no token marks a foreign OS', () => {
    expect(isForeignOsAsset('ty-x86_64-unknown-linux-musl.tar.gz')).toBe(false)
    expect(isForeignOsAsset('computer-use-linux-x86_64-unknown-linux-gnu')).toBe(false)
    expect(isForeignOsAsset('waza-linux-amd64')).toBe(false)
    expect(isForeignOsAsset('biome-linux-x64-musl')).toBe(false)
    expect(isForeignOsAsset('PromptOptimizer-2.11.10-linux-x64.zip')).toBe(false)
    expect(isForeignOsAsset('ruff-x86_64-unknown-linux-musl.tar.gz')).toBe(false)
    expect(isForeignOsAsset('nub-linux-x64-musl.tar.gz')).toBe(false)
    expect(isForeignOsAsset('app-amd64.deb')).toBe(false)
  })

  it('keeps a Linux asset whose PRODUCT NAME contains android or ios, so a hyphenated name does not downgrade the app', () => {
    // Regression: `android` used to be a foreign-OS token, so this real asset
    // was rejected and the selector fell back to a 2022 release.
    expect(isForeignOsAsset('Android-Messages-v6.1.1-linux-amd64.deb')).toBe(false)
    expect(matchesArchitecture('Android-Messages-v6.1.1-linux-amd64.deb', 'amd64')).toBe(true)
    expect(isForeignOsAsset('apple-music-linux-x64.tar.gz')).toBe(false)
    expect(isForeignOsAsset('ios-remote-linux-amd64')).toBe(false)
  })

  it('rejects mobile artifacts by extension so android/ios builds still never install', () => {
    expect(isForeignOsAsset('app-android-arm64.apk')).toBe(true)
    expect(isForeignOsAsset('app-release.aab')).toBe(true)
    expect(isForeignOsAsset('app-ios-arm64.ipa')).toBe(true)
  })
})

describe('findMatchingArchitectures', () => {
  it('finds matching architectures', () => {
    const result = findMatchingArchitectures('app-amd64-arm64.deb', ['amd64', 'arm64', 'armhf'])
    expect(result).toContain('amd64')
    expect(result).toContain('arm64')
    expect(result.length).toBe(2)
  })

  it('returns empty for no matches', () => {
    const result = findMatchingArchitectures('app.deb', ['amd64', 'arm64'])
    expect(result).toEqual([])
  })

  it('returns all matching', () => {
    const result = findMatchingArchitectures('app-amd64-x86_64.deb', ['amd64', 'x86_64', 'arm64'])
    expect(result).toContain('amd64')
    expect(result).toContain('x86_64')
    expect(result.length).toBe(2)
  })
})

describe('Release Filtering logic', () => {
  it('tag prefix filtering', () => {
    // Logic from GitHubService: lowerTag.contains(searchPrefix)
    const matchesTag = (tagName: string, prefix: string): boolean => {
      if (prefix.trim().length === 0) return true
      return tagName.toLowerCase().includes(prefix.trim().toLowerCase())
    }

    expect(matchesTag('v1.0.0', 'v')).toBe(true)
    expect(matchesTag('v1.0.0', '1.0')).toBe(true)
    expect(matchesTag('v1.0.0', 'V')).toBe(true)
    expect(matchesTag('v1.0.0', '2.0')).toBe(false)
    expect(matchesTag('app-v1.0.0', 'v1')).toBe(true)
  })

  it('prerelease filtering', () => {
    const shouldInclude = (isPrerelease: boolean, includePrerelease: boolean): boolean => {
      if (!includePrerelease && isPrerelease) return false
      return true
    }

    expect(shouldInclude(true, false)).toBe(false)
    expect(shouldInclude(true, true)).toBe(true)
    expect(shouldInclude(false, false)).toBe(true)
    expect(shouldInclude(false, true)).toBe(true)
  })
})
