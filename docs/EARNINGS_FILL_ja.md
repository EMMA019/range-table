# 決算日補完（Nasdaq カレンダー + EDGAR 推定）

## 概要

ウォッチリストに日付が無い銘柄へ、無料ソースのみで次の決算日を補完する。

1. 既存（ウォッチリスト → Yahoo EPS キャッシュ）
2. **Nasdaq 決算カレンダー API**（約60営業日を日別スキャン、ブラウザ風 UA、ディスクキャッシュ）
3. **Nasdaq quote summary**（従来の単銘柄 API）
4. **SEC EDGAR submissions**（8-K 2.02 / 10-Q・10-K の最終提出日 + 約91営業日で次回を**推定**）

推定日は UI・アラート・朝画面・事前チェックで **「推定」** 表示。推定は決算接近警告を **10営業日** まで広げる（確定日は従来どおり5営業日）。日付が一切無い場合は **【要確認】決算日不明** のまま。

## 結果（186銘柄・ONDS除外）

| | 確定 | 推定 | 不明 |
|---|---:|---:|---:|
| **補完前**（ウォッチ + Yahoo のみ） | 10 | 107 | 69 |
| **補完後**（キャッシュ温め後） | 70 | 107 | **9** |

### 依然不明（9）

`AVGO`, `CIEN`, `CRDO`, `FERG`, `HPE`, `MRVL`, `NKE`, `ORCL`, `PL`

### Nasdaq 照合（スポット）

| 銘柄 | 補完結果 |
|---|---|
| AKAM | 2026-11-05（Nasdaq カレンダー・確定扱い） |
| ORCL | カレンダー・EDGAR ともヒットせず（要確認のまま） |
| NKE | 同上 |

## 実装メモ

- `src/lib/nasdaq-earnings-calendar.ts` — カレンダー走査とルックアップ
- `src/lib/edgar-earnings-date.ts` — 提出履歴からの最終決算関連日
- `src/lib/earnings-enrich.ts` — フォールバック順とキャッシュ
- レポート: `npx tsx scripts/earnings-fill-report.ts`
