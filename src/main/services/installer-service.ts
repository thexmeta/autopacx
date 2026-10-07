// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { lstatSync, promises as fs } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import * as path from 'node:path'
import { Readable } from 'node:stream'
import { APP_NAME } from '@core/index'
import { InstallType } from '@core/models/install-type'
import type { TrackedApp } from '@core/models/tracked-app'
import type { TrackedDebPackage } from '@core/models/tracked-deb-package'
import { InstallLocationResolver } from './install-location'
import { AUTOPACX_HELPER_PATH } from './privileged-helper'
import type { HelperVerb } from './privileged-helper'
import { runProcess } from './process-runner'
import type { ProcessResult } from './process-runner'

/**
 * Ported from `lib/services/installer_service.dart`.
 *
 * A Node/Electron port of the Flutter installer. Every privileged action goes
 * through `pkexec` with an argv array (never a shell string): the app invokes
 * `pkexec /usr/lib/autopacx/autopacx-helper <verb> <args...>` and the
 * root-owned helper validates the verb and every path before running anything.
 * The polkit policy binds that one helper, so `pkexec` cannot be turned into a
 * generic root shell. Both output streams are always drained.
 */

/** An install failure whose message is already written for the user to read. */
export class InstallFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InstallFailure'
  }

  override toString(): string {
    return this.message
  }
}

export interface PrivilegedRunOptions {
  readonly workingDirectory?: string
}

/** Executes the privileged helper; injectable so tests can record the argv. */
export type PrivilegedProcessRunner = (
  executable: string,
  args: readonly string[],
  options?: PrivilegedRunOptions
) => Promise<ProcessResult>

/** Reads the app-data directory; injectable so tests can point it at a temp dir. */
export type AppSupportDirectory = () => Promise<string>

/** Debug sink; a no-op by default so tests stay quiet. */
export type DebugLog = (
  category: string,
  message: string,
  data?: Record<string, unknown>
) => void | Promise<void>

/** Minimal structural view of a spawned detached child. */
export interface DetachedProcess {
  readonly stdout: NodeJS.ReadableStream | null
  readonly stderr: NodeJS.ReadableStream | null
  unref(): void
}

/** Spawns the detached launch process; injectable so tests can assert the options. */
export type DetachedSpawner = (
  executable: string,
  args: readonly string[],
  options: { readonly detached: true; readonly stdio: ['ignore', 'pipe', 'pipe'] }
) => DetachedProcess

export interface DownloadStreamedResponse {
  readonly statusCode: number
  readonly headers: Readonly<Record<string, string>>
  readonly contentLength: number | null
  readonly isRedirect: boolean
  readonly stream: AsyncIterable<Uint8Array>
}

/** Streaming HTTP transport used by {@link InstallerService.downloadFile}. */
export interface DownloadHttpClient {
  send(url: string, signal: AbortSignal): Promise<DownloadStreamedResponse>
  /** Releases transport resources; optional because the fetch wrapper has none. */
  close?(): void
}

export type DownloadHttpClientFactory = () => DownloadHttpClient

export interface InstallResult {
  readonly launchCommand: string | null
  readonly packageName: string | null
}

export interface InstallPackageOptions {
  readonly targetPath?: string | null
  readonly binaryName?: string | null
}

export interface InstallerServiceOptions {
  readonly appSupportDirectory?: AppSupportDirectory
  readonly privilegedProcessRunner?: PrivilegedProcessRunner
  readonly packageLaunchCommandResolver?: (packageName: string | null) => Promise<string | null>
  readonly httpClientFactory?: DownloadHttpClientFactory
  readonly debugLog?: DebugLog
  readonly spawnDetached?: DetachedSpawner
  readonly maxDownloadBytes?: number
  /** Absolute path of the root-owned helper; defaults to the installed path. */
  readonly privilegedHelperPath?: string
  /** Whether the helper is installed; injectable so tests need no root. */
  readonly helperInstalled?: () => Promise<boolean>
}

/** Records the bytes of a file as they were downloaded, for a TOCTOU re-check. */
interface DownloadedFileRecord {
  readonly size: number
  readonly sha256: string
}

/** Upper bound on a single downloaded asset: 1 GiB. */
const DEFAULT_MAX_DOWNLOAD_BYTES = 1 << 30

const DOWNLOAD_TIMEOUT_MS = 30_000

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

const BINARY_ARCHIVE_SUFFIXES = [
  '.tar.gz',
  '.tgz',
  '.tar.xz',
  '.txz',
  '.tar.bz2',
  '.tbz2',
  '.tar.zst',
  '.zip'
] as const

const NON_BINARY_BASENAMES = new Set([
  'license',
  'licence',
  'copying',
  'notice',
  'readme',
  'changelog',
  'changes',
  'contributing',
  'authors',
  'install',
  'makefile',
  'sha256sums',
  'sha512sums',
  'checksums',
  'checksum',
  'latest',
  'version',
  'manifest'
])

const BINARY_PLATFORM_TOKENS = new Set([
  'amd64',
  'x86',
  'x64',
  'i386',
  'i686',
  'aarch64',
  'arm64',
  'armv7',
  'armhf',
  'riscv64',
  'ppc64le',
  's390x',
  'linux',
  'musl'
])

const noopDebugLog: DebugLog = () => {}

/**
 * Default app-data directory, mirroring path_provider's Linux behaviour
 * (`$XDG_DATA_HOME/<app>` or `~/.local/share/<app>`). Production wiring injects
 * Electron's `app.getPath('userData')`; tests always inject a temp directory.
 */
function defaultAppSupportDirectory(): Promise<string> {
  const xdg = process.env['XDG_DATA_HOME']
  const base = xdg != null && xdg.length > 0 ? xdg : path.join(homedir(), '.local', 'share')
  return Promise.resolve(path.join(base, APP_NAME))
}

/**
 * Runs `executable` with an argv array — never a shell string — and collects
 * both output streams. Rejects on spawn failure, matching Dart's `Process.run`
 * throwing a `ProcessException` for a missing executable.
 */
export function defaultPrivilegedProcessRunner(
  executable: string,
  args: readonly string[],
  options: PrivilegedRunOptions = {}
): Promise<ProcessResult> {
  return new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(executable, [...args], {
      cwd: options.workingDirectory,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let settled = false

    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk))

    child.once('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    child.once('close', (code) => {
      if (settled) return
      settled = true
      resolve({
        exitCode: code ?? -1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8')
      })
    })
  })
}

/** Wraps Node's global `fetch` into the streaming download contract. */
function createNodeDownloadClient(): DownloadHttpClient {
  return {
    async send(url, signal) {
      const response = await fetch(url, { method: 'GET', redirect: 'manual', signal })

      const headers: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value
      })

      const rawLength = headers['content-length']
      const parsedLength = rawLength != null ? Number.parseInt(rawLength, 10) : Number.NaN

      const body = response.body
      const stream =
        body != null
          ? (Readable.fromWeb(
              body as unknown as Parameters<typeof Readable.fromWeb>[0]
            ) as AsyncIterable<Uint8Array>)
          : emptyStream()

      return {
        statusCode: response.status,
        headers,
        contentLength: Number.isNaN(parsedLength) ? null : parsedLength,
        isRedirect: REDIRECT_STATUSES.has(response.status),
        stream
      }
    }
  }
}

function emptyStream(): AsyncIterable<Uint8Array> {
  return Readable.from([]) as AsyncIterable<Uint8Array>
}

/** Default detached spawner over `node:child_process.spawn`. */
const defaultDetachedSpawner: DetachedSpawner = (executable, args, options) =>
  spawn(executable, [...args], options)
async function fileExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate)
    return true
  } catch {
    return false
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The value of the first `Exec=` line in `desktopFile`, or null. */
async function firstDesktopExecLine(desktopFile: string): Promise<string | null> {
  try {
    const contents = await fs.readFile(desktopFile, 'utf8')
    for (const line of contents.split('\n')) {
      if (line.startsWith('Exec=')) return line.slice('Exec='.length)
    }
  } catch {
    // An unreadable desktop entry simply yields no suggestion.
  }
  return null
}

/** Whether `candidate` is a directory entry holding a runnable program. */
function isBinPath(candidate: string): boolean {
  for (const dir of ['/usr/bin/', '/usr/local/bin/', '/bin/']) {
    if (candidate.startsWith(dir) && candidate.length > dir.length) return true
  }
  return false
}

/** The names this app's own executable could plausibly be shipped under. */
function expectedExecutableNames(app: TrackedApp): Set<string> {
  const names = new Set<string>([app.repoName.toLowerCase(), app.displayName.toLowerCase()])
  if (app.packageName != null && app.packageName.length > 0) {
    names.add(path.basename(app.packageName.toLowerCase()))
  }
  const launch = app.launchCommand
  if (launch != null && launch.trim().length > 0) {
    const first = launch.trim().split(/\s+/)[0]
    names.add(path.basename(first).toLowerCase())
  }
  for (const name of [...names]) {
    if (name.length === 0) names.delete(name)
  }
  return names
}

/** True when `basename` affirmatively looks like a raw binary. */
function hasBinaryNameSignal(basename: string, app: TrackedApp | null): boolean {
  const tokens = basename.split(/[^a-z0-9]+/)
  if (tokens.some((token) => BINARY_PLATFORM_TOKENS.has(token))) return true
  if (app == null) return false
  return expectedExecutableNames(app).has(basename)
}

export class InstallerService {
  /** Where this user's application data lives. */
  appSupportDirectory: AppSupportDirectory

  /** Executes the privileged helper. */
  privilegedProcessRunner: PrivilegedProcessRunner

  /** Derives the launch command for a just-installed package from its payload. */
  packageLaunchCommandResolver: (packageName: string | null) => Promise<string | null>

  /** Builds the HTTP client used by {@link downloadFile}. */
  httpClientFactory: DownloadHttpClientFactory

  /** Upper bound on a single downloaded asset. */
  maxDownloadBytes: number

  /** Absolute path of the root-owned helper invoked through `pkexec`. */
  privilegedHelperPath: string

  /** Whether the helper is installed; checked before any `pkexec` call. */
  helperInstalled: () => Promise<boolean>

  private readonly debugLog: DebugLog
  private readonly spawnDetached: DetachedSpawner

  /**
   * Bytes of every file this instance downloaded, keyed by absolute path, so
   * the privileged install can re-verify the file has not changed since it was
   * downloaded (TOCTOU). Files the app did not download are not tracked and are
   * not re-verified; every real install goes through {@link downloadFile}.
   */
  private readonly downloadedFiles = new Map<string, DownloadedFileRecord>()

  constructor(options: InstallerServiceOptions = {}) {
    this.appSupportDirectory = options.appSupportDirectory ?? defaultAppSupportDirectory
    this.privilegedProcessRunner = options.privilegedProcessRunner ?? defaultPrivilegedProcessRunner
    this.packageLaunchCommandResolver =
      options.packageLaunchCommandResolver ?? ((name) => this.resolvePackageLaunchCommand(name))
    this.httpClientFactory = options.httpClientFactory ?? createNodeDownloadClient
    this.debugLog = options.debugLog ?? noopDebugLog
    this.spawnDetached = options.spawnDetached ?? defaultDetachedSpawner
    this.maxDownloadBytes = options.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES
    this.privilegedHelperPath = options.privilegedHelperPath ?? AUTOPACX_HELPER_PATH
    this.helperInstalled = options.helperInstalled ?? (() => fileExists(this.privilegedHelperPath))
  }

  private async log(
    category: string,
    message: string,
    data?: Record<string, unknown>
  ): Promise<void> {
    await this.debugLog(category, message, data)
  }

  // --- download -------------------------------------------------------------

  /**
   * Creates a directory with mode 0700.
   *
   * Downloads and staged payloads are installed as root, so they must not be
   * readable or writable by other local users; the explicit `chmod` makes the
   * mode deterministic regardless of the process umask.
   */
  private async ensurePrivateDir(dir: string): Promise<string> {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 })
    try {
      await fs.chmod(dir, 0o700)
    } catch (error) {
      await this.log('InstallerService', `Could not chmod ${dir} to 0700: ${errorMessage(error)}`)
    }
    return dir
  }

  private async downloadsDir(): Promise<string> {
    const dataDir = await this.appSupportDirectory()
    return this.ensurePrivateDir(path.join(dataDir, 'downloads'))
  }

  private async stagingDir(): Promise<string> {
    const dataDir = await this.appSupportDirectory()
    return this.ensurePrivateDir(path.join(dataDir, 'staging'))
  }

  private async appImageDir(): Promise<string> {
    const dataDir = await this.appSupportDirectory()
    const dir = path.join(dataDir, 'appimages')
    await fs.mkdir(dir, { recursive: true })
    return dir
  }

  async downloadFile(url: string, filename: string): Promise<string> {
    const uri = new URL(url)
    // The downloaded bytes become the user's binary, and on an unwritable
    // target they are installed as root, so plaintext transport is not
    // acceptable even when the caller supplies the URL.
    if (uri.protocol !== 'https:') {
      throw new Error(`Refusing to download over ${uri.protocol.replace(/:$/, '')}: ${url}`)
    }

    const dir = await this.downloadsDir()
    const filePath = path.join(dir, this.sanitizeFilename(filename))

    const client = this.httpClientFactory()
    let writing = false
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
      let response: DownloadStreamedResponse
      try {
        response = await this.sendFollowingHttpsRedirects(client, uri, controller.signal)
      } finally {
        clearTimeout(timer)
      }

      if (response.statusCode !== 200) {
        throw new Error(`Failed to download file: ${response.statusCode}`)
      }

      const declared = response.contentLength
      if (declared != null && declared > this.maxDownloadBytes) {
        throw new Error(
          `Refusing to download ${url}: ${declared} bytes exceeds the ` +
            `${this.maxDownloadBytes} byte limit`
        )
      }

      const handle = await fs.open(filePath, 'w')
      writing = true
      let written = 0
      const hash = createHash('sha256')
      try {
        for await (const chunk of response.stream) {
          written += chunk.byteLength
          if (written > this.maxDownloadBytes) {
            throw new Error(
              `Aborting download of ${url}: exceeded the ${this.maxDownloadBytes} byte limit`
            )
          }
          hash.update(chunk)
          await handle.write(chunk)
        }
      } finally {
        await handle.close()
      }
      // Remember the exact bytes so the privileged install can refuse a file
      // that changed on disk after it was downloaded (TOCTOU).
      this.downloadedFiles.set(path.resolve(filePath), {
        size: written,
        sha256: hash.digest('hex')
      })
      return filePath
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error(`Timed out downloading file after 30s: ${url}`, { cause: error })
      }
      // A truncated file must never be mistaken for a complete download.
      if (writing && (await fileExists(filePath))) {
        await fs.rm(filePath, { force: true })
      }
      throw error
    } finally {
      client.close?.()
    }
  }

  /**
   * Sends a GET, following redirects by hand so every hop can be required to be
   * HTTPS. `fetch` follows redirects silently, so a URL that starts as HTTPS
   * can be redirected to plaintext `http://` and the response would still be
   * accepted.
   */
  private async sendFollowingHttpsRedirects(
    client: DownloadHttpClient,
    uri: URL,
    signal: AbortSignal
  ): Promise<DownloadStreamedResponse> {
    let current = uri
    for (let hop = 0; hop <= 5; hop++) {
      const response = await client.send(current.toString(), signal)
      if (!response.isRedirect) return response

      const location = response.headers['location']
      if (location == null) {
        throw new Error(`Redirect without a Location header from ${current}`)
      }
      const next = new URL(location, current)
      if (next.protocol !== 'https:') {
        throw new Error(
          `Refusing to download over ${next.protocol.replace(/:$/, '')}: redirect from ` +
            `${current} downgraded to ${next}`
        )
      }
      current = next
    }
    throw new Error(`Too many redirects downloading ${uri}`)
  }

  /**
   * Reduces `filename` to a single, safe path component.
   *
   * The name can be derived from user-controlled package metadata, so a value
   * such as `../../etc/passwd` must not be allowed to escape the downloads
   * directory. Directory components (both `/` and `\`) are stripped and a name
   * that reduces to nothing, `.` or `..` is rejected.
   */
  private sanitizeFilename(filename: string): string {
    const base = path.basename(filename.replace(/\\/g, '/'))
    const cleaned = base.replace(/[/\\]/g, '').trim()
    if (cleaned.length === 0 || cleaned === '.' || cleaned === '..') {
      throw new Error(`Invalid download filename: "${filename}"`)
    }
    return cleaned
  }

  /**
   * Re-verifies a downloaded file against the bytes recorded at download time,
   * immediately before it is installed as root.
   *
   * The downloads directory is user-writable, so a local process could replace
   * the file between the download and the privileged install. The size and the
   * SHA-256 captured while streaming the response are the reference; any change
   * aborts the install. Files this instance did not download are not tracked
   * (every real install goes through {@link downloadFile}) and are skipped.
   */
  private async verifyDownloadUnchanged(filePath: string): Promise<void> {
    const record = this.downloadedFiles.get(path.resolve(filePath))
    if (record === undefined) return

    let stat
    try {
      stat = await fs.stat(filePath)
    } catch {
      throw new Error(`Refusing to install: downloaded file is missing: ${filePath}`)
    }
    if (stat.size !== record.size) {
      throw new Error(`Refusing to install: ${path.basename(filePath)} changed size after download`)
    }
    const actual = await sha256File(filePath)
    if (actual !== record.sha256) {
      throw new Error(
        `Refusing to install: ${path.basename(filePath)} failed its checksum re-check`
      )
    }
  }

  // --- install --------------------------------------------------------------

  async installPackage(
    filePath: string,
    type: InstallType,
    options: InstallPackageOptions = {}
  ): Promise<InstallResult> {
    switch (type) {
      case InstallType.deb: {
        let pkgName: string | null = null
        try {
          const res = await runProcess('dpkg-deb', ['-f', filePath, 'Package'])
          if (res.exitCode === 0) pkgName = res.stdout.trim()
        } catch {
          // A name that cannot be read simply yields no package name.
        }

        // Pass the ABSOLUTE path. `pkexec` resets the working directory to the
        // target user's home (/root) regardless of the caller's cwd, so a
        // relative "./<basename>" path never resolves and apt-get fails with
        // "E: Unsupported file ./<name>.deb given on commandline" (exit 100).
        await this.verifyDownloadUnchanged(filePath)
        await this.runPrivileged('apt-install', [filePath])
        await this.deleteTempDownload(filePath)
        // The package's own payload is the only trustworthy source for how to
        // launch it: the command recorded at add time is a guess from the repo
        // name, so `fluxdown` was stored for a deb that ships `fluxdown-desktop`.
        const launch = await this.packageLaunchCommandResolver(pkgName)
        return { launchCommand: launch, packageName: pkgName }
      }

      case InstallType.rpm: {
        let pkgName: string | null = null
        try {
          const res = await runProcess('rpm', ['-qp', '--queryformat', '%{NAME}', filePath])
          if (res.exitCode === 0) pkgName = res.stdout.trim()
        } catch {
          // Best effort.
        }

        await this.verifyDownloadUnchanged(filePath)
        await this.runPrivileged('rpm-install', [filePath])
        await this.deleteTempDownload(filePath)
        return { launchCommand: null, packageName: pkgName }
      }

      case InstallType.flatpak: {
        const flatpakResult = await runProcess('flatpak', ['install', '-y', filePath])
        if (flatpakResult.exitCode !== 0) {
          throw new Error(
            `flatpak install failed (exit code ${flatpakResult.exitCode}): ${flatpakResult.stderr}`.trim()
          )
        }
        await this.deleteTempDownload(filePath)
        return { launchCommand: null, packageName: null }
      }

      case InstallType.appImage: {
        const appImageDir = await this.appImageDir()
        const target = path.join(appImageDir, path.basename(filePath))
        await fs.copyFile(filePath, target)
        const chmodResult = await runProcess('chmod', ['+x', target])
        if (chmodResult.exitCode !== 0) {
          throw new Error(
            `chmod +x failed (exit code ${chmodResult.exitCode}): ${chmodResult.stderr}`.trim()
          )
        }
        await this.deleteTempDownload(filePath)
        return { launchCommand: target, packageName: null }
      }

      case InstallType.binary:
        return this.installBinary(filePath, options)

      default:
        throw new Error(`Installation not supported for ${type}`)
    }
  }

  /**
   * Installs a raw or archived binary.
   *
   * Archives are extracted into a throwaway temp directory; a raw download is
   * validated as ELF so a filter pattern that matched a script or JSON cannot
   * be installed as an executable. The payload selected out of an archive is
   * ELF-validated too. The payload is staged next to the target and atomically
   * renamed into place, with the previous file preserved as `<target>.bak`
   * first so the install is always reversible.
   */
  private async installBinary(
    filePath: string,
    options: InstallPackageOptions
  ): Promise<InstallResult> {
    const { targetPath, binaryName } = options
    // A caller-supplied target is rejected before extracting or writing
    // anything, so a `-`-prefixed or otherwise unsafe path cannot reach the
    // privileged `install` call.
    if (targetPath != null) {
      const error = InstallerService.installTargetError(targetPath)
      if (error != null) throw new Error(error)
    }

    // The downloaded artifact is re-verified before it is read or extracted, so
    // a file swapped on disk after download is never turned into a root install.
    await this.verifyDownloadUnchanged(filePath)

    const isArchive = BINARY_ARCHIVE_SUFFIXES.some((suffix) =>
      filePath.toLowerCase().endsWith(suffix)
    )
    let tempDir: string | null = null
    try {
      let payload: string
      let effectiveName: string
      if (isArchive) {
        tempDir = await fs.mkdtemp(path.join(tmpdir(), 'autopacx_binary_'))
        await this.extractArchive(filePath, tempDir)
        payload = await this.locatePayload(tempDir, binaryName ?? null, filePath)
        // Archives get the same ELF guarantee raw downloads already have: an
        // archive with no executable in it must never be installed.
        await this.verifyExtractedPayload(payload)
        effectiveName = binaryName ?? path.basename(payload)
      } else {
        await this.verifyElf(filePath)
        payload = filePath
        effectiveName = binaryName ?? path.basename(filePath)
      }

      const target = targetPath ?? this.defaultBinaryTarget(effectiveName)
      const targetError = InstallerService.installTargetError(target)
      if (targetError != null) throw new Error(targetError)
      await this.stageAndInstallBinary(payload, target)

      await this.deleteTempDownload(filePath)
      return { launchCommand: target, packageName: effectiveName }
    } finally {
      if (tempDir != null) {
        try {
          await fs.rm(tempDir, { recursive: true, force: true })
        } catch (error) {
          // Cleanup is best effort: never fail an install that already
          // succeeded because a temp dir could not be removed.
          await this.log(
            'InstallerService',
            `Could not remove temp dir ${tempDir}: ${errorMessage(error)}`
          )
        }
      }
    }
  }

  private async extractArchive(archivePath: string, destination: string): Promise<void> {
    const isZip = archivePath.toLowerCase().endsWith('.zip')
    const result = isZip
      ? await runProcess('unzip', ['-q', archivePath, '-d', destination])
      : // GNU tar auto-detects gzip/xz/bzip2/zstd when extracting.
        await runProcess('tar', ['-xf', archivePath, '-C', destination])
    if (result.exitCode !== 0) {
      const stderr = result.stderr.trim()
      throw new Error(
        `Failed to extract ${path.basename(archivePath)}` +
          `${stderr.length > 0 ? `: ${stderr}` : ` (exit code ${result.exitCode})`}`
      )
    }
  }

  /** Whether `filePath` starts with the ELF magic bytes. */
  private async isElf(filePath: string): Promise<boolean> {
    const handle = await fs.open(filePath, 'r')
    try {
      const buffer = Buffer.alloc(4)
      const { bytesRead } = await handle.read(buffer, 0, 4, 0)
      return (
        bytesRead >= 4 &&
        buffer[0] === 0x7f &&
        buffer[1] === 0x45 &&
        buffer[2] === 0x4c &&
        buffer[3] === 0x46
      )
    } finally {
      await handle.close()
    }
  }

  /** Verifies that `filePath` starts with the ELF magic bytes. */
  private async verifyElf(filePath: string): Promise<void> {
    if (await this.isElf(filePath)) return
    throw new Error(`Refusing to install ${path.basename(filePath)}: not an ELF executable`)
  }

  /** Fails when an extracted archive contains no executable. */
  private async verifyExtractedPayload(payload: string): Promise<void> {
    if (await this.isElf(payload)) return
    throw new InstallFailure('This entry cant be installable. It doesnt include binary/executable.')
  }

  /**
   * Finds the executable inside the archive extracted into `dir`.
   *
   * Only two signals are trusted: an exact `binaryName` match, then the first
   * regular file carrying an execute bit. Candidates are sorted so the choice
   * does not depend on filesystem listing order. Only the first 3 directory
   * levels are searched.
   */
  private async locatePayload(
    dir: string,
    binaryName: string | null,
    archivePath: string
  ): Promise<string> {
    const candidates = await listFilesWithinDepth(dir, 3)
    // Filesystem listing order is not stable; sort so the pick is stable.
    candidates.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

    if (binaryName != null && binaryName.length > 0) {
      for (const candidate of candidates) {
        if (path.basename(candidate) === binaryName) return candidate
      }
    }

    for (const candidate of candidates) {
      const stat = await fs.stat(candidate)
      if ((stat.mode & 0o111) !== 0) return candidate
    }

    const names = candidates.map((candidate) => path.relative(dir, candidate)).join(', ')
    throw new Error(
      `No installable executable found in ${path.basename(archivePath)}` +
        `${names.length === 0 ? '' : ` (candidates: ${names})`}`
    )
  }

  /** Default install location when the caller does not choose one. */
  private defaultBinaryTarget(binaryName: string): string {
    const home = process.env['HOME']
    if (home == null || home.length === 0) {
      throw new Error(
        'Cannot determine install location: HOME is not set. Pass an explicit target path.'
      )
    }
    return path.join(home, '.local', 'bin', binaryName)
  }

  /**
   * Stages `payload` beside `target` and moves it into place.
   *
   * The existing target is copied to `<target>.bak` before it is replaced. If
   * the target directory is not writable the backup is made beside the target
   * with a privileged copy and the install falls back to a privileged atomic
   * install.
   */
  private async stageAndInstallBinary(payload: string, target: string): Promise<void> {
    const targetDir = path.dirname(target)
    let writable = await InstallLocationResolver.isDirWritable(targetDir)
    if (!writable) {
      // A missing directory (e.g. ~/.local/bin) may still be creatable.
      try {
        await fs.mkdir(targetDir, { recursive: true })
        writable = await InstallLocationResolver.isDirWritable(targetDir)
      } catch {
        writable = false
      }
    }

    if (writable) {
      const staging = `${target}.tmp`
      try {
        await fs.copyFile(payload, staging)
        const chmodResult = await runProcess('chmod', ['755', staging])
        if (chmodResult.exitCode !== 0) {
          const stderr = chmodResult.stderr.trim()
          throw new Error(
            `chmod 755 failed on ${staging}` +
              `${stderr.length > 0 ? `: ${stderr}` : ` (exit code ${chmodResult.exitCode})`}`
          )
        }
        // The new payload is safely staged; only now is the old file backed up.
        await this.backupExistingTarget(target, true)
        // rename(2) replaces the destination atomically on Linux.
        await fs.rename(staging, target)
      } finally {
        // A successful rename consumed the staging path; on any failure this
        // removes the half-written file so nothing is left behind.
        await this.removeIfPresent(staging)
      }
    } else {
      const backup = await this.backupExistingTarget(target, false)
      if (backup != null) {
        // Record where the backup went; the user needs this path to restore.
        await this.log(
          'InstallerService',
          `Target ${target} not writable; backed it up to ${backup}`
        )
      }
      // Stage the payload in the app's private staging directory, then let the
      // root helper install it atomically (`install` to a sibling + `mv`), so
      // the target is either the old binary or the new one — never absent,
      // never half-written. ONE privileged invocation does both steps.
      const stagingDir = await this.stagingDir()
      const staging = path.join(
        stagingDir,
        `${path.basename(target)}.${process.pid}.${randomBytes(8).toString('hex')}.new`
      )
      try {
        await fs.copyFile(payload, staging)
        await this.runPrivileged('atomic-install', [staging, target])
      } finally {
        // The staging directory is user-owned, so a plain removal suffices and
        // needs no second prompt.
        await this.removeIfPresent(staging)
      }
    }
  }

  private async removeIfPresent(filePath: string): Promise<void> {
    try {
      if (await fileExists(filePath)) await fs.rm(filePath, { force: true })
    } catch (error) {
      await this.log(
        'InstallerService',
        `Could not remove temporary file ${filePath}: ${errorMessage(error)}`
      )
    }
  }

  /**
   * Returns a human-readable reason why `target` is not a valid install
   * destination, or null when it is acceptable.
   */
  static installTargetError(target: string): string | null {
    if (!path.isAbsolute(target)) {
      return `Install path must be absolute: ${target}`
    }
    const normalized = path.normalize(target)
    for (const forbidden of ['/dev', '/proc', '/sys']) {
      if (normalized === forbidden || normalized.startsWith(`${forbidden}/`)) {
        return `Refusing to install into ${forbidden}: ${target}`
      }
    }
    if (path.basename(target).startsWith('-')) {
      return `Install path must not start with "-": ${target}`
    }
    // lstat does not follow, so a symlink is detected even when it points at a
    // regular file (which we would otherwise happily replace).
    let stat
    try {
      stat = lstatSync(target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    if (stat.isSymbolicLink()) {
      return `Install path is a symbolic link: ${target}`
    }
    if (stat.isDirectory()) {
      return `Install path is a directory: ${target}`
    }
    if (stat.isFile()) {
      return null
    }
    return `Install path is not a regular file: ${target}`
  }

  /**
   * Backup filename used when the target directory is not writable and even a
   * privileged copy beside the target failed.
   *
   * Keyed by a hash of the full path, not just the basename, so two targets
   * with the same name in different directories cannot clobber each other.
   */
  static appDataBackupName(target: string): string {
    const absolute = path.resolve(target)
    // FNV-1a 32-bit over the absolute path. Dart iterates UTF-16 `codeUnits`,
    // so use `charCodeAt`; JS `*`/`+` lose precision on 32-bit values, so the
    // multiply must go through `Math.imul` and stay unsigned.
    let hash = 0x811c9dc5
    for (let index = 0; index < absolute.length; index++) {
      hash ^= absolute.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    const hex = hash.toString(16).padStart(8, '0')
    return `${path.basename(target)}.${hex}.bak`
  }

  /**
   * Copies an existing `target` to a backup, or returns null when there is
   * nothing to back up.
   *
   * On the writable path the backup sits beside the target. When the target
   * directory is not writable the backup is still created beside the target via
   * the helper's `backup` verb, so it stays discoverable at a predictable path;
   * only if that fails does it fall back to the app data directory.
   */
  private async backupExistingTarget(
    target: string,
    targetDirWritable: boolean
  ): Promise<string | null> {
    if (!(await fileExists(target))) return null

    if (targetDirWritable) {
      const backupPath = `${target}.bak`
      await fs.copyFile(target, backupPath)
      return backupPath
    }

    const besidePath = `${target}.bak`
    try {
      await this.runPrivileged('backup', [target])
      return besidePath
    } catch (error) {
      await this.log(
        'InstallerService',
        `Privileged backup of ${target} failed (${errorMessage(error)}); using app data directory`
      )
    }

    const dataDir = await this.appSupportDirectory()
    const backupDir = path.join(dataDir, 'binary_backups')
    await fs.mkdir(backupDir, { recursive: true })
    const backupPath = path.join(backupDir, InstallerService.appDataBackupName(target))
    await fs.copyFile(target, backupPath)
    return backupPath
  }

  // --- uninstall ------------------------------------------------------------

  async uninstallPackage(app: TrackedApp): Promise<void> {
    const type = app.installType
    if (type === InstallType.appImage && app.launchCommand != null) {
      const filePath = app.launchCommand
      if (await fileExists(filePath)) await fs.rm(filePath, { force: true })
    } else if (type === InstallType.deb && app.packageName != null) {
      await this.runPrivileged('dpkg-remove', [app.packageName])
    } else if (type === InstallType.rpm && app.packageName != null) {
      await this.runPrivileged('rpm-remove', [app.packageName])
    } else if (type === InstallType.flatpak) {
      const ref = app.packageName
      if (ref == null || ref.length === 0) {
        throw new Error(
          'Cannot uninstall Flatpak: no application ID is stored for this app. ' +
            'Set it in the app settings or remove it manually with ' +
            '"flatpak uninstall <app-id>".'
        )
      }
      const result = await runProcess('flatpak', ['uninstall', '-y', ref])
      if (result.exitCode !== 0) {
        const stderr = result.stderr.trim()
        throw new Error(
          `flatpak uninstall failed (exit code ${result.exitCode})` +
            `${stderr.length > 0 ? `: ${stderr}` : ''}`
        )
      }
    } else if (type === InstallType.snap) {
      throw new Error(
        'Uninstall is not supported for snap; remove it with ' +
          `"snap remove ${app.packageName ?? '<package-name>'}".`
      )
    } else if (type === InstallType.binary) {
      await this.uninstallBinary(app)
    } else if (type === InstallType.source) {
      throw new Error(
        `Uninstall is not supported for ${type}; remove it with the ` +
          'same method used to install it.'
      )
    } else {
      throw new Error('Uninstall not supported for this app (missing package info)')
    }
  }

  async uninstallDebPackage(pkg: TrackedDebPackage): Promise<void> {
    if (pkg.packageName != null) {
      await this.runPrivileged('dpkg-remove', [pkg.packageName])
    } else {
      throw new Error('Uninstall not supported for this package (missing package name)')
    }
  }

  /**
   * Uninstalls a binary installed by {@link installBinary}.
   *
   * The installed path is the app's stored `launchCommand`. When the install
   * replaced an existing file, that file was saved as `<target>.bak` beside the
   * target (or, if even a privileged copy beside it failed, under the app-data
   * `binary_backups/` directory); uninstalling puts the saved file back, so
   * removing an app never destroys a binary it overwrote. A missing target with
   * no backup is a no-op, so uninstalling twice is safe.
   */
  private async uninstallBinary(app: TrackedApp): Promise<void> {
    const target = app.launchCommand?.trim()
    if (target == null || target.length === 0) {
      throw new Error('Cannot uninstall this binary: no installed path is stored for this app.')
    }

    const backup = await this.binaryBackupPath(target)
    const targetExists = await fileExists(target)
    if (!targetExists && backup == null) return

    const targetDirWritable = await InstallLocationResolver.isDirWritable(path.dirname(target))
    if (targetDirWritable) {
      if (backup != null) {
        await this.restoreBinaryBackup(backup, target, true)
      } else {
        await fs.rm(target, { force: true })
      }
      return
    }

    // The target directory is root-owned: removal and any restore go through
    // the helper, whose `binary-remove` verb validates the path against the
    // install allowlist.
    if (targetExists) await this.runPrivileged('binary-remove', [target])
    if (backup != null) await this.restoreBinaryBackup(backup, target, false)
  }

  /** Path of the file the last install replaced, or null when there is none. */
  private async binaryBackupPath(target: string): Promise<string | null> {
    const beside = `${target}.bak`
    if (await fileExists(beside)) return beside
    const dataDir = await this.appSupportDirectory()
    const appDataBackup = path.join(
      dataDir,
      'binary_backups',
      InstallerService.appDataBackupName(target)
    )
    return (await fileExists(appDataBackup)) ? appDataBackup : null
  }

  /**
   * Puts `backup` back at `target` and removes the consumed backup.
   *
   * On a writable target directory a sibling backup is renamed into place
   * (atomic, and its mode is preserved); a backup that lives elsewhere is
   * copied. When the target directory is not writable the backup is staged in
   * the app's private directory and moved into place by the helper's
   * `atomic-install`, one privileged call; the sibling backup itself is then
   * dropped with `binary-remove`.
   */
  private async restoreBinaryBackup(
    backup: string,
    target: string,
    targetDirWritable: boolean
  ): Promise<void> {
    const beside = backup === `${target}.bak`
    if (targetDirWritable && beside) {
      await fs.rename(backup, target)
      return
    }
    if (targetDirWritable) {
      await fs.copyFile(backup, target)
      await fs.chmod(target, 0o755)
      await fs.rm(backup, { force: true })
      return
    }

    const stagingDir = await this.stagingDir()
    const staging = path.join(
      stagingDir,
      `${path.basename(target)}.${process.pid}.${randomBytes(8).toString('hex')}.restore`
    )
    try {
      await fs.copyFile(backup, staging)
      await this.runPrivileged('atomic-install', [staging, target])
    } finally {
      await this.removeIfPresent(staging)
    }
    if (beside) {
      try {
        await this.runPrivileged('binary-remove', [backup])
      } catch (error) {
        // The binary is already restored; a leftover backup must not fail it.
        await this.log(
          'InstallerService',
          `Could not remove binary backup ${backup}: ${errorMessage(error)}`
        )
      }
    } else {
      await fs.rm(backup, { force: true })
    }
  }

  // --- launch ---------------------------------------------------------------

  async launchApp(app: TrackedApp): Promise<void> {
    if (app.launchCommand != null) {
      // If we have a stored command/path, use it (may include arguments).
      await this.startDetached(app.launchCommand)
      return
    }

    if (app.installType === InstallType.appImage && app.installedVersion != null) {
      // Fallback for old AppImages without a stored path.
      const appImageDir = await this.appImageDir()
      const entries = await fs.readdir(appImageDir)
      for (const entry of entries) {
        if (entry.toLowerCase().includes(app.repoName.toLowerCase())) {
          await this.startDetached(path.join(appImageDir, entry))
          return
        }
      }
      throw new Error('Could not find AppImage to launch')
    } else {
      // For system installs, try running the repo name as command.
      try {
        await this.startDetached(app.repoName)
      } catch (error) {
        // Try lowercase as fallback (common for Linux binaries).
        if (app.repoName !== app.repoName.toLowerCase()) {
          try {
            await this.startDetached(app.repoName.toLowerCase())
            return
          } catch {
            // Ignore and throw the original error.
          }
        }
        throw new Error(`Could not launch ${app.repoName}: ${errorMessage(error)}`, {
          cause: error
        })
      }
    }
  }

  async launchDebPackage(pkg: TrackedDebPackage): Promise<void> {
    if (pkg.launchCommand != null) {
      await this.startDetached(pkg.launchCommand)
    } else {
      try {
        await this.startDetached(pkg.name)
      } catch (error) {
        throw new Error(`Could not launch ${pkg.name}: ${errorMessage(error)}`, { cause: error })
      }
    }
  }

  /**
   * Starts `command` without waiting for it.
   *
   * A launch command may be a bare executable path that itself contains spaces
   * (e.g. `/opt/My App/bin/app`), or a command with arguments (e.g.
   * `code --no-sandbox`). Splitting on whitespace would corrupt the former, so
   * the whole string is used verbatim when it resolves to an existing file;
   * otherwise it is split into executable + arguments. Both output streams are
   * drained so a chatty child cannot deadlock once the pipe buffer fills up.
   */
  private async startDetached(command: string): Promise<void> {
    const trimmed = command.trim()
    if (trimmed.length === 0) {
      throw new Error('Cannot launch: empty launch command')
    }
    let executable: string
    let args: string[]
    if (await fileExists(trimmed)) {
      executable = trimmed
      args = []
    } else {
      const parts = trimmed.split(/\s+/)
      executable = parts[0]
      args = parts.slice(1)
    }
    const child = this.spawnDetached(executable, args, {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    child.stdout?.on('data', () => {})
    child.stderr?.on('data', () => {})
    child.unref()
  }

  // --- asset identification -------------------------------------------------

  /**
   * Returns the install type for `filename`, or null when it is not something
   * this app can install.
   */
  identifyAssetType(
    filename: string,
    options: { readonly app?: TrackedApp | null } = {}
  ): InstallType | null {
    const lower = filename.toLowerCase()
    // Package formats are checked first so they keep winning over the generic
    // binary fallback below.
    if (lower.endsWith('.deb')) return InstallType.deb
    if (lower.endsWith('.rpm')) return InstallType.rpm
    if (lower.endsWith('.appimage')) return InstallType.appImage
    if (lower.endsWith('.flatpak')) return InstallType.flatpak
    if (lower.endsWith('.snap')) return InstallType.snap
    if (BINARY_ARCHIVE_SUFFIXES.some((suffix) => lower.endsWith(suffix))) {
      return InstallType.binary
    }
    // An extension-less asset name carries no format information, so "has no
    // dot" is not evidence of anything. Require positive evidence instead: a
    // platform token in the name, or the name being the executable we expect
    // for this app. A name with an unrecognised extension is never a binary.
    const basename = lower.split('/').pop() ?? lower
    // Hidden files and documentation/metadata names are never binaries.
    if (basename.startsWith('.')) return null
    if (NON_BINARY_BASENAMES.has(basename)) return null
    if (!basename.includes('.')) {
      return hasBinaryNameSignal(basename, options.app ?? null) ? InstallType.binary : null
    }
    return null
  }

  // --- launch command resolution -------------------------------------------

  /**
   * Picks the executable to launch from a package's payload.
   *
   * `files` is the package's file list as `dpkg -L` prints it, and
   * `desktopExec` maps each `.desktop` path to the raw value of its `Exec=`
   * line. Prefer the GUI entry point the package's own desktop file names, then
   * a single binary, and return null rather than guess between several.
   */
  static chooseLaunchCommand(
    files: readonly string[],
    desktopExec: ReadonlyMap<string, string>
  ): string | null {
    const binaries = files.filter(isBinPath)

    for (const desktop of files.filter((file) => file.endsWith('.desktop'))) {
      const exec = desktopExec.get(desktop)
      if (exec == null || exec.trim().length === 0) continue
      // Exec values carry arguments and field codes, e.g. `fluxdown-desktop %U`.
      const token = exec.trim().split(/\s+/)[0]
      const match = binaries.filter((binary) => path.basename(binary) === token)
      if (match.length === 1) return match[0]
    }

    if (binaries.length === 1) return binaries[0]
    return null
  }

  /**
   * Reads `packageName`'s file list and desktop entries and picks the
   * executable it should be launched with.
   */
  private async resolvePackageLaunchCommand(packageName: string | null): Promise<string | null> {
    if (packageName == null || packageName.length === 0) return null
    try {
      const res = await runProcess('dpkg', ['-L', packageName])
      if (res.exitCode !== 0) return null

      const files = res.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)

      const desktopExec = new Map<string, string>()
      for (const desktop of files.filter((file) => file.endsWith('.desktop'))) {
        const exec = await firstDesktopExecLine(desktop)
        if (exec != null) desktopExec.set(desktop, exec)
      }

      return InstallerService.chooseLaunchCommand(files, desktopExec)
    } catch (error) {
      await this.log(
        'InstallerService',
        `Could not derive a launch command for ${packageName}: ${errorMessage(error)}`
      )
      return null
    }
  }

  // --- privileged execution -------------------------------------------------

  /**
   * Runs one helper verb as root.
   *
   * The argv is always `pkexec <helper> <verb> <args...>`; `pkexec` is never
   * asked to run a shell, `cp`, `rm` or a package manager directly. If the
   * helper is not installed (dev/unpackaged run) this fails with a clear error
   * instead of falling back to a generic root command.
   */
  private async runPrivileged(
    verb: HelperVerb,
    args: readonly string[],
    options?: PrivilegedRunOptions
  ): Promise<void> {
    const helper = this.privilegedHelperPath
    if (!(await this.helperInstalled())) {
      throw new Error(
        `Privileged helper not found at ${helper}. AutoPacX must be installed ` +
          'from its package so the root-owned helper and polkit policy are present; ' +
          'running from a source checkout cannot perform privileged installs.'
      )
    }

    const printable = `pkexec ${helper} ${verb} ${args.join(' ')}`

    // Log the command before it runs, so the in-app log viewer shows what was
    // attempted even if the command then fails.
    await this.log('InstallerService', `Running privileged command: ${printable}`)

    let result: ProcessResult
    try {
      result = await this.privilegedProcessRunner('pkexec', [helper, verb, ...args], options)
    } catch (error) {
      await this.log('InstallerService', `Failed to run privileged command: ${errorMessage(error)}`)
      throw new Error(`Failed to run privileged command: ${errorMessage(error)}`, { cause: error })
    }

    // Checked outside the try so a failing command is not wrapped twice.
    if (result.exitCode !== 0) {
      // apt writes the actionable diagnosis to stdout and only terse "E:" lines
      // to stderr. Surface both, stdout first, so the message reads in the same
      // order the command actually produced it.
      const stdout = result.stdout.trim()
      const stderr = result.stderr.trim()
      const details = [stdout, stderr].filter((part) => part.length > 0).join('\n')
      await this.log(
        'InstallerService',
        `Privileged command failed (exit code ${result.exitCode}): ${printable}`,
        { stdout, stderr }
      )
      throw new Error(
        `Command failed (exit code ${result.exitCode})${details.length > 0 ? `: ${details}` : ''}`
      )
    }

    await this.log('InstallerService', `Privileged command succeeded: ${printable}`)
  }

  /** Removes the downloaded file once it has been installed successfully. */
  private async deleteTempDownload(filePath: string): Promise<void> {
    this.downloadedFiles.delete(path.resolve(filePath))
    try {
      if (await fileExists(filePath)) await fs.rm(filePath, { force: true })
    } catch (error) {
      // Cleanup is best effort: never fail an install that already succeeded.
      await this.log(
        'InstallerService',
        `Could not remove temporary download ${filePath}: ${errorMessage(error)}`
      )
    }
  }
}

/** Streaming SHA-256 of a file, used for the pre-install TOCTOU re-check. */
async function sha256File(filePath: string): Promise<string> {
  const handle = await fs.open(filePath, 'r')
  try {
    const hash = createHash('sha256')
    const buffer = Buffer.alloc(64 * 1024)
    let position = 0
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead))
      position += bytesRead
    }
    return hash.digest('hex')
  } finally {
    await handle.close()
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/**
 * Lists regular files under `root` whose relative path has at most `maxDepth`
 * components, following the same depth rule as Dart's `_locatePayload`.
 * Symlinks are not followed (`followLinks: false` in the original).
 */
async function listFilesWithinDepth(root: string, maxDepth: number): Promise<string[]> {
  const files: string[] = []

  async function walk(dir: string, depth: number): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (depth < maxDepth) await walk(full, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      if (path.relative(root, full).split(path.sep).length > maxDepth) continue
      files.push(full)
    }
  }

  await walk(root, 1)
  return files
}
