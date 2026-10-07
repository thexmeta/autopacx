// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { DEFAULT_ARCH_TYPES, InstallType, type MaskedSettings } from '@core/index'

/** The install type a new app starts with (empty means "let AutoPacX decide"). */
export const DEFAULT_ADD_APP_INSTALL_TYPE = ''

/**
 * The architecture types the picker offers when settings do not override them.
 * Ports the Dart dialog's hardcoded `_availableArchitectures` list.
 */
export const DEFAULT_ADD_APP_ARCH_TYPES: readonly string[] = DEFAULT_ARCH_TYPES

/** Trims and drops empty entries from a persisted string list. */
function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

/**
 * The legacy single default architecture from settings, trimmed, or `''` when
 * unset. Kept so existing `default_architecture` values keep seeding the form.
 */
export function defaultArchitecture(settings: MaskedSettings | undefined): string {
  const arch = settings?.default_architecture
  return typeof arch === 'string' ? arch.trim() : ''
}

/**
 * The configured default architecture selection, falling back to the legacy
 * single `default_architecture` key when the list is unset.
 */
export function defaultArchitectures(settings: MaskedSettings | undefined): string[] {
  const selected = cleanList(settings?.default_architectures)
  if (selected.length > 0) return selected
  const legacy = defaultArchitecture(settings)
  return legacy.length > 0 ? [legacy] : []
}

/**
 * The architecture types the picker should offer, falling back to the built-in
 * {@link DEFAULT_ADD_APP_ARCH_TYPES} when settings do not configure them.
 */
export function defaultArchTypes(settings: MaskedSettings | undefined): string[] {
  const configured = cleanList(settings?.default_arch_type)
  return configured.length > 0 ? configured : [...DEFAULT_ADD_APP_ARCH_TYPES]
}

/** The configured default install type, or `''` (unspecified) when unset. */
export function defaultInstallType(settings: MaskedSettings | undefined): string {
  const value = settings?.default_install_type
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : DEFAULT_ADD_APP_INSTALL_TYPE
}

/**
 * Derives the default asset-filter pattern from the install type.
 *
 * A deb install matches `*.deb`; every other format matches the primary
 * architecture (`*<arch>*`), or `*` when no architecture is known.
 */
export function defaultAssetFilterPattern(installType: string, architecture: string): string {
  if (installType === InstallType.deb) return '*.deb'
  const arch = architecture.trim()
  return arch.length > 0 ? `*${arch}*` : '*'
}

/**
 * The configured default asset-filter pattern, falling back to the pattern
 * derived from the install type and primary architecture when unset.
 */
export function configuredAssetFilterPattern(
  settings: MaskedSettings | undefined,
  installType: string,
  architecture: string
): string {
  const pattern = settings?.default_asset_filter_pattern
  if (typeof pattern === 'string' && pattern.trim().length > 0) return pattern.trim()
  return defaultAssetFilterPattern(installType, architecture)
}

/** The seeded values for a fresh add-app form. */
export interface AddAppDefaults {
  readonly architectures: string[]
  readonly installType: string
  /** The architecture types the picker offers (Dart `_availableArchitectures`). */
  readonly archTypes: string[]
  readonly assetFilterPattern: string
}

/**
 * The initial values a new add-app form is seeded with: the configured default
 * architecture selection, install type, the architecture types the picker
 * offers, and an asset filter (configured, or derived from the install type and
 * primary architecture).
 */
export function addAppDefaults(settings: MaskedSettings | undefined): AddAppDefaults {
  const architectures = defaultArchitectures(settings)
  const installType = defaultInstallType(settings)
  const archTypes = defaultArchTypes(settings)
  const primaryArch = architectures[0] ?? defaultArchitecture(settings)
  return {
    architectures,
    installType,
    archTypes,
    assetFilterPattern: configuredAssetFilterPattern(settings, installType, primaryArch)
  }
}
