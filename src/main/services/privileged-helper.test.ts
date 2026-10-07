// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { describe, expect, it } from 'vitest'
import {
  AUTONEX_HELPER_PATH,
  defaultDownloadRoots,
  defaultInstallRoots,
  isUnderRoot,
  validateHelperInvocation
} from './privileged-helper'
import type { HelperPathPolicy } from './privileged-helper'

/**
 * The pure specification of the root-owned helper's validation, mirrored
 * one-for-one by `resources/autonex-helper`. These tests pin the rules that
 * keep `pkexec <helper> ...` from being usable as a generic root command.
 */

const APP_SUPPORT = '/home/u/.local/share/autonex'
const DOWNLOADS = `${APP_SUPPORT}/downloads`
const STAGING = `${APP_SUPPORT}/staging`

const policy: HelperPathPolicy = {
  downloadRoots: defaultDownloadRoots(APP_SUPPORT),
  installRoots: defaultInstallRoots('/home/u')
}

describe('privileged helper constants', () => {
  it('binds the installed helper path', () => {
    expect(AUTONEX_HELPER_PATH).toBe('/usr/lib/autonex/autonex-helper')
  })

  it('derives the download and install roots', () => {
    expect(policy.downloadRoots).toEqual([DOWNLOADS, STAGING])
    expect(policy.installRoots).toContain('/usr/local/bin')
    expect(policy.installRoots).toContain('/usr/bin')
    expect(policy.installRoots).toContain('/home/u/.local/bin')
  })
})

describe('isUnderRoot', () => {
  it('accepts the root itself and its children', () => {
    expect(isUnderRoot('/usr/bin', '/usr/bin')).toBe(true)
    expect(isUnderRoot('/usr/bin', '/usr/bin/tool')).toBe(true)
  })

  it('rejects a sibling that shares a prefix', () => {
    expect(isUnderRoot('/usr/bin', '/usr/binfoo')).toBe(false)
    expect(isUnderRoot('/usr/bin', '/usr/bin-evil/tool')).toBe(false)
  })

  it('normalises away traversal so it cannot escape the root', () => {
    expect(isUnderRoot(DOWNLOADS, `${DOWNLOADS}/sub/../app.deb`)).toBe(true)
    expect(isUnderRoot(DOWNLOADS, `${DOWNLOADS}/../../../../etc/passwd`)).toBe(false)
    // `../staging/x` normalises to a sibling of the downloads root, not a child.
    expect(isUnderRoot(DOWNLOADS, `${DOWNLOADS}/../staging/x`)).toBe(false)
  })

  it('rejects relative paths', () => {
    expect(isUnderRoot(DOWNLOADS, 'downloads/x')).toBe(false)
  })
})

describe('validateHelperInvocation — apt-install / rpm-install', () => {
  it('accepts a file under the downloads directory', () => {
    expect(validateHelperInvocation('apt-install', [`${DOWNLOADS}/app.deb`], policy)).toBeNull()
    expect(validateHelperInvocation('rpm-install', [`${DOWNLOADS}/app.rpm`], policy)).toBeNull()
  })

  it('accepts a staged file under the staging directory', () => {
    expect(validateHelperInvocation('apt-install', [`${STAGING}/app.deb`], policy)).toBeNull()
  })

  it('rejects a path outside the downloads directory', () => {
    expect(validateHelperInvocation('apt-install', ['/tmp/app.deb'], policy)).toContain(
      'outside the downloads'
    )
    expect(validateHelperInvocation('rpm-install', ['/etc/passwd'], policy)).toContain(
      'outside the downloads'
    )
  })

  it('rejects traversal that escapes the downloads directory', () => {
    expect(
      validateHelperInvocation('apt-install', [`${DOWNLOADS}/../../../etc/passwd`], policy)
    ).toContain('outside the downloads')
  })

  it('rejects a sibling with a shared prefix', () => {
    expect(validateHelperInvocation('apt-install', [`${DOWNLOADS}-evil/x.deb`], policy)).toContain(
      'outside the downloads'
    )
  })

  it('rejects a relative path and a wrong argument count', () => {
    expect(validateHelperInvocation('apt-install', ['app.deb'], policy)).toContain('absolute')
    expect(validateHelperInvocation('apt-install', [], policy)).toContain('exactly one')
    expect(validateHelperInvocation('apt-install', ['/a', '/b'], policy)).toContain('exactly one')
  })
})

describe('validateHelperInvocation — dpkg-remove / rpm-remove', () => {
  it('accepts a plain package name', () => {
    for (const name of ['cliptoo', 'libqt6gui6t64', 'foo+bar', 'a.b_c-d', 'g++-12']) {
      expect(validateHelperInvocation('dpkg-remove', [name], policy), name).toBeNull()
      expect(validateHelperInvocation('rpm-remove', [name], policy), name).toBeNull()
    }
  })

  it('rejects a name that is not a valid package identifier', () => {
    for (const name of ['', '-r', '/etc/passwd', 'a b', 'a;rm -rf /', 'pkg:amd64', '../x']) {
      expect(validateHelperInvocation('dpkg-remove', [name], policy), name).toContain(
        'invalid package name'
      )
    }
  })

  it('rejects a wrong argument count', () => {
    expect(validateHelperInvocation('rpm-remove', [], policy)).toContain('exactly one')
  })
})

describe('validateHelperInvocation — atomic-install', () => {
  it('accepts a staged source and an allowlisted destination', () => {
    expect(
      validateHelperInvocation(
        'atomic-install',
        [`${STAGING}/tool.new`, '/usr/local/bin/tool'],
        policy
      )
    ).toBeNull()
    expect(
      validateHelperInvocation(
        'atomic-install',
        [`${STAGING}/tool.new`, '/home/u/.local/bin/tool'],
        policy
      )
    ).toBeNull()
  })

  it('rejects a source outside the staging/download directories', () => {
    expect(
      validateHelperInvocation('atomic-install', ['/tmp/tool', '/usr/local/bin/tool'], policy)
    ).toContain('source is outside')
  })

  it('rejects a destination outside the install allowlist', () => {
    expect(
      validateHelperInvocation('atomic-install', [`${STAGING}/tool`, '/etc/tool'], policy)
    ).toContain('destination is outside')
    expect(
      validateHelperInvocation('atomic-install', [`${STAGING}/tool`, '/usr/binfoo/tool'], policy)
    ).toContain('destination is outside')
  })

  it('rejects a wrong argument count', () => {
    expect(validateHelperInvocation('atomic-install', [`${STAGING}/tool`], policy)).toContain(
      '<src> <dest>'
    )
  })
})

describe('validateHelperInvocation — backup / cleanup', () => {
  it('accepts a backup inside an install directory', () => {
    expect(validateHelperInvocation('backup', ['/usr/local/bin/tool'], policy)).toBeNull()
    expect(validateHelperInvocation('backup', ['/home/u/.local/bin/tool'], policy)).toBeNull()
  })

  it('rejects a backup outside the install directories', () => {
    expect(validateHelperInvocation('backup', ['/tmp/tool'], policy)).toContain(
      'outside the allowed install'
    )
  })

  it('accepts a cleanup inside the staging/download directories', () => {
    expect(validateHelperInvocation('cleanup', [`${STAGING}/tool`], policy)).toBeNull()
    expect(validateHelperInvocation('cleanup', [`${DOWNLOADS}/app.deb`], policy)).toBeNull()
  })

  it('rejects a cleanup outside them', () => {
    expect(validateHelperInvocation('cleanup', ['/usr/bin/tool'], policy)).toContain(
      'outside the staging'
    )
  })
})

describe('validateHelperInvocation — binary-remove', () => {
  it('accepts a path inside an install directory', () => {
    expect(validateHelperInvocation('binary-remove', ['/usr/local/bin/tool'], policy)).toBeNull()
    expect(validateHelperInvocation('binary-remove', ['/usr/bin/tool'], policy)).toBeNull()
    expect(
      validateHelperInvocation('binary-remove', ['/home/u/.local/bin/tool'], policy)
    ).toBeNull()
  })

  it('rejects a path outside the install directories', () => {
    expect(validateHelperInvocation('binary-remove', ['/tmp/tool'], policy)).toContain(
      'outside the allowed install'
    )
    expect(validateHelperInvocation('binary-remove', [`${STAGING}/tool`], policy)).toContain(
      'outside the allowed install'
    )
  })

  it('rejects a relative path and a wrong argument count', () => {
    expect(validateHelperInvocation('binary-remove', ['tool'], policy)).toContain('absolute')
    expect(validateHelperInvocation('binary-remove', [], policy)).toContain('exactly one')
    expect(validateHelperInvocation('binary-remove', ['/a', '/b'], policy)).toContain('exactly one')
  })
})

describe('validateHelperInvocation — pacstall verbs', () => {
  it('accepts a plain pacscript name for install/remove/upgrade', () => {
    for (const verb of ['pacstall-install', 'pacstall-remove', 'pacstall-upgrade'] as const) {
      for (const name of ['neovim', 'nodejs', 'foo-bar', 'a.b_c']) {
        expect(validateHelperInvocation(verb, [name], policy), `${verb} ${name}`).toBeNull()
      }
    }
  })

  it('rejects an invalid pacscript name', () => {
    for (const verb of ['pacstall-install', 'pacstall-remove', 'pacstall-upgrade'] as const) {
      for (const name of ['', '-r', '/etc/passwd', 'a b', 'a;rm -rf /', '../x']) {
        expect(validateHelperInvocation(verb, [name], policy), `${verb} ${name}`).toContain(
          'invalid package name'
        )
      }
    }
  })

  it('requires exactly one name for install/remove/upgrade', () => {
    for (const verb of ['pacstall-install', 'pacstall-remove', 'pacstall-upgrade'] as const) {
      expect(validateHelperInvocation(verb, [], policy), verb).toContain('exactly one')
      expect(validateHelperInvocation(verb, ['a', 'b'], policy), verb).toContain('exactly one')
    }
  })

  it('accepts no arguments for pacstall-upgrade-all', () => {
    expect(validateHelperInvocation('pacstall-upgrade-all', [], policy)).toBeNull()
  })

  it('rejects any argument for pacstall-upgrade-all', () => {
    expect(validateHelperInvocation('pacstall-upgrade-all', ['neovim'], policy)).toContain(
      'takes no arguments'
    )
  })
})

describe('validateHelperInvocation — unknown verb', () => {
  it('rejects anything that is not a known verb', () => {
    for (const verb of ['sh', 'cp', 'rm', 'apt-get', '', 'APT-INSTALL', 'pacstall-unknown']) {
      expect(validateHelperInvocation(verb, [], policy), verb).toContain('Unknown privileged')
    }
  })
})
