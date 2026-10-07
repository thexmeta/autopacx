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

/** A tracked pacstall package wire map (`TrackedPacstallPackage.toMap()`). */
export const TrackedPacstallPackageSchema = z.object({
  id: z.number().nullable(),
  name: z.string(),
  display_name: z.string().nullable(),
  description: z.string().nullable(),
  maintainer: z.string().nullable(),
  installed_version: z.string().nullable(),
  latest_version: z.string().nullable(),
  package_name: z.string().nullable(),
  launch_command: z.string().nullable(),
  auto_update: z.boolean(),
  last_checked: IsoDateTime.nullable(),
  created_at: IsoDateTime,
  registry_repo: z.string()
})

export const VersionSchema = z.string()

// --- Request schemas --------------------------------------------------------

/** Optional raw-binary install destination. */
export const InstallOptionsSchema = z.object({
  targetPath: z.string().nullable().optional(),
  binaryName: z.string().nullable().optional(),
  /** Exact release-asset name to install; absent means auto-pick. */
  assetName: z.string().nullable().optional()
})

/** A single tracked-app wire map (install/uninstall/launch/update/check). */
export const AppArgSchema = z.tuple([TrackedAppSchema])

/** A tracked-app wire map plus optional install options. */
export const AppArgWithOptionsSchema = z.tuple([TrackedAppSchema, InstallOptionsSchema.optional()])

/** A single tracked-deb wire map. */
export const DebArgSchema = z.tuple([TrackedDebPackageSchema])

/** A single numeric id. */
export const IdArgSchema = z.tuple([z.number().int()])

/** Three id lists: tracked-app ids, tracked-deb ids and pacstall package ids. */
export const IdsArgSchema = z.tuple([
  z.array(z.number().int()),
  z.array(z.number().int()),
  z.array(z.number().int())
])

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

/** A single tracked pacstall package wire map. */
export const PacstallArgSchema = z.tuple([TrackedPacstallPackageSchema])

/** A pacstall package name, used for registry metadata lookups. */
export const PacstallNameArgSchema = z.tuple([z.object({ name: z.string().min(1) })])

/** A partial pacstall package to track. */
export const AddPacstallPackageArgsSchema = z.tuple([
  z.object({
    name: z.string().min(1),
    displayName: z.string().nullable().optional(),
    autoUpdate: z.boolean().optional(),
    launchCommand: z.string().nullable().optional(),
    packageName: z.string().nullable().optional()
  })
])

/** Optional force flag for a registry index refresh. */
export const GetPacstallIndexArgsSchema = z.tuple([
  z.object({ force: z.boolean().optional() }).optional()
])

/** GitHub repository search parameters. */
export const SearchGithubRepositoriesArgsSchema = z.tuple([
  z.object({
    query: z.string().min(1),
    page: z.number().int().positive().optional(),
    // GitHub rejects `per_page` above 100 with a 422, so clamp rather than
    // reject: a caller asking for more still gets a usable page of results.
    perPage: z
      .number()
      .int()
      .positive()
      .transform((value) => Math.min(value, 100))
      .optional(),
    sort: z.enum(['stars', 'updated', 'best-match']).optional()
  })
])

/** Parameters for the release-asset picker's asset lookup. */
export const GetGithubReleaseAssetsArgsSchema = z.tuple([
  z.object({
    repoOwner: z.string().min(1),
    repoName: z.string().min(1),
    includePrerelease: z.boolean().optional(),
    /** Glob pattern an asset name must match to be listed. */
    assetFilterPattern: z.string().optional(),
    /** Only consider releases whose tag starts with this prefix. */
    tagPrefix: z.string().optional(),
    /** Only consider assets matching one of these architectures. */
    architectures: z.array(z.string()).optional()
  })
])

/** A minimal app/name shape for the install-target picker. */
export const GetInstallTargetsArgsSchema = z.tuple([
  z.object({
    name: z.string().min(1),
    installType: InstallTypeSchema.nullable().optional()
  })
])

/** Three lists of wire maps: tracked apps, tracked deb packages, pacstall packages. */
export const BatchItemsArgsSchema = z.tuple([
  z.array(TrackedAppSchema),
  z.array(TrackedDebPackageSchema),
  z.array(TrackedPacstallPackageSchema)
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

/** The system clipboard's plain-text contents, read by the main process. */
export const ClipboardTextResultSchema = z.string()

// --- GitHub repository search results ---------------------------------------

export const GitHubRepoLicenseSchema = z.object({
  spdx_id: z.string().nullable(),
  name: z.string().nullable()
})

export const GitHubRepoSummarySchema = z.object({
  full_name: z.string(),
  description: z.string().nullable(),
  stargazers_count: z.number().int(),
  language: z.string().nullable(),
  license: GitHubRepoLicenseSchema.nullable(),
  default_branch: z.string(),
  html_url: z.string(),
  updated_at: z.string()
})

export const GitHubRepoSearchResultSchema = z.object({
  total_count: z.number().int(),
  incomplete_results: z.boolean(),
  items: z.array(GitHubRepoSummarySchema)
})

// --- GitHub release-asset selection -----------------------------------------

/** One installable release asset. */
export const GithubAssetOptionSchema = z.object({
  name: z.string(),
  size: z.number(),
  downloadUrl: z.string(),
  installType: InstallTypeSchema
})

/** The latest release's installable assets. */
export const GithubReleaseAssetsResultSchema = z.object({
  tagName: z.string().nullable(),
  assets: z.array(GithubAssetOptionSchema),
  /** ISO-8601 timestamp of the release, or `null` when it is unknown. */
  publishedAt: IsoDateTime.nullable(),
  /** Asset names that survived the requested filters (preview only). */
  matchedNames: z.array(z.string()).optional(),
  /** Total assets on the release, before filtering (preview only). */
  totalAssets: z.number().int().optional()
})

/** One candidate directory a raw-binary install could target. */
export const InstallTargetSuggestionSchema = z.object({
  path: z.string(),
  writable: z.boolean(),
  onPath: z.boolean(),
  ownedByPackage: z.boolean(),
  recommended: z.boolean()
})

/** Result of the install-target picker lookup. */
export const GetInstallTargetsResultSchema = z.object({
  candidates: z.array(InstallTargetSuggestionSchema),
  defaultPath: z.string().nullable()
})

// --- Pacstall results -------------------------------------------------------

/** pacstall installation status plus the user's integration preference. */
export const PacstallStatusSchema = z.object({
  installed: z.boolean(),
  version: z.string().nullable(),
  path: z.string().nullable(),
  pathUnexpected: z.boolean(),
  enabled: z.boolean()
})

/** The registry package-name index with its cache provenance. */
export const PacstallIndexSchema = z.object({
  names: z.array(z.string()),
  fetchedAt: IsoDateTime,
  fromCache: z.boolean()
})

/** A parsed pacstall `.SRCINFO` document. */
export const PacstallPackageInfoSchema = z.object({
  pkgname: z.string(),
  pkgver: z.string(),
  pkgdesc: z.string(),
  arch: z.array(z.string()),
  depends: z.array(z.string()),
  optdepends: z.array(z.string()),
  makedepends: z.array(z.string()),
  maintainer: z.string(),
  url: z.string(),
  license: z.array(z.string()),
  source: z.array(z.string()),
  sha256sums: z.array(z.string())
})

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

/** Refreshed pacstall list after a pacstall-only update sweep. */
export const PacstallBatchUpdateResultSchema = z.object({
  packages: z.array(TrackedPacstallPackageSchema),
  failures: z.array(BatchUpdateFailureSchema)
})

export const BatchUpdateResultSchema = z.object({
  apps: z.array(TrackedAppSchema),
  debPackages: z.array(TrackedDebPackageSchema),
  pacstallPackages: z.array(TrackedPacstallPackageSchema),
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
