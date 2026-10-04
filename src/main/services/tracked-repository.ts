// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import type { TrackedApp } from '@core/models/tracked-app'
import type { TrackedDebPackage } from '@core/models/tracked-deb-package'
import type { TrackedStoreLike } from './ports'

function maxId(items: readonly { readonly id: number | null }[]): number {
  return items.reduce((max, item) => Math.max(max, item.id ?? 0), 0)
}

/**
 * Persistence layer over the JSON store for tracked apps and deb packages.
 *
 * Every method reads the current list, applies the change and writes it back,
 * so the store never holds a stale snapshot. Id allocation, duplicate-key
 * checks and any other business rule stay out of this class — it only knows
 * how to load and save records.
 */
export class TrackedRepository {
  constructor(private readonly store: TrackedStoreLike) {}

  listApps(): Promise<TrackedApp[]> {
    return this.store.readApps()
  }

  listDebs(): Promise<TrackedDebPackage[]> {
    return this.store.readDebPackages()
  }

  /** Appends `app` with the next free id and returns that id. */
  async appendApp(app: TrackedApp): Promise<number> {
    const apps = await this.store.readApps()
    const id = maxId(apps) + 1
    await this.store.writeApps([...apps, app.copyWith({ id })])
    return id
  }

  /** Replaces the stored app with the same id; throws when it is missing. */
  async updateApp(app: TrackedApp): Promise<void> {
    if (app.id == null) {
      throw new Error('Cannot update an app without an id')
    }
    const apps = await this.store.readApps()
    const index = apps.findIndex((existing) => existing.id === app.id)
    if (index === -1) {
      throw new Error(`App with id ${app.id} not found in database`)
    }
    apps[index] = app
    await this.store.writeApps(apps)
  }

  /** Removes the app with `id` (a no-op when it is not tracked). */
  async deleteApp(id: number): Promise<void> {
    const apps = await this.store.readApps()
    await this.store.writeApps(apps.filter((app) => app.id !== id))
  }

  /** Removes every app whose id is in `ids`; returns how many were removed. */
  async deleteApps(ids: readonly number[]): Promise<number> {
    const apps = await this.store.readApps()
    const remaining = apps.filter((app) => app.id == null || !ids.includes(app.id))
    await this.store.writeApps(remaining)
    return apps.length - remaining.length
  }

  /** Appends `pkg` with the next free id and returns that id. */
  async appendDeb(pkg: TrackedDebPackage): Promise<number> {
    const packages = await this.store.readDebPackages()
    const id = maxId(packages) + 1
    await this.store.writeDebPackages([...packages, pkg.copyWith({ id })])
    return id
  }

  /** Replaces the stored package with the same id; throws when it is missing. */
  async updateDeb(pkg: TrackedDebPackage): Promise<void> {
    if (pkg.id == null) {
      throw new Error('Cannot update a package without an id')
    }
    const packages = await this.store.readDebPackages()
    const index = packages.findIndex((existing) => existing.id === pkg.id)
    if (index === -1) {
      throw new Error(`Package with id ${pkg.id} not found`)
    }
    packages[index] = pkg
    await this.store.writeDebPackages(packages)
  }

  /** Removes the package with `id` (a no-op when it is not tracked). */
  async deleteDeb(id: number): Promise<void> {
    const packages = await this.store.readDebPackages()
    await this.store.writeDebPackages(packages.filter((pkg) => pkg.id !== id))
  }

  /** Removes every package whose id is in `ids`; returns how many were removed. */
  async deleteDebs(ids: readonly number[]): Promise<number> {
    const packages = await this.store.readDebPackages()
    const remaining = packages.filter((pkg) => pkg.id == null || !ids.includes(pkg.id))
    await this.store.writeDebPackages(remaining)
    return packages.length - remaining.length
  }
}
