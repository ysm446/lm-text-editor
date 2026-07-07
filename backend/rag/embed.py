"""Ruri v3 埋め込み（mem-chat / lm-chat の embedder を流用）。

- 通常は完全オフライン（`local_files_only=True`）でロードし、HF Hub に問い合わせない。
  → 起動時の「unauthenticated requests to the HF Hub」警告も出ない。
- 未インストール（キャッシュ無し）の場合は起動時ウォームアップを黙ってスキップし、
  設定画面からの明示的なインストール（`install_async`）でのみダウンロードする。
- sentence_transformers の import が重いため、関数内で遅延 import する。
"""

from __future__ import annotations

import logging
import threading
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

_MODEL_NAME = "cl-nagoya/ruri-v3-310m"
_CACHE_DIR = Path(__file__).resolve().parent.parent.parent / "models" / "embeddings"
# HF Hub キャッシュのリポジトリディレクトリ（models--<org>--<name>）
_REPO_DIR = _CACHE_DIR / "models--cl-nagoya--ruri-v3-310m"

EMBED_DIM = 768

# Ruri v3 は非対称検索用のプレフィックスを前提に学習されている。
# 検索側とインデックス側で異なるプレフィックスを付けないと本来の検索精度が出ない。
QUERY_PREFIX = "検索クエリ: "
DOCUMENT_PREFIX = "検索文書: "

_model = None
_lock = threading.Lock()
_installing = False
_install_error: str | None = None


def is_installed() -> bool:
    """モデルがローカルキャッシュに存在するか（HF に問い合わせない軽量チェック）。"""
    snapshots = _REPO_DIR / "snapshots"
    if not snapshots.is_dir():
        return False
    for snap in snapshots.iterdir():
        # sentence-transformers のロードに要る設定が揃っていれば導入済みとみなす
        if (snap / "modules.json").exists() or (snap / "config.json").exists():
            return True
    return False


def _load(*, allow_download: bool):
    """SentenceTransformer をロード。allow_download=False なら HF に一切問い合わせない。"""
    from sentence_transformers import SentenceTransformer

    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return SentenceTransformer(
        _MODEL_NAME,
        cache_folder=str(_CACHE_DIR),
        local_files_only=not allow_download,
    )


def _ensure_loaded():
    """ロード済みモデルを返す。未ロードならオフラインでロードする。"""
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                try:
                    _model = _load(allow_download=False)
                except Exception as exc:
                    raise RuntimeError(
                        "埋め込みモデル（Ruri v3）が未インストールです。"
                        "設定 > LLM からインストールしてください。"
                    ) from exc
    return _model


@lru_cache(maxsize=512)
def _embed(text: str) -> tuple[float, ...]:
    model = _ensure_loaded()
    vector = model.encode(text, normalize_embeddings=True, show_progress_bar=False)
    return tuple(vector.tolist())


def embed_query(text: str) -> tuple[float, ...]:
    """検索クエリ側の埋め込み（検索時に使用）。"""
    return _embed(QUERY_PREFIX + text)


def embed_document(text: str) -> tuple[float, ...]:
    """文書側の埋め込み（インデックス時に使用）。"""
    return _embed(DOCUMENT_PREFIX + text)


def warmup() -> None:
    """起動時にモデルをロード（オフライン）。未インストールなら黙ってスキップ。"""
    if not is_installed():
        logger.info("embedding model not installed; skipping warmup")
        return
    try:
        embed_query("warmup")
    except Exception as exc:
        logger.warning("embedding warmup failed: %s", exc)


def _run_install() -> None:
    global _model, _installing, _install_error
    try:
        model = _load(allow_download=True)  # ここで HF からダウンロード
        model.encode("warmup", normalize_embeddings=True, show_progress_bar=False)
        _model = model
        logger.info("embedding model installed: %s", _MODEL_NAME)
    except Exception as exc:  # noqa: BLE001 - 状態に載せてフロントへ返す
        _install_error = str(exc)
        logger.exception("embedding model install failed")
    finally:
        _installing = False


def install_async() -> None:
    """HF からモデルをダウンロードして常駐させる（バックグラウンド実行）。"""
    global _installing, _install_error
    with _lock:
        if _installing or is_installed():
            return
        _installing = True
        _install_error = None
    threading.Thread(target=_run_install, daemon=True).start()


def status() -> dict:
    """設定画面向けの状態。"""
    return {
        "model": _MODEL_NAME,
        "installed": is_installed(),
        "loaded": _model is not None,
        "installing": _installing,
        "error": _install_error,
    }
