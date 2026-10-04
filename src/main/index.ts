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
import { InstallerService } from './services/installer-service'
import { createWebPreferences } from './window-config'

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
  app.setAppUserModelId('com.autonex')

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

  // The GitHub service reads its token from settings; inject the decrypted
  // token so the plaintext is never persisted.
  const github = new GitHubService({
    debugLog,
    getSettings: async () => {
      const settings: Record<string, unknown> = { ...(await store.readSettings()) }
      const token = await tokenStore.getToken()
      if (token !== null) settings['github_token'] = token
      return settings
    }
  })

  const deps: IpcRegistrationDeps = {
    store,
    github,
    installer: new InstallerService({ debugLog }),
    database: new DatabaseService({ debugLog }),
    external: new ExternalAppChecker({ debugLog }),
    externalLink: new ExternalLinkService(),
    token: tokenStore,
    config: new ConfigService(store, app.getVersion()),
    debugLog: debugLogger,
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
