import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Notification,
  shell,
} from 'electron'
import fs from 'node:fs'
import path from 'node:path'

// vite-plugin-electron が dev 時に設定する環境変数
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

let mainWindow: BrowserWindow | null = null

// F12 スクリーンショット: ライブラリフォルダ直下の screenshot/ に保存
async function saveScreenshot(win: BrowserWindow) {
  try {
    const image = await win.webContents.capturePage()
    let dir: string
    try {
      // アクティブなライブラリのパスは backend が知っている
      const res = await fetch('http://127.0.0.1:8000/library')
      const data = (await res.json()) as { active: string }
      dir = path.join(data.active, 'screenshot')
    } catch {
      // backend 未起動時は既定ライブラリ（repo/data）へ
      dir = path.join(__dirname, '..', 'data', 'screenshot')
    }
    fs.mkdirSync(dir, { recursive: true })
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const stamp =
      `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
      `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
    const file = path.join(dir, `screenshot-${stamp}.png`)
    fs.writeFileSync(file, image.toPNG())
    new Notification({
      title: 'スクリーンショットを保存しました',
      body: file,
    }).show()
  } catch (err) {
    new Notification({
      title: 'スクリーンショットに失敗しました',
      body: String(err),
    }).show()
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    useContentSize: true, // コンテンツ領域を 1920x1080 にする（枠込みではなく）
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // F12 でスクリーンショット / Ctrl+Shift+I で DevTools
  // （アプリメニューを消しているため、必要なショートカットはここで処理する）
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown' || !mainWindow) return
    if (input.key === 'F12') {
      void saveScreenshot(mainWindow)
    } else if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow.webContents.toggleDevTools()
    }
  })

  // 右クリックでコピー / 貼り付けなどの編集メニューを出す
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const menu = Menu.buildFromTemplate([
      { role: 'cut', label: '切り取り', enabled: params.editFlags.canCut },
      { role: 'copy', label: 'コピー', enabled: params.editFlags.canCopy },
      { role: 'paste', label: '貼り付け', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      {
        role: 'selectAll',
        label: 'すべて選択',
        enabled: params.editFlags.canSelectAll,
      },
    ])
    menu.popup()
  })

  // 外部リンクは OS 既定のブラウザで開く（アプリ内で開かない）
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // SPA は自発的にページ遷移しないため、ページ発のナビゲーションは全て抑止する
  // （リンククリックは外部ブラウザへ、ドロップされたファイルへの遷移は無視）
  mainWindow.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url)
    }
  })

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
    // DevTools が必要なときは Ctrl+Shift+I で開く（自動起動はしない）
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null) // File / Edit 等の既定メニューは使わない

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

// アプリを閉じたら backend（と追跡中の llama-server）も終了させる
let shuttingDown = false
async function shutdownBackendAndQuit() {
  if (shuttingDown) return
  shuttingDown = true
  try {
    await Promise.race([
      fetch('http://127.0.0.1:8000/shutdown', { method: 'POST' }),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ])
  } catch {
    // backend が既に落ちていれば何もしない
  }
  app.quit()
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // 検証・開発時: LM_KEEP_BACKEND=1 なら別途起動済みの backend/LLM を残したまま自分だけ終了する。
    // 通常利用（未設定）は従来どおり backend と追跡中の llama-server も後片付けする。
    if (process.env.LM_KEEP_BACKEND === '1') {
      app.quit()
    } else {
      void shutdownBackendAndQuit()
    }
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
