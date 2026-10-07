// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { join } from 'node:path'
import { app, BrowserWindow, safeStorage } from 'electron'
import { APP_DISPLAY_NAME } from '@core/index'
import { registerIpcHandlers, type IpcRegistrationDeps } from './ipc'
import { applySecurityPolicy } from './security'
import { JsonStore } from './store/json-store'
import { migrateFromFlutter, resolveFlutterAppSupportDir } from './store/migrate'
import { TokenStore } from './token-store'
import { ConfigService } from './services/config-service'
import { DatabaseService } from './services/database-service'
import { configureDebugLogger, type DebugLogSink } from './services/debug-logger'
import { ExternalAppChecker } from './services/external-app-checker'
import { ExternalLinkService } from './services/external-link'
import { GitHubService } from './services/github-service'
import { suggestInstallTargets } from './services/install-location'
import { InstallerService } from './services/installer-service'
import { PacstallRegistry } from './services/pacstall-registry'
import { PacstallService } from './services/pacstall-service'
import { createWebPreferences } from './window-config'

/** Returns a non-empty string setting, or `undefined` for anything else. */
function optionalStringSetting(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function createWindow(deps: IpcRegistrationDeps): void {
  const mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: '#121214',
    autoHideMenuBar: true,
    title: APP_DISPLAY_NAME,
    webPreferences: createWebPreferences(join(__dirname, '../preload/index.js'))
  })

  applySecurityPolicy(mainWindow)
  registerIpcHandlers(mainWindow, deps)

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']

  if (!app.isPackaged && devServerUrl) {
    void mainWindow.loadURL(devServerUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(async () => {
  app.setAppUserModelId('com.autopacx')

  // Import the Flutter app's databases on first run before anything reads them.
  const store = new JsonStore(app.getPath('userData'))

  // One logger for the whole process; every service and the log viewer share
  // it. It is configured before any service can log.
  const debugLogger = configureDebugLogger(store.directory)
  const debugLog: DebugLogSink = (category, message, data) =>
    debugLogger.log(category, message, data)

  const appSupportDir = resolveFlutterAppSupportDir({
    env: process.env,
    homeDir: app.getPath('home')
  })
  try {
    await migrateFromFlutter({ userDataDir: store.directory, appSupportDir })
  } catch (error) {
    console.error('Failed to import Flutter data:', error)
  }

  // Encrypt a legacy plaintext GitHub token before any handler can read it.
  const tokenStore = new TokenStore(store, safeStorage)
  try {
    await tokenStore.migratePlaintext()
  } catch (error) {
    console.error('Failed to migrate the GitHub token:', error)
  }

  // Apply the persisted logging preference before any service logs. The logger
  // defaults to enabled, so only an explicit `false` turns it off.
  try {
    const settings = await store.readSettings()
    debugLogger.setEnabled(settings['enable_debug_logging'] !== false)
  } catch (error) {
    console.error('Failed to apply the debug logging preference:', error)
  }

  // The installer is built first so its asset classifier can be shared with the
  // GitHub service, which tags each release asset with an install type for the
  // renderer's package picker.
  const installer = new InstallerService({ debugLog })

  // The GitHub service reads its token from settings; inject the decrypted
  // token so the plaintext is never persisted.
  const github = new GitHubService({
    debugLog,
    identifyAssetType: (name) => installer.identifyAssetType(name),
    getSettings: async () => {
      const settings: Record<string, unknown> = { ...(await store.readSettings()) }
      const token = await tokenStore.getToken()
      if (token !== null) settings['github_token'] = token
      return settings
    }
  })

  // The pacstall registry caches its index/srclist under the app-data dir and
  // reads the TTL setting; the service runs every privileged lifecycle verb
  // through the same root-owned helper as the deb/binary paths.
  //
  // The registry repo/branch are seeded from the persisted settings at startup
  // and resolved live from the same `getSettings` source on every request, so a
  // mirror change made through `setSettings` takes effect without a restart.
  const appSupportDirectory = async (): Promise<string> => store.directory
  const startupSettings = await store.readSettings()
  const pacstallRegistry = new PacstallRegistry({
    appSupportDirectory,
    getSettings: async () => ({ ...(await store.readSettings()) }),
    registryRepo: optionalStringSetting(startupSettings['pacstall_registry_repo']),
    registryBranch: optionalStringSetting(startupSettings['pacstall_registry_branch']),
    debugLog
  })
  const pacstall = new PacstallService({
    registry: pacstallRegistry,
    appSupportDirectory,
    debugLog
  })

  const deps: IpcRegistrationDeps = {
    store,
    github,
    installer,
    database: new DatabaseService({ debugLog }),
    external: new ExternalAppChecker({ debugLog }),
    externalLink: new ExternalLinkService(),
    token: tokenStore,
    config: new ConfigService(store, app.getVersion()),
    debugLog: debugLogger,
    pacstall,
    pacstallRegistry,
    installLocation: { suggestTargets: (app) => suggestInstallTargets(app) },
    appVersion: app.getVersion()
  }

  createWindow(deps)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(deps)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
