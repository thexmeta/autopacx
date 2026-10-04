// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { TrackedApp, type TrackedAppInit } from '@core/models/tracked-app'
import type { BatchProgressEvent } from '@core/index'
import { AppList } from './app-list'
import { ProgressBanner } from './progress-banner'
import { installMockApi, renderWithProviders } from '@renderer/src/test-utils'

afterEach(cleanup)

function appWire(overrides: Partial<TrackedAppInit> = {}) {
  return new TrackedApp({
    id: 1,
    repoOwner: 'owner',
    repoName: 'repo',
    displayName: 'App One',
    installedVersion: '1.0.0',
    latestVersion: '1.1.0',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides
  }).toMap()
}

describe('per-item actions', () => {
  it('calls installApp with the app wire map and refetches the list', async () => {
    const wire = appWire({ installedVersion: null, latestVersion: null })
    const getApps = vi.fn().mockResolvedValue([wire])
    const installApp = vi.fn().mockResolvedValue(wire)
    installMockApi({ getApps, installApp })

    renderWithProviders(<AppList />)

    fireEvent.click(await screen.findByRole('button', { name: 'Install App One' }))

    await waitFor(() => expect(installApp).toHaveBeenCalledTimes(1))
    expect(installApp).toHaveBeenCalledWith(wire)
    // The mutation invalidates ['apps'], which refetches the active query.
    await waitFor(() => expect(getApps).toHaveBeenCalledTimes(2))
  })

  it('collects install options for a binary app and forwards them', async () => {
    const wire = appWire({ installedVersion: null, latestVersion: null, installType: 'binary' })
    const installApp = vi.fn().mockResolvedValue(wire)
    installMockApi({ getApps: vi.fn().mockResolvedValue([wire]), installApp })

    renderWithProviders(<AppList />)

    fireEvent.click(await screen.findByRole('button', { name: 'Install App One' }))

    const path = await screen.findByLabelText('Install path')
    fireEvent.change(path, { target: { value: '/usr/local/bin/repo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))

    await waitFor(() =>
      expect(installApp).toHaveBeenCalledWith(wire, {
        targetPath: '/usr/local/bin/repo',
        binaryName: 'repo'
      })
    )
  })

  it('calls checkAppUpdate for the check-updates button', async () => {
    const wire = appWire()
    const checkAppUpdate = vi.fn().mockResolvedValue(wire)
    installMockApi({ getApps: vi.fn().mockResolvedValue([wire]), checkAppUpdate })

    renderWithProviders(<AppList />)

    fireEvent.click(await screen.findByRole('button', { name: 'Check updates for App One' }))

    await waitFor(() => expect(checkAppUpdate).toHaveBeenCalledWith(wire))
  })

  it('disables the action buttons while a request is in flight', async () => {
    const wire = appWire({ installedVersion: null, latestVersion: null })
    let resolveInstall: (value: unknown) => void = () => {}
    const installApp = vi.fn(() => new Promise((resolve) => (resolveInstall = resolve)))
    installMockApi({ getApps: vi.fn().mockResolvedValue([wire]), installApp })

    renderWithProviders(<AppList />)

    const button = await screen.findByRole('button', { name: 'Install App One' })
    fireEvent.click(button)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Install App One' })).toBeDisabled()
    )

    await act(async () => {
      resolveInstall(wire)
    })
  })
})

describe('error notification', () => {
  it('renders a persistent alert when an action rejects', async () => {
    const wire = appWire({ installedVersion: null, latestVersion: null })
    const installApp = vi.fn().mockRejectedValue(new Error('permission denied'))
    installMockApi({ getApps: vi.fn().mockResolvedValue([wire]), installApp })

    renderWithProviders(<AppList />)

    fireEvent.click(await screen.findByRole('button', { name: 'Install App One' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Install failed: permission denied')
  })
})

describe('batch progress', () => {
  it('shows a progress bar driven by the onEvent channel', async () => {
    const listeners: Array<(event: BatchProgressEvent) => void> = []
    const onEvent = vi.fn((listener: (event: BatchProgressEvent) => void) => {
      listeners.push(listener)
      return () => {}
    })
    installMockApi({ onEvent })

    renderWithProviders(<ProgressBanner />)

    act(() => {
      listeners[0]({
        method: 'batchInstall',
        total: 2,
        completed: 1,
        successful: 1,
        failed: 0,
        currentOperation: 'App One'
      })
    })

    const bar = await screen.findByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '1')
    expect(bar).toHaveAttribute('aria-valuemax', '2')
    expect(screen.getByText('App One')).toBeInTheDocument()
  })
})

describe('external links', () => {
  it('opens the repository URL through the validated bridge', async () => {
    const wire = appWire()
    const openExternal = vi.fn().mockResolvedValue(undefined)
    installMockApi({ getApps: vi.fn().mockResolvedValue([wire]), openExternal })

    renderWithProviders(<AppList />)

    fireEvent.click(await screen.findByRole('button', { name: 'App One' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Open on GitHub' }))

    await waitFor(() => expect(openExternal).toHaveBeenCalledWith('https://github.com/owner/repo'))
  })
})

describe('check all updates', () => {
  it('surfaces a partial-failure summary', async () => {
    const wire = appWire()
    const checkAllUpdates = vi.fn().mockResolvedValue({
      apps: [wire],
      debPackages: [],
      failures: [{ name: 'Broken', error: 'offline' }]
    })
    installMockApi({ getApps: vi.fn().mockResolvedValue([wire]), checkAllUpdates })

    renderWithProviders(<AppList />)

    fireEvent.click(await screen.findByRole('button', { name: 'Check all' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('1 of 1 failed')
    expect(alert).toHaveTextContent('Broken: offline')
  })

  it('reports success when every item was checked', async () => {
    const wire = appWire()
    const checkAllUpdates = vi.fn().mockResolvedValue({
      apps: [wire],
      debPackages: [],
      failures: []
    })
    installMockApi({ getApps: vi.fn().mockResolvedValue([wire]), checkAllUpdates })

    renderWithProviders(<AppList />)

    fireEvent.click(await screen.findByRole('button', { name: 'Check all' }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Checked 1 item(s).')
  })
})
