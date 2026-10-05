# 高配当スリーブ利回り順位（2026-10-01）

**定義:** [`ROUND19_V1_DIV_GOLD_SLEEVE_PREREG_ja.md`](ROUND19_V1_DIV_GOLD_SLEEVE_PREREG_ja.md) §3 · 実装は `pickDivSleeve`（非重複・mcap≥$30B のうち **PIT mcap 上位25** → TTM キャッシュ利回り降順 → 上位4）。
**生成:** `scripts/round19-div-sleeve-yield-rank.ts` · **HEAD** `fb76c5f`

## K1

**mcap-11:** NVDA, AAPL, GOOGL, AMZN, AVGO, TSLA, MU, LLY, AMD, WMT, JNJ

**mcap 重複除外（eligible・mcap≥$30B・mcap-11 在籍）:** NVDA, AAPL, GOOGL, AMZN, AVGO, TSLA, MU, LLY, AMD, WMT, JNJ

| # | Ticker | TTM yield | 判定 |
|---:|---|---:|---|
| 1 | CVX | 3.40% | **採用** |
| 2 | HD | 3.29% | **採用** |
| 3 | PM | 3.15% | **採用** |
| 4 | PG | 2.98% | **採用** |
| 5 | ABBV | 2.63% | 落選 |
| 6 | UNH | 2.48% | 落選 |
| 7 | KO | 2.44% | 落選 |
| 8 | MRK | 2.36% | 落選 |
| 9 | CSCO | 1.53% | 落選 |
| 10 | ORCL | 1.45% | 落選 |

## K2

**mcap-11:** NVDA, AAPL, GOOGL, MSFT, AMZN, AVGO, TSLA, MU, LLY, AMD, WMT

**mcap 重複除外（eligible・mcap≥$30B・mcap-11 在籍）:** NVDA, AAPL, GOOGL, MSFT, AMZN, AVGO, TSLA, MU, LLY, AMD, WMT

| # | Ticker | TTM yield | 判定 |
|---:|---|---:|---|
| 1 | CVX | 3.40% | **採用** |
| 2 | HD | 3.29% | **採用** |
| 3 | PM | 3.15% | **採用** |
| 4 | PG | 2.98% | **採用** |
| 5 | ABBV | 2.63% | 落選 |
| 6 | UNH | 2.48% | 落選 |
| 7 | KO | 2.44% | 落選 |
| 8 | MRK | 2.36% | 落選 |
| 9 | JNJ | 2.04% | 落選 |
| 10 | CSCO | 1.53% | 落選 |

**採用 top4:** CVX, HD, PM, PG · **落選 #5–#10:** 上表参照。