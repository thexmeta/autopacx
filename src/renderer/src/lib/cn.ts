// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Joins conditional class names and resolves conflicting Tailwind utilities so
 * a caller-supplied `className` wins over a component's default variant.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
