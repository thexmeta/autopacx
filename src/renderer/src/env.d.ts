// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

/// <reference types="vite/client" />

import type { AutonexApi } from '@core/index'

declare global {
  interface Window {
    readonly autonex: AutonexApi
  }
}

export {}
