// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { z } from 'zod'

/**
 * Zod contracts for the IPC boundary.
 *
 * `NoArgs` guards the request side of every no-argument channel. Each write
 * channel has a request schema (a tuple of its arguments) and a result schema
 * describing the *wire* shape the main process returns: the snake_case maps
 * produced by `TrackedApp.toMap()` / `TrackedDebPackage.toMap()`, in which
 * every date has already been serialised to an ISO-8601 string. Handlers must
 * never return the model class instances themselves — Electron's structured
 * clone drops prototype getters, so `hasUpdate`, `isInstalled`,
 * `effectiveDisplayName` and `filename` would reach the renderer as
 * `undefined`.
 */

/** Channels that take no arguments; anything else is rejected. */
export const NoArgs = z.tuple([])

const InstallTypeSchema = z.enum(['deb', 'rpm', 'appImage', 'flatpak', 'snap', 'binary', 'source'])

/** An ISO-8601 instant, as emitted by `Date.prototype.toISOString()`. */
const IsoDateTime = z.iso.datetime({ offset: true })

export const TrackedAppSchema = z.object({
  id: z.number().nullable(),
  repo_owner: z.string(),
  repo_name: z.string(),
  display_name: z.string(),
  installed_version: z.string().nullable(),
  latest_version: z.string().nullable(),
  install_type: InstallTypeSchema.nullable(),
  launch_command: z.string().nullable(),
  package_name: z.string().nullable(),
  last_checked: IsoDateTime.nullable(),
  created_at: IsoDateTime,
  latest_release_date: IsoDateTime.nullable(),
  fetched_package: z.string().nullable(),
  asset_filter_pattern: z.string().nullable(),
  tag_prefix: z.string().nullable(),
  architectures: z.array(z.string()),
  include_prerelease: z.boolean()
})

export const TrackedDebPackageSchema = z.object({
  id: z.number().nullable(),
  name: z.string(),
  package_url: z.string(),
  display_name: z.string().nullable(),
  installed_version: z.string().nullable(),
  latest_version: z.string().nullable(),
  file_size: z.string().nullable(),
  file_date: IsoDateTime.nullable(),
  last_checked: IsoDateTime.nullable(),
  created_at: IsoDateTime,
  checksum: z.string().nullable(),
  auto_update: z.boolean(),
  package_name: z.string().nullable(),
  launch_command: z.string().nullable()
})

export const SettingsSchema = z.record(z.string(), z.unknown())

export const VersionSchema = z.string()

// --- Request schemas --------------------------------------------------------

/** Optional raw-binary install destination. */
export const InstallOptionsSchema = z.object({
  targetPath: z.string().nullable().optional(),
  binaryName: z.string().nullable().optional()
})

/** A single tracked-app wire map (install/uninstall/launch/update/check). */
export const AppArgSchema = z.tuple([TrackedAppSchema])

/** A tracked-app wire map plus optional install options. */
export const AppArgWithOptionsSchema = z.tuple([TrackedAppSchema, InstallOptionsSchema.optional()])

/** A single tracked-deb wire map. */
export const DebArgSchema = z.tuple([TrackedDebPackageSchema])

/** A single numeric id. */
export const IdArgSchema = z.tuple([z.number().int()])

/** Two id lists: tracked-app ids and tracked-deb ids. */
export const IdsArgSchema = z.tuple([z.array(z.number().int()), z.array(z.number().int())])

/** A GitHub personal access token. */
export const SetGithubTokenArgsSchema = z.tuple([z.string()])

/** A partial settings map to merge. */
export const SetSettingsArgsSchema = z.tuple([SettingsSchema])

/**
 * A URL that must use HTTPS. Deb packages are downloaded and then installed as
 * root, so a plaintext URL is rejected at the IPC boundary before it can reach
 * the downloader.
 */
const HttpsUrlSchema = z
  .string()
  .min(1)
  .refine(
    (value) => {
      try {
        return new URL(value).protocol === 'https:'
      } catch {
        return false
      }
    },
    { message: 'URL must be a valid https:// URL' }
  )

/**
 * A URL to open in the user's browser. Only HTTPS is accepted here; the
 * allowlisted-host check lives in `services/external-link.ts`, which the
 * handler delegates to before any `shell.openExternal` call.
 */
export const OpenExternalArgsSchema = z.tuple([HttpsUrlSchema])

export const AddAppArgsSchema = z.tuple([
  z.object({
    repoOwner: z.string().min(1),
    repoName: z.string().min(1),
    displayName: z.string().min(1),
    assetFilterPattern: z.string().nullable().optional(),
    tagPrefix: z.string().nullable().optional(),
    architectures: z.array(z.string()).optional(),
    includePrerelease: z.boolean().optional(),
    launchCommand: z.string().nullable().optional(),
    packageName: z.string().nullable().optional(),
    installType: InstallTypeSchema.nullable().optional()
  })
])

export const AddDebPackageArgsSchema = z.tuple([
  z.object({
    name: z.string().min(1),
    packageUrl: HttpsUrlSchema,
    displayName: z.string().nullable().optional(),
    autoUpdate: z.boolean().optional(),
    launchCommand: z.string().nullable().optional(),
    packageName: z.string().nullable().optional()
  })
])

/** Two lists of wire maps: tracked apps and tracked deb packages. */
export const BatchItemsArgsSchema = z.tuple([
  z.array(TrackedAppSchema),
  z.array(TrackedDebPackageSchema)
])

// --- Result schemas ---------------------------------------------------------

/**
 * The masked settings the renderer receives: an arbitrary settings map plus the
 * `hasGithubToken` flag. The plaintext `github_token` and its encrypted form
 * are never part of this shape.
 */
export const MaskedSettingsSchema = z.object({ hasGithubToken: z.boolean() }).catchall(z.unknown())

export const BooleanSchema = z.boolean()

export const VoidSchema = z.void()

export const IdResultSchema = z.number().int()

export const NullableVersionSchema = z.string().nullable()

export const BatchOperationResultSchema = z.object({
  appName: z.string(),
  success: z.boolean(),
  error: z.string().nullable(),
  newVersion: z.string().nullable()
})

export const BatchUpdateFailureSchema = z.object({
  name: z.string(),
  error: z.string()
})

export const BatchUpdateResultSchema = z.object({
  apps: z.array(TrackedAppSchema),
  debPackages: z.array(TrackedDebPackageSchema),
  failures: z.array(BatchUpdateFailureSchema)
})

export const BatchDeleteSummarySchema = z.object({
  succeeded: z.number().int(),
  failed: z.number().int()
})

export const ExportResultSchema = z.object({ path: z.string() })

export const ImportResultSchema = z.object({ count: z.number().int() })

/** The tail of the debug log returned by `getDebugLog`. */
export const DebugLogResultSchema = z.object({
  content: z.string(),
  truncated: z.boolean()
})
