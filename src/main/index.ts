import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { join } from 'path'
import { config as loadDotenv } from 'dotenv'
import { is } from '@electron-toolkit/utils'
import log from 'electron-log'
import { registerIpcHandlers } from './ipc/handler'

// ── Load .env before anything else ──────────────────────────────────────────
// In dev: .env sits at repo root (CWD).
// In production bundle: place .env next to the executable.
loadDotenv()
log.info('.env loaded')

// ── Logging ──────────────────────────────────────────────────────────────────
log.transports.file.level = 'info'
log.transports.console.level = 'debug'
log.info('App starting...')

// ── Single-instance lock ──────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

// ── Main window ───────────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width:           1100,
    height:          720,
    minWidth:        800,
    minHeight:       560,
    show:            false,
    frame:           false,        // custom title bar
    titleBarStyle:   'hidden',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload:          join(__dirname, '../preload/index.js'),
      sandbox:          false,
      contextIsolation: true,
      nodeIntegration:  false,
    },
    icon: join(__dirname, '../../resources/icon.png'),
  })

  // Register all IPC channels
  registerIpcHandlers(mainWindow)

  // Show after paint to avoid white flash
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    if (is.dev) mainWindow?.webContents.openDevTools({ mode: 'detach' })
  })

  // Open external links in the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Load the app
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

// ── Window controls (custom frameless title bar) ──────────────────────────────
ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize()
})
ipcMain.on('window:close', () => mainWindow?.close())
