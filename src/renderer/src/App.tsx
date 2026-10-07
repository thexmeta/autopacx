// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { lazy, Suspense, useState, type JSX } from 'react'
import { AppList } from './components/app-list'
import { DebPackageList } from './components/deb-package-list'
import { DiscoverView } from './components/discover-view'
import { PacstallPackageList } from './components/pacstall-package-list'
import { DialogFallback } from './components/lazy-dialog'
import { IpcEventsProvider } from './hooks/use-ipc-events'
import { NotificationViewport, NotificationsProvider } from './components/notifications'
import { ProgressBanner } from './components/progress-banner'
import { Sidebar, type View } from './components/sidebar'
import { useTheme } from './hooks/use-theme'

// Shell-level overlays are split into their own chunks and fetched when opened.
const SettingsSheet = lazy(() =>
  import('./components/settings-sheet').then((module) => ({ default: module.SettingsSheet }))
)
const DebugLogDialog = lazy(() =>
  import('./components/debug-log-dialog').then((module) => ({ default: module.DebugLogDialog }))
)

const VIEW_COPY: Record<View, { title: string; description: string }> = {
  apps: {
    title: 'Tracked apps',
    description: 'GitHub repositories watched for new releases.'
  },
  debs: {
    title: 'Deb packages',
    description: 'Direct .deb downloads watched for new versions.'
  },
  discover: {
    title: 'Discover',
    description: 'Search GitHub repositories or browse pacstall packages.'
  },
  pacstall: {
    title: 'pacstall packages',
    description: 'pacstall packages tracked through the registry.'
  }
}

/** Application shell: a fixed sidebar beside the active list. */
export function App(): JSX.Element {
  const [view, setView] = useState<View>('apps')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [debugLogOpen, setDebugLogOpen] = useState(false)
  const { theme, toggleTheme } = useTheme()
  const copy = VIEW_COPY[view]

  return (
    <NotificationsProvider>
      <IpcEventsProvider>
        <div className="flex h-screen overflow-hidden bg-bg text-text">
          <Sidebar
            view={view}
            onSelectView={setView}
            theme={theme}
            onToggleTheme={toggleTheme}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenDebugLog={() => setDebugLogOpen(true)}
            version={window.autonex.version}
          />
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <header className="border-b border-border px-6 py-4">
              <h1 className="text-lg font-semibold text-text-strong">{copy.title}</h1>
              <p className="mt-0.5 text-xs text-muted">{copy.description}</p>
            </header>
            <ProgressBanner />
            <div className="min-h-0 flex-1 overflow-hidden px-6 py-4">
              {view === 'apps' ? (
                <AppList />
              ) : view === 'debs' ? (
                <DebPackageList />
              ) : view === 'discover' ? (
                <DiscoverView onOpenSettings={() => setSettingsOpen(true)} />
              ) : (
                <PacstallPackageList />
              )}
            </div>
          </main>
        </div>
        {settingsOpen ? (
          <Suspense fallback={<DialogFallback />}>
            <SettingsSheet open onClose={() => setSettingsOpen(false)} />
          </Suspense>
        ) : null}
        {debugLogOpen ? (
          <Suspense fallback={<DialogFallback />}>
            <DebugLogDialog open onClose={() => setDebugLogOpen(false)} />
          </Suspense>
        ) : null}
        <NotificationViewport />
      </IpcEventsProvider>
    </NotificationsProvider>
  )
}
