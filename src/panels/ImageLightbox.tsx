import { useEffect } from 'react'
import type { WorkspaceImage } from '../api/client'

interface ImageLightboxProps {
  image: WorkspaceImage
  canInsert: boolean // ドキュメントを開いているときのみ挿入可能
  onInsert: () => void
  onDelete: () => void
  onClose: () => void
}

// 画像の拡大表示（lm-chat の ImageLightbox 参考）
export default function ImageLightbox({
  image,
  canInsert,
  onInsert,
  onDelete,
  onClose,
}: ImageLightboxProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="lightbox" onClick={(e) => e.stopPropagation()}>
        <img className="lightbox-image" src={image.url} alt={image.rel_path} />
        <div className="lightbox-footer">
          <span className="lightbox-name" title={image.rel_path}>
            {image.rel_path.split('/').pop()}
          </span>
          <div className="lightbox-actions">
            <button
              className="primary"
              disabled={!canInsert}
              title={canInsert ? 'カーソル位置に挿入します' : 'ドキュメントを開いてください'}
              onClick={() => {
                onInsert()
                onClose()
              }}
            >
              カーソル位置に挿入
            </button>
            <button className="danger" onClick={onDelete}>
              削除
            </button>
            <button onClick={onClose}>閉じる</button>
          </div>
        </div>
      </div>
    </div>
  )
}
