"""LLM サーバの接続設定（spec.md §7: dual-port ルーティング）。"""

GEMMA_BASE_URL = "http://127.0.0.1:8080/v1"   # 執筆 / 校正 / 画像理解
ORNITH_BASE_URL = "http://127.0.0.1:8081/v1"  # 検索クエリ分解 / 要約（フェーズ 4）
