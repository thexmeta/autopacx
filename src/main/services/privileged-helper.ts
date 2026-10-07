// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { posix } from 'node:path'

/**
 * The strict contract of the root-owned privileged helper.
 *
 * The helper (`resources/autopacx-helper`, installed to
 * {@link AUTOPACX_HELPER_PATH} by the package post-install script) is the
 * ONLY program bound to the polkit action, so `pkexec` can never be turned into
 * a generic root shell. It accepts a small verb protocol and validates every
 * argument before touching a privileged command.
 *
 * The pure functions below are the canonical specification of that validation;
 * the POSIX `sh` script mirrors them one-for-one. They perform lexical
 * validation only (no filesystem access), so they can be unit-tested and are
 * cheap for the app to call before spawning `pkexec` for a clearer error.
 */

/** Where the post-install script places the helper. */
export const AUTOPACX_HELPER_PATH = '/usr/lib/autopacx/autopacx-helper'

/** The verbs the helper understands. Anything else is exit code 2. */
export const HELPER_VERBS = [
  'apt-install',
  'rpm-install',
  'dpkg-remove',
  'rpm-remove',
  'atomic-install',
  'pacstall-install',
  'pacstall-remove',
  'pacstall-upgrade',
  'pacstall-upgrade-all',
  'backup',
  'binary-remove',
  'cleanup'
] as const

export type HelperVerb = (typeof HELPER_VERBS)[number]

/**
 * A Debian/RPM package name: a leading alphanumeric followed by alphanumerics
 * and `+ . _ -`. This rejects anything that could be read as an option or a
 * path, so a package name can never inject a command.
 */
export const PACKAGE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9+._-]*$/

/**
 * Absolute directories a binary may be installed into (or backed up from)
 * through the helper. `$HOME/.local/bin` and `$HOME/.local/lib` are added per
 * user by {@link defaultInstallRoots}.
 */
export const SYSTEM_INSTALL_ROOTS = [
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/local/lib',
  '/usr/lib',
  '/usr/share',
  '/opt'
] as const

/** The `downloads` subdirectory of the app-data directory. */
export const DOWNLOAD_DIR_NAME = 'downloads'

/** The `staging` subdirectory used for privileged binary installs. */
export const STAGING_DIR_NAME = 'staging'

export interface HelperPathPolicy {
  /** Directories a downloaded/staged source file may live under. */
  readonly downloadRoots: readonly string[]
  /** Directories a privileged destination may live under. */
  readonly installRoots: readonly string[]
}

/** The directories {@link InstallerService} downloads and stages files into. */
export function defaultDownloadRoots(appSupportDirectory: string): string[] {
  return [
    posix.join(appSupportDirectory, DOWNLOAD_DIR_NAME),
    posix.join(appSupportDirectory, STAGING_DIR_NAME)
  ]
}

/** The directories the helper may write a binary into. */
export function defaultInstallRoots(home: string): string[] {
  return [
    ...SYSTEM_INSTALL_ROOTS,
    posix.join(home, '.local', 'bin'),
    posix.join(home, '.local', 'lib')
  ]
}

/**
 * Whether `candidate` is exactly `root` or lives beneath it.
 *
 * Both values are lexically normalised first, so `../` segments cannot escape
 * the root and a sibling with a shared prefix (`/usr/binfoo` vs `/usr/bin`) is
 * not mistaken for a child. Paths must be absolute.
 */
export function isUnderRoot(root: string, candidate: string): boolean {
  if (!posix.isAbsolute(root) || !posix.isAbsolute(candidate)) return false
  const normalizedRoot = posix.normalize(root).replace(/\/+$/, '')
  const normalizedCandidate = posix.normalize(candidate)
  if (normalizedRoot === '' || normalizedRoot === '/') {
    return normalizedCandidate.startsWith('/')
  }
  return (
    normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`)
  )
}

function isUnderAny(roots: readonly string[], candidate: string): boolean {
  return roots.some((root) => isUnderRoot(root, candidate))
}

function isAbsoluteWithoutLeadingDash(candidate: string): boolean {
  if (!posix.isAbsolute(candidate)) return false
  return !posix.basename(candidate).startsWith('-')
}

/**
 * Validates a helper invocation, returning `null` when it is acceptable or a
 * human-readable reason when it is not. The helper enforces exactly these
 * rules; this function exists so the rules are specified and tested in one
 * place.
 */
export function validateHelperInvocation(
  verb: string,
  args: readonly string[],
  policy: HelperPathPolicy
): string | null {
  if (!(HELPER_VERBS as readonly string[]).includes(verb)) {
    return `Unknown privileged helper verb: ${verb}`
  }

  switch (verb as HelperVerb) {
    case 'apt-install':
    case 'rpm-install': {
      if (args.length !== 1) return `${verb} expects exactly one path`
      const [filePath] = args
      if (!isAbsoluteWithoutLeadingDash(filePath)) {
        return `${verb} path must be an absolute path`
      }
      if (!isUnderAny(policy.downloadRoots, filePath)) {
        return `${verb} path is outside the downloads directory`
      }
      return null
    }

    case 'dpkg-remove':
    case 'rpm-remove':
    case 'pacstall-install':
    case 'pacstall-remove':
    case 'pacstall-upgrade': {
      if (args.length !== 1) return `${verb} expects exactly one package name`
      const [packageName] = args
      if (!PACKAGE_NAME_PATTERN.test(packageName)) {
        return `${verb} received an invalid package name`
      }
      return null
    }

    case 'pacstall-upgrade-all': {
      if (args.length !== 0) return 'pacstall-upgrade-all takes no arguments'
      return null
    }

    case 'atomic-install': {
      if (args.length !== 2) return 'atomic-install expects <src> <dest>'
      const [src, dest] = args
      if (!isAbsoluteWithoutLeadingDash(src) || !isAbsoluteWithoutLeadingDash(dest)) {
        return 'atomic-install paths must be absolute'
      }
      if (!isUnderAny(policy.downloadRoots, src)) {
        return 'atomic-install source is outside the staging directory'
      }
      if (!isUnderAny(policy.installRoots, dest)) {
        return 'atomic-install destination is outside the allowed install directories'
      }
      return null
    }

    case 'backup': {
      if (args.length !== 1) return 'backup expects exactly one path'
      const [filePath] = args
      if (!isAbsoluteWithoutLeadingDash(filePath)) {
        return 'backup path must be an absolute path'
      }
      if (!isUnderAny(policy.installRoots, filePath)) {
        return 'backup path is outside the allowed install directories'
      }
      return null
    }

    case 'binary-remove': {
      if (args.length !== 1) return 'binary-remove expects exactly one path'
      const [filePath] = args
      if (!isAbsoluteWithoutLeadingDash(filePath)) {
        return 'binary-remove path must be an absolute path'
      }
      if (!isUnderAny(policy.installRoots, filePath)) {
        return 'binary-remove path is outside the allowed install directories'
      }
      return null
    }

    case 'cleanup': {
      if (args.length !== 1) return 'cleanup expects exactly one path'
      const [filePath] = args
      if (!isAbsoluteWithoutLeadingDash(filePath)) {
        return 'cleanup path must be an absolute path'
      }
      if (!isUnderAny(policy.downloadRoots, filePath)) {
        return 'cleanup path is outside the staging directory'
      }
      return null
    }
  }
}
