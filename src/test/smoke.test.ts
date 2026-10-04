// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { describe, expect, it } from 'vitest'
import { APP_NAME } from '@core/index'

describe('smoke', () => {
  it('exposes a non-empty application name from core', () => {
    expect(APP_NAME).toBeTruthy()
  })
})
