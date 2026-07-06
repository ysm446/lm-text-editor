import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'node:path'

// vite-plugin-electron が dev 時に設定する環境変数
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  ipcMain.handle(
    'lm-editor:choose-library-folder',
    async (_event, mode?: 'open' | 'create') => {
      const focused = BrowserWindow.getFocusedWindow()
      const options = {
        title: mode === 'create' ? '新しいライブラリの場所を選択' : 'ライブラリを開く',
        buttonLabel: mode === 'create' ? 'ここに作成' : '開く',
        properties: ['openDirectory', 'createDirectory'] as Array<
          'openDirectory' | 'createDirectory'
        >,
        defaultPath: app.getPath('documents'),
      }
      const result = focused
        ? await dialog.showOpenDialog(focused, options)
        : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
  )

  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
