// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import type { JSX, ReactNode } from 'react'
import { APP_DISPLAY_NAME } from '@core/index'
import { cn } from '@renderer/src/lib/cn'
import { Button } from './ui'

export type View = 'apps' | 'debs' | 'discover' | 'pacstall'

type NavItemProps = {
  active: boolean
  onClick: () => void
  children: ReactNode
}

function NavItem({ active, onClick, children }: NavItemProps): JSX.Element {
  return (
    <Button
      variant="ghost"
      className={cn('w-full justify-start', active && 'bg-selected text-text-strong')}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

export type SidebarProps = {
  view: View
  onSelectView: (view: View) => void
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  onOpenSettings: () => void
  onOpenDebugLog: () => void
  version: string
}

/** Fixed-width navigation rail: section links, theme toggle and app version. */
export function Sidebar({
  view,
  onSelectView,
  theme,
  onToggleTheme,
  onOpenSettings,
  onOpenDebugLog,
  version
}: SidebarProps): JSX.Element {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="px-4 py-4">
        <p className="text-sm font-semibold text-text-strong">{APP_DISPLAY_NAME}</p>
      </div>
      <nav aria-label="Sections" className="flex-1 space-y-1 px-2">
        <NavItem active={view === 'apps'} onClick={() => onSelectView('apps')}>
          Apps
        </NavItem>
        <NavItem active={view === 'debs'} onClick={() => onSelectView('debs')}>
          Deb packages
        </NavItem>
        <NavItem active={view === 'discover'} onClick={() => onSelectView('discover')}>
          Discover
        </NavItem>
        <NavItem active={view === 'pacstall'} onClick={() => onSelectView('pacstall')}>
          pacstall
        </NavItem>
      </nav>
      <div className="space-y-2 border-t border-border px-2 py-3">
        <Button
          variant="ghost"
          size="small"
          className="w-full justify-start"
          onClick={onOpenSettings}
        >
          Settings
        </Button>
        <Button
          variant="ghost"
          size="small"
          className="w-full justify-start"
          onClick={onOpenDebugLog}
        >
          Debug log
        </Button>
        <Button
          variant="ghost"
          size="small"
          className="w-full justify-start"
          onClick={onToggleTheme}
        >
          {theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        </Button>
        <p className="px-2 text-2xs text-faint">v{version}</p>
      </div>
    </aside>
  )
}
