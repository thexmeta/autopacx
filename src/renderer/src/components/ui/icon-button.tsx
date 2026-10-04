// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import type { JSX, ReactNode } from 'react'
import { Button, type ButtonProps } from './button'

export type IconButtonProps = Omit<ButtonProps, 'size' | 'children'> & {
  /** Accessible name; also used as the native tooltip. */
  label: string
  children: ReactNode
}

/**
 * A square, icon-only button. `label` is required and becomes both the
 * `aria-label` and the `title`, so an icon-only control is never unlabelled.
 */
export function IconButton({ label, children, ...props }: IconButtonProps): JSX.Element {
  return (
    <Button size="icon" aria-label={label} title={label} {...props}>
      {children}
    </Button>
  )
}
