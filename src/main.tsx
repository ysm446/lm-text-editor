import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

// エディタ外へのファイルドロップでページが置き換わるのを防ぐ
// （エディタ内へのドロップは ProseMirror 側の handleDrop が先に処理する）
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

// 前回テーマのキャッシュ適用（白フラッシュ防止）は index.html のインラインスクリプトが
// バンドル読み込み前に行う

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
