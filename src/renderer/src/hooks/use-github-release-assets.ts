// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { GetGithubReleaseAssetsInput, GithubReleaseAssetsWire } from '@core/index'

/** The react-query key for one repository's release assets. */
export function githubReleaseAssetsQueryKey(
  input: GetGithubReleaseAssetsInput
): readonly unknown[] {
  return ['githubReleaseAssets', input.repoOwner, input.repoName, input.includePrerelease === true]
}

/**
 * Loads the latest release's installable assets for the package picker. The
 * main process has already classified each asset's install type, so the dialog
 * only has to group and present them.
 */
export function useGithubReleaseAssets(
  input: GetGithubReleaseAssetsInput
): UseQueryResult<GithubReleaseAssetsWire, Error> {
  return useQuery({
    queryKey: githubReleaseAssetsQueryKey(input),
    queryFn: () => window.autopacx.getGithubReleaseAssets(input)
  })
}
