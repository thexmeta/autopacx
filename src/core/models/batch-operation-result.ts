// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

/** Result of a single batch operation item. */
export interface BatchOperationResultInit {
  appName: string
  success: boolean
  error?: string | null
  newVersion?: string | null
}

export class BatchOperationResult {
  readonly appName: string
  readonly success: boolean
  readonly error: string | null
  readonly newVersion: string | null

  constructor(init: BatchOperationResultInit) {
    this.appName = init.appName
    this.success = init.success
    this.error = init.error ?? null
    this.newVersion = init.newVersion ?? null
  }
}

export interface BatchProgressInit {
  total: number
  completed?: number
  successful?: number
  failed?: number
  currentOperation?: string
  startTime: Date
}

/** Progress tracker for batch operations. */
export class BatchProgress {
  readonly total: number
  completed: number
  successful: number
  failed: number
  currentOperation: string
  readonly startTime: Date

  constructor(init: BatchProgressInit) {
    this.total = init.total
    this.completed = init.completed ?? 0
    this.successful = init.successful ?? 0
    this.failed = init.failed ?? 0
    this.currentOperation = init.currentOperation ?? ''
    this.startTime = init.startTime
  }

  get progressPercentage(): number {
    return this.total > 0 ? (this.completed / this.total) * 100 : 0
  }

  /** Elapsed time since [startTime] in milliseconds (Dart returns a `Duration`). */
  get elapsed(): number {
    return Date.now() - this.startTime.getTime()
  }
}
