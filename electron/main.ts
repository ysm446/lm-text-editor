import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  screen,
  shell,
} from 'electron'
import fs from 'node:fs'
import path from 'node:path'

// vite-plugin-electron が dev 時に設定する環境変数
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

let mainWindow: BrowserWindow | null = null

// 画面右下に出すアクション通知（スクリーンショット保存など）。
// OS のトースト（Notification）ではなく自前のフレームレスウィンドウにしている:
//   - Windows の通知設定に左右されず必ず出る / クリック時の挙動を自分で決められる
//   - 本体ウィンドウとは別ウィンドウなので capturePage（F12）に写り込まない
const TOAST_WIDTH = 380
const TOAST_HEIGHT = 92
const TOAST_MARGIN = 16
const TOAST_DURATION = 6000

let toastWindow: BrowserWindow | null = null
let toastTimer: ReturnType<typeof setTimeout> | null = null
// クリック時に「場所を開く」対象（なければ通知はクリック不可）
let toastRevealTarget: string | null = null

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c] as string,
  )
}

// 色・寸法は src/styles.css の上下バー用トークン（--bar-*）に合わせた固定値。
// 別ウィンドウなのでアプリの CSS 変数は参照できず、トーストはテーマ非依存ダーク。
function toastHtml(opts: {
  title: string
  body: string
  clickable: boolean
  tone: 'ok' | 'danger'
}): string {
  const mark = opts.tone === 'ok' ? '✓' : '!'
  const markColor = opts.tone === 'ok' ? '#44cf6e' : '#fb7a7e'
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0; height: 100%; overflow: hidden;
    background: transparent; user-select: none;
    font-family: "Segoe UI", "Yu Gothic UI", system-ui, sans-serif;
  }
  .toast {
    position: relative; display: flex; gap: 10px; align-items: flex-start;
    height: 100%; padding: 12px 14px;
    background: #262626; color: #dadada;
    border: 1px solid #333333; border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    opacity: 0; transform: translateY(10px);
    transition: opacity 0.28s ease, transform 0.28s ease, background 0.12s ease;
  }
  .toast.shown { opacity: 1; transform: none; }
  .toast.clickable { cursor: pointer; }
  .toast.clickable:hover { background: #363636; }
  .mark { flex: none; color: ${markColor}; font-size: 14px; line-height: 18px; }
  .text { min-width: 0; flex: 1; }
  .title { font-size: 13px; font-weight: 600; line-height: 18px; }
  .body {
    margin-top: 2px; font-size: 12px; line-height: 16px; color: #999999;
    word-break: break-all; display: -webkit-box; -webkit-box-orient: vertical;
    -webkit-line-clamp: 2; overflow: hidden;
  }
  .hint { margin-top: 3px; font-size: 11px; line-height: 14px; color: #666666; }
  .close {
    position: absolute; top: 4px; right: 6px;
    width: 20px; height: 20px; padding: 0;
    display: flex; align-items: center; justify-content: center;
    border: none; border-radius: 4px; background: transparent;
    color: #666666; font-size: 13px; line-height: 1; cursor: pointer;
  }
  .close:hover { background: #363636; color: #dadada; }
</style>
</head>
<body>
  <div class="toast${opts.clickable ? ' clickable' : ''}" id="toast">
    <div class="mark">${mark}</div>
    <div class="text">
      <div class="title">${escapeHtml(opts.title)}</div>
      <div class="body">${escapeHtml(opts.body)}</div>
      ${opts.clickable ? '<div class="hint">クリックで保存先フォルダを開く</div>' : ''}
    </div>
    <button class="close" id="close" title="閉じる">✕</button>
  </div>
<script>
  const toast = document.getElementById('toast')
  requestAnimationFrame(() => toast.classList.add('shown'))
  ${
    opts.clickable
      ? "toast.addEventListener('click', () => window.lmEditor?.toast.reveal())"
      : ''
  }
  document.getElementById('close').addEventListener('click', (event) => {
    event.stopPropagation()
    window.lmEditor?.toast.dismiss()
  })
</script>
</body>
</html>
`
}

function hideToast() {
  if (toastTimer) {
    clearTimeout(toastTimer)
    toastTimer = null
  }
  toastRevealTarget = null
  if (toastWindow && !toastWindow.isDestroyed()) toastWindow.destroy()
  toastWindow = null
}

function showToast(opts: {
  title: string
  body: string
  revealPath?: string
  tone?: 'ok' | 'danger'
}) {
  hideToast() // 連続で出たときは最新の 1 枚だけを見せる
  const clickable = Boolean(opts.revealPath)
  toastRevealTarget = opts.revealPath ?? null

  // 本体ウィンドウがあるディスプレイの作業領域（タスクバーを除く）右下に置く
  const display =
    mainWindow && !mainWindow.isDestroyed()
      ? screen.getDisplayMatching(mainWindow.getBounds())
      : screen.getPrimaryDisplay()
  const area = display.workArea

  // 内容は毎回書き出す（preload を効かせるため data: URL ではなくファイルから読む）
  const htmlFile = path.join(app.getPath('temp'), 'lm-editor-toast.html')
  fs.writeFileSync(
    htmlFile,
    toastHtml({
      title: opts.title,
      body: opts.body,
      clickable,
      tone: opts.tone ?? 'ok',
    }),
    'utf-8',
  )

  const win = new BrowserWindow({
    x: area.x + area.width - TOAST_WIDTH - TOAST_MARGIN,
    y: area.y + area.height - TOAST_HEIGHT - TOAST_MARGIN,
    width: TOAST_WIDTH,
    height: TOAST_HEIGHT,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  toastWindow = win
  win.on('closed', () => {
    if (toastWindow === win) toastWindow = null
  })
  void win.loadFile(htmlFile)
  // 執筆中のフォーカスを奪わない（showInactive）
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.showInactive()
  })
  toastTimer = setTimeout(hideToast, TOAST_DURATION)
}

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
    showToast({
      title: 'スクリーンショットを保存しました',
      body: path.basename(file),
      revealPath: file,
    })
  } catch (err) {
    showToast({
      title: 'スクリーンショットに失敗しました',
      body: String(err),
      tone: 'danger',
    })
  }
}

// 起動直後の素ウィンドウがテーマと乖離しないよう、backend の設定ファイルから
// テーマを読んで背景色を決める（読めなければ既定の dark）。
// 値は src/styles.css の --bg と揃える
function initialBackgroundColor(): string {
  try {
    const raw = fs.readFileSync(
      path.join(__dirname, '..', 'data', 'settings.json'),
      'utf-8',
    )
    const settings = JSON.parse(raw) as { theme?: string }
    if (settings.theme === 'light') return '#f2f3f5'
  } catch {
    // 設定ファイル未作成なら backend 既定（dark）に合わせる
  }
  return '#191919'
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    useContentSize: true, // コンテンツ領域を 1920x1080 にする（枠込みではなく）
    show: false, // 最初の描画が済むまで隠す（起動時の白画面防止）
    backgroundColor: initialBackgroundColor(),
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

  // 最初の描画（index.html のテーマ背景）が済んでから表示する。
  // dev で Vite の初回変換が長引いても隠れたままにならないよう保険を掛ける
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show()
    }
  }, 3000)

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
    // DevTools が必要なときは Ctrl+Shift+I で開く（自動起動はしない）
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
    // 通知ウィンドウが残ると window-all-closed が来ず終了できないので一緒に閉じる
    hideToast()
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

  // 右下の通知をクリック: 保存先フォルダをエクスプローラで開き、通知を閉じる
  ipcMain.handle('lm-editor:toast-reveal', () => {
    const target = toastRevealTarget
    hideToast()
    if (target) shell.showItemInFolder(target)
  })

  ipcMain.handle('lm-editor:toast-dismiss', () => {
    hideToast()
  })

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
