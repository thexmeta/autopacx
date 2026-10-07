// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

/// <reference types="vite/client" />

import type { AutopacxApi } from '@core/index'

declare global {
  interface Window {
    readonly autopacx: AutopacxApi
  }
}

export {}
