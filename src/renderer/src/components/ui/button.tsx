// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { Button as BaseButton } from '@base-ui/react/button'
import type { ComponentPropsWithoutRef, JSX } from 'react'
import { cn } from '@renderer/src/lib/cn'

/**
 * Button variants, expressed with the design tokens from `styles.css`. Every
 * value is a literal utility string so Tailwind can statically find it.
 */
const VARIANT_CLASSES = {
  default: 'border border-border-strong bg-raised text-text hover:bg-hover',
  primary: 'bg-accent-solid text-on-accent hover:opacity-90',
  ghost: 'text-secondary hover:bg-hover hover:text-text',
  danger: 'border border-border-strong bg-transparent text-red hover:bg-red/10'
} as const

const SIZE_CLASSES = {
  default: 'h-8 gap-2 px-3 text-sm',
  small: 'h-7 gap-1.5 px-2 text-xs',
  icon: 'h-8 w-8'
} as const

export type ButtonVariant = keyof typeof VARIANT_CLASSES
export type ButtonSize = keyof typeof SIZE_CLASSES

export type ButtonProps = ComponentPropsWithoutRef<typeof BaseButton> & {
  variant?: ButtonVariant
  size?: ButtonSize
}

/**
 * Themed button built on Base UI's `Button` so it keeps native semantics
 * (keyboard activation, disabled handling) while carrying our tokens.
 */
export function Button({
  variant = 'default',
  size = 'default',
  className,
  type = 'button',
  ...props
}: ButtonProps): JSX.Element {
  return (
    <BaseButton
      type={type}
      className={cn(
        'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-field font-medium transition-colors',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className
      )}
      {...props}
    />
  )
}
