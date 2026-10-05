# 監視ユニバース（S&P 500 + Nasdaq-100）

**ファイル:** `data/monitor_index.json` — **S&P 500**（fja05680 構成 CSV の as-of 日在籍）と **Nasdaq-100**（Nasdaq 公開 API）の和集合。

**更新:**

```bash
npx tsx scripts/refresh-monitor-index.ts [YYYY-MM-DD]
```

**利用:** `src/lib/monitor-universe.ts` が和集合を **日足キャッシュ** と **エントリー（箱ライン）アラート走査** に追加。**レンジ表**は開いたとき **すべて**（`?u=all`）がデフォルト。「表示範囲」で **ウォッチリスト / 指数監視のみ / すべて** を切り替え。指数のみ銘柄は `sectorId: index`・一覧では監視のみ表示。yaml の `watchOnly` 銘柄は箱ラインアラート対象外。**reviewLine**・`HOLDINGS_JSON` は変更なし。

2026-10-02 時点の例: SP500 **503** · NDX100 **101** · union **518**（重複除外後）。
