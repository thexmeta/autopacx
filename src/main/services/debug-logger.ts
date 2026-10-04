// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { promises as fs } from 'node:fs'
import * as path from 'node:path'

/**
 * Debug logger, ported from `lib/services/debug_logger.dart`.
 *
 * Writes timestamped lines to `autonex_debug.log` inside the app-data
 * directory, rotating the file once it would grow past 1 MB. Logging is
 * enabled by default and toggled from the persisted `enable_debug_logging`
 * setting by the composition root (and by the `setSettings` handler).
 *
 * The logger must never log its own failures — that would recurse — so every
 * internal error is written straight to `process.stderr`.
 *
 * The log line format matches the Dart original exactly:
 * `[YYYY-MM-DD HH:MM:SS] [Category] Message | Data: k=v, k2=v2`, where the
 * timestamp is LOCAL time with no `Z`/offset (Dart's
 * `DateTime.now().toString().substring(0, 19)`).
 */

export const DEBUG_LOG_FILE_NAME = 'autonex_debug.log'

/** Maximum on-disk log size before it is truncated to its newest half. */
export const DEFAULT_MAX_LOG_BYTES = 1024 * 1024 // 1 MB

/** How much of the log the viewer reads by default. */
export const DEFAULT_READ_TAIL_BYTES = 200 * 1024 // 200 KB

export interface DebugLogData {
  readonly [key: string]: unknown
}

export interface DebugLogReadResult {
  readonly content: string
  readonly truncated: boolean
}

/** A debug sink: the injectable seam every service logs through. */
export type DebugLogSink = (
  category: string,
  message: string,
  data?: DebugLogData
) => void | Promise<void>

export interface DebugLoggerOptions {
  /** Overrides the 1 MB rotation cap; used by tests to force rotation. */
  readonly maxLogBytes?: number
}

/** `YYYY-MM-DD HH:MM:SS` in LOCAL time, matching Dart's substring(0, 19). */
export function localTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

/** `k=v, k2=v2`, matching Dart's `data.entries.map(...).join(', ')`. */
export function formatLogData(data: DebugLogData): string {
  return Object.entries(data)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(', ')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class DebugLogger {
  private readonly directory: string
  private readonly maxLogBytes: number
  private filePath: string | null = null
  private initialized = false
  private enabled = true
  private buffer: string[] = []
  private initializing: Promise<void> | null = null

  constructor(directory: string, options: DebugLoggerOptions = {}) {
    this.directory = directory
    this.maxLogBytes = options.maxLogBytes ?? DEFAULT_MAX_LOG_BYTES
  }

  /** Whether logging is currently enabled. */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Turns debug logging on/off. Called by the composition root and the
   * `setSettings` handler; the logger never reads settings back (that would
   * recurse into logging). Disabling drops anything buffered so a disabled
   * logger leaves no trace.
   */
  setEnabled(value: boolean): void {
    this.enabled = value
    if (!value) {
      this.buffer = []
    }
  }

  /** Appends a single log line, flushing immediately for critical debugging. */
  async log(category: string, message: string, data?: DebugLogData): Promise<void> {
    if (!this.enabled) return
    await this.init()

    let line = `[${localTimestamp(new Date())}] [${category}] ${message}`
    if (data != null && Object.keys(data).length > 0) {
      line += ` | Data: ${formatLogData(data)}`
    }

    this.buffer.push(line)
    if (this.filePath !== null && this.initialized) {
      await this.flush()
    }
  }

  /** Empties the log file. */
  async clear(): Promise<void> {
    await this.init()
    if (this.filePath === null) return
    try {
      await fs.writeFile(this.filePath, '')
    } catch (error) {
      process.stderr.write(`[DebugLogger] Failed to clear log: ${errorMessage(error)}\n`)
    }
  }

  /** Absolute path of the log file, or null when it could not be created. */
  async getLogFilePath(): Promise<string | null> {
    await this.init()
    return this.filePath
  }

  /**
   * Reads the most recent `maxBytes` of the log, dropping a possibly-partial
   * first line left by cutting mid-file. Mirrors the Dart viewer's tail read.
   */
  async readTail(maxBytes: number = DEFAULT_READ_TAIL_BYTES): Promise<DebugLogReadResult> {
    await this.init()
    if (this.filePath === null) {
      return { content: 'Log file not available', truncated: false }
    }
    try {
      const buffer = await fs.readFile(this.filePath)
      if (buffer.length <= maxBytes) {
        return { content: buffer.toString('utf8'), truncated: false }
      }
      let text = buffer.subarray(buffer.length - maxBytes).toString('utf8')
      const firstNewline = text.indexOf('\n')
      if (firstNewline >= 0) text = text.slice(firstNewline + 1)
      return { content: text, truncated: true }
    } catch (error) {
      return { content: `Error reading log: ${errorMessage(error)}`, truncated: false }
    }
  }

  private async init(): Promise<void> {
    if (this.initialized) return
    if (this.initializing === null) {
      this.initializing = this.doInit()
    }
    try {
      await this.initializing
    } finally {
      this.initializing = null
    }
  }

  private async doInit(): Promise<void> {
    try {
      await fs.mkdir(this.directory, { recursive: true })
      this.filePath = path.join(this.directory, DEBUG_LOG_FILE_NAME)
      this.initialized = true
      await this.flush()
    } catch (error) {
      // The logger cannot log its own failures (that would recurse).
      process.stderr.write(`[DebugLogger] Failed to initialize: ${errorMessage(error)}\n`)
    }
  }

  private async flush(): Promise<void> {
    if (this.filePath === null || this.buffer.length === 0) return
    const content = `${this.buffer.join('\n')}\n`
    try {
      await this.rotateIfNeeded(Buffer.byteLength(content, 'utf8'))
      await fs.appendFile(this.filePath, content)
      this.buffer = []
    } catch (error) {
      process.stderr.write(`[DebugLogger] Failed to write log: ${errorMessage(error)}\n`)
    }
  }

  /**
   * Truncates the log to its most recent half once appending `incomingBytes`
   * would push it past the cap, so the file cannot grow without bound. The
   * slice is byte-bounded so a multi-byte log cannot retain more than budget.
   */
  private async rotateIfNeeded(incomingBytes: number): Promise<void> {
    const filePath = this.filePath
    if (filePath === null) return
    let size: number
    try {
      size = (await fs.stat(filePath)).size
    } catch {
      return
    }
    if (size + incomingBytes <= this.maxLogBytes) return

    const keepBytes = Math.floor(this.maxLogBytes / 2)
    const encoded = await fs.readFile(filePath)
    let tail =
      encoded.length <= keepBytes
        ? encoded.toString('utf8')
        : encoded.subarray(encoded.length - keepBytes).toString('utf8')
    // Drop a possibly-partial first line left by cutting mid-file.
    const firstNewline = tail.indexOf('\n')
    if (firstNewline >= 0) {
      tail = tail.slice(firstNewline + 1)
    }
    await fs.writeFile(filePath, tail)
  }
}

// --- Singleton lifecycle ----------------------------------------------------

let sharedLogger: DebugLogger | null = null

/**
 * Creates and installs the process-wide logger. Called once from the Electron
 * main process so every service and the log viewer share one instance.
 */
export function configureDebugLogger(
  directory: string,
  options: DebugLoggerOptions = {}
): DebugLogger {
  sharedLogger = new DebugLogger(directory, options)
  return sharedLogger
}

/** The process-wide logger, or null before {@link configureDebugLogger} runs. */
export function getDebugLogger(): DebugLogger | null {
  return sharedLogger
}
