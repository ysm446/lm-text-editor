import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

// エディタ外へのファイルドロップでページが置き換わるのを防ぐ
// （エディタ内へのドロップは ProseMirror 側の handleDrop が先に処理する）
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

// 前回のテーマをキャッシュから即適用（backend 応答前の白フラッシュ防止）
const cachedTheme = window.localStorage.getItem('lm-editor.theme')
if (cachedTheme) document.documentElement.dataset.theme = cachedTheme

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
