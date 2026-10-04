// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useId, type JSX, type ReactNode } from 'react'
import { cn } from '@renderer/src/lib/cn'

export type SwitchProps = {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: ReactNode
  description?: string
  disabled?: boolean
  className?: string
}

/**
 * A toggle built on a native `<button role="switch">`, so it is keyboard
 * operable (Space/Enter) and announces its on/off state.
 *
 * The visible label is wired to the control with `aria-labelledby` (and the
 * optional description with `aria-describedby`) so the switch always has an
 * accessible name. The track/knob use tokens so both themes keep a visible,
 * ≥3:1 knob contrast, and the control is 24×44px to satisfy WCAG 2.5.8.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
  className
}: SwitchProps): JSX.Element {
  const labelId = useId()
  const descriptionId = useId()

  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <span className="flex flex-col text-xs text-text">
        <span id={labelId}>{label}</span>
        {description ? (
          <span id={descriptionId} className="text-2xs text-faint">
            {description}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={description ? descriptionId : undefined}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-pill border transition-colors',
          'disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'border-transparent bg-accent-solid' : 'border-border-strong bg-switch-track'
        )}
      >
        <span
          className={cn(
            'inline-block size-4 rounded-full bg-switch-knob shadow-sm transition-transform',
            checked ? 'translate-x-[22px]' : 'translate-x-1'
          )}
        />
      </button>
    </div>
  )
}
