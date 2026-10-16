# 監視ユニバース（S&P 500 + Nasdaq-100 + S&P 400 + S&P 600）

**ファイル:** `data/monitor_index.json` — **S&P 500**（fja05680 構成 CSV の as-of 日在籍）と **Nasdaq-100**（Nasdaq 公開 API）の和集合。

**更新:**

```bash
npx tsx scripts/refresh-monitor-index.ts [YYYY-MM-DD]
```

**利用:** `src/lib/monitor-universe.ts` が和集合を **日足キャッシュ** と **エントリー（箱ライン）アラート走査** に追加。**レンジ表**は開いたとき **すべて**（`?u=all`）がデフォルト。「表示範囲」で **ウォッチリスト / 指数監視のみ / すべて** を切り替え。指数のみ銘柄は `sectorId: index`・一覧では監視のみ表示。yaml の `watchOnly` 銘柄は箱ラインアラート対象外。**reviewLine**・`HOLDINGS_JSON` は変更なし。

2026-10-02 時点の例: SP500 **503** · NDX100 **101** · union **518**（重複除外後）。

## 2026-10-17: S&P 400 / S&P 600 追加

- `monitor_index.json` に `sp400`（400）・`sp600`（601）を追加。union **1,519**。名前・セクターは `ticker_meta.json` に補完。
- レンジ表に「指数」フィルタ（URL `ix=sp500|ndx100|sp400|sp600`）。指数のみ行のラベルは所属指数（例: `S&P600`）。
- 性能: 指数のみ銘柄は**応答を待たせない**。ウォッチ/保有/ベンチマークを先に取り、指数のみは120銘柄ずつバックグラウンドで取得（Yahoo 同時5）。コールドスタート直後は指数のみ行が数分「取得中」になる。
- `refresh-monitor-index.ts` は S&P500/NDX100 のみ更新し、sp400/sp600 は既存値を保持する（再取得は手動スナップショット）。
