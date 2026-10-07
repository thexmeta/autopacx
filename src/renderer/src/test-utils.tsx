// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'
import type { ReactNode } from 'react'
import { NotificationsProvider, NotificationViewport } from './components/notifications'
import { IpcEventsProvider } from './hooks/use-ipc-events'

/**
 * A complete stand-in for the preload bridge.
 *
 * Every method the renderer can call is present, so a component test never
 * trips over an undefined bridge member; individual tests override just the
 * calls they assert on.
 */
export function createMockApi(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: '0.1.0',
    getApps: vi.fn().mockResolvedValue([]),
    getDebPackages: vi.fn().mockResolvedValue([]),
    getSettings: vi.fn().mockResolvedValue({ hasGithubToken: false }),
    getVersion: vi.fn().mockResolvedValue('0.1.0'),
    readClipboardText: vi.fn().mockResolvedValue(''),
    hasGithubToken: vi.fn().mockResolvedValue(false),
    setGithubToken: vi.fn().mockResolvedValue(undefined),
    installApp: vi.fn().mockResolvedValue({}),
    installDeb: vi.fn().mockResolvedValue({}),
    uninstallApp: vi.fn().mockResolvedValue(undefined),
    uninstallDebPackage: vi.fn().mockResolvedValue(undefined),
    getInstallTargets: vi.fn().mockResolvedValue({ candidates: [], defaultPath: null }),
    checkAppUpdate: vi.fn().mockResolvedValue({}),
    checkDebUpdate: vi.fn().mockResolvedValue(null),
    checkAllUpdates: vi.fn().mockResolvedValue({
      apps: [],
      debPackages: [],
      pacstallPackages: [],
      failures: []
    }),
    launchApp: vi.fn().mockResolvedValue(undefined),
    launchDeb: vi.fn().mockResolvedValue(undefined),
    openExternal: vi.fn().mockResolvedValue(undefined),
    addApp: vi.fn().mockResolvedValue(1),
    updateApp: vi.fn().mockResolvedValue(undefined),
    deleteApp: vi.fn().mockResolvedValue(undefined),
    addDebPackage: vi.fn().mockResolvedValue(1),
    updateDebPackage: vi.fn().mockResolvedValue(undefined),
    deleteDebPackage: vi.fn().mockResolvedValue(undefined),
    searchGithubRepositories: vi.fn().mockResolvedValue({
      total_count: 0,
      incomplete_results: false,
      items: []
    }),
    getGithubReleaseAssets: vi.fn().mockResolvedValue({ tagName: null, assets: [] }),
    getPacstallStatus: vi.fn().mockResolvedValue({
      installed: false,
      version: null,
      path: null,
      pathUnexpected: false,
      enabled: false
    }),
    getPacstallIndex: vi.fn().mockResolvedValue({ names: [], fetchedAt: '', fromCache: false }),
    getPacstallPackageInfo: vi.fn().mockResolvedValue({
      pkgname: '',
      pkgver: '',
      pkgdesc: '',
      arch: [],
      depends: [],
      optdepends: [],
      makedepends: [],
      maintainer: '',
      url: '',
      license: [],
      source: [],
      sha256sums: []
    }),
    getPacstallPackages: vi.fn().mockResolvedValue([]),
    addPacstallPackage: vi.fn().mockResolvedValue(1),
    installPacstallPackage: vi.fn().mockResolvedValue({}),
    uninstallPacstallPackage: vi.fn().mockResolvedValue(undefined),
    checkPacstallUpdate: vi.fn().mockResolvedValue(null),
    updatePacstallPackage: vi.fn().mockResolvedValue(undefined),
    deletePacstallPackage: vi.fn().mockResolvedValue(undefined),
    launchPacstall: vi.fn().mockResolvedValue(undefined),
    checkPacstallAllUpdates: vi.fn().mockResolvedValue({ packages: [], failures: [] }),
    exportData: vi.fn().mockResolvedValue({ path: '/tmp/autopacx-export.json' }),
    importData: vi.fn().mockResolvedValue({ count: 0 }),
    getDebugLog: vi.fn().mockResolvedValue({ content: '', truncated: false }),
    clearDebugLog: vi.fn().mockResolvedValue(undefined),
    setSettings: vi.fn().mockResolvedValue(undefined),
    batchInstall: vi.fn().mockResolvedValue([]),
    batchDelete: vi.fn().mockResolvedValue({ succeeded: 0, failed: 0 }),
    batchUpdate: vi.fn().mockResolvedValue([]),
    onEvent: vi.fn().mockReturnValue(() => {}),
    ...overrides
  }
}

/** Installs the mock bridge on `window.autopacx` and returns it. */
export function installMockApi(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const api = createMockApi(overrides)
  Object.defineProperty(window, 'autopacx', { configurable: true, value: api })
  return api
}

/** Renders `ui` inside the query, notification and IPC-event providers. */
export function renderWithProviders(
  ui: ReactNode,
  options: { client?: QueryClient } = {}
): RenderResult {
  const client =
    options.client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <NotificationsProvider>
        <IpcEventsProvider>
          {ui}
          <NotificationViewport />
        </IpcEventsProvider>
      </NotificationsProvider>
    </QueryClientProvider>
  )
}
