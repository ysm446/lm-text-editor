// 内部処理のアクション通知（コピー / 貼り付け / 保存 / 資料・画像追加など）。
// 表示先は下部ステータスバー左端（StatusBar が lm-editor:toast を受けて表示する）。

let seq = 0

export function showToast(message: string) {
  window.dispatchEvent(
    new CustomEvent('lm-editor:toast', { detail: { id: ++seq, message } }),
  )
}
