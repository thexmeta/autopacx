// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { DEBUG_LOG_FILE_NAME, DebugLogger, formatLogData, localTimestamp } from './debug-logger'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(tmpdir(), 'autonex-log-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

async function readLog(target: string): Promise<string> {
  return fs.readFile(path.join(target, DEBUG_LOG_FILE_NAME), 'utf8')
}

describe('format helpers', () => {
  it('formats a local timestamp with no zone suffix', () => {
    const stamp = localTimestamp(new Date(2026, 0, 2, 3, 4, 5))
    expect(stamp).toBe('2026-01-02 03:04:05')
    expect(stamp).not.toContain('Z')
    expect(stamp).not.toContain('T')
  })

  it('formats data as k=v pairs joined by commas', () => {
    expect(formatLogData({ a: '1', b: 2 })).toBe('a=1, b=2')
  })
})

describe('DebugLogger', () => {
  it('writes a Dart-format log line', async () => {
    const logger = new DebugLogger(dir)
    await logger.log('Category', 'hello')

    const contents = await readLog(dir)
    expect(contents).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[Category\] hello\n$/)
  })

  it('appends the Data section when data is supplied', async () => {
    const logger = new DebugLogger(dir)
    await logger.log('Cat', 'msg', { key: 'value', n: 3 })

    const contents = await readLog(dir)
    expect(contents).toContain('[Cat] msg | Data: key=value, n=3')
  })

  it('writes nothing while disabled and drops the buffer when disabled', async () => {
    const logger = new DebugLogger(dir)
    logger.setEnabled(false)
    await logger.log('Cat', 'should not appear')

    expect(logger.isEnabled()).toBe(false)
    await expect(readLog(dir)).rejects.toThrow()
  })

  it('resumes logging when re-enabled', async () => {
    const logger = new DebugLogger(dir)
    logger.setEnabled(false)
    await logger.log('Cat', 'dropped')
    logger.setEnabled(true)
    await logger.log('Cat', 'kept')

    const contents = await readLog(dir)
    expect(contents).not.toContain('dropped')
    expect(contents).toContain('kept')
  })

  it('reports the log file path and clears the file', async () => {
    const logger = new DebugLogger(dir)
    await logger.log('Cat', 'one')
    const filePath = await logger.getLogFilePath()
    expect(filePath).toBe(path.join(dir, DEBUG_LOG_FILE_NAME))

    await logger.clear()
    expect(await readLog(dir)).toBe('')
  })

  it('rotates the log once it would exceed the cap, keeping the newest lines', async () => {
    const logger = new DebugLogger(dir, { maxLogBytes: 400 })
    for (let index = 0; index < 40; index++) {
      await logger.log('Cat', `line-${index.toString().padStart(3, '0')}`)
    }

    const contents = await readLog(dir)
    const size = Buffer.byteLength(contents, 'utf8')
    expect(size).toBeLessThanOrEqual(400)
    expect(contents).toContain('line-039')
    expect(contents).not.toContain('line-000')
  })

  it('readTail returns the whole file when it fits', async () => {
    const logger = new DebugLogger(dir)
    await logger.log('Cat', 'small')

    const result = await logger.readTail(1024)
    expect(result.truncated).toBe(false)
    expect(result.content).toContain('small')
  })

  it('readTail truncates and drops a partial first line', async () => {
    const logger = new DebugLogger(dir)
    for (let index = 0; index < 20; index++) {
      await logger.log('Cat', `entry-${index.toString().padStart(2, '0')}-padding-padding`)
    }

    const result = await logger.readTail(80)
    expect(result.truncated).toBe(true)
    // The tail must begin on a line boundary, never mid-line.
    expect(result.content.startsWith('[')).toBe(true)
    expect(result.content).toContain('entry-19')
  })
})
