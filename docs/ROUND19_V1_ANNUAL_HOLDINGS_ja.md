# Round 19 v1 年次保有推移（plain_15__mcap・修正後）
**状態:** 採用設定 `plain_15__mcap` の **年次スナップショット**（各暦年の **最後の四半期リバランス日** = `rebalanceDates` 上、その年の最終セッション）。ウェイトは `targetWeights` 適用後（半導体 30% キャップ込み）。
**生成:** `scripts/round19-v1-annual-holdings.ts`
**ブランチ HEAD:** `964387a`
**サイト非掲載。** v2 探索なし。
## スナップショットの取り方
- 対象期間 2016-01-01 ～ 2026-10-02。各年 **Y** について、四半期初 SPY セッションのうち **Y 年内で最も遅い日**を採用（2026 年は **2026-10-01**）。
- シミュレーションの差分リバランスと同じ PIT 時価・eligible・`pickHoldings` 順位。
## AI ティルト率の定義
| 指標 | 定義 |
|---|---|
| **半導体 %** | GICS Sub-Industry に `semiconductor` を含む銘柄（`isSemiSubIndustry`）のウェイト合計。30% 超過時は `applySemiCap` で半導体を縮小し非半導体へ按分。 |
| **AI ティルト %** | 上記 **半導体** ∪ **AI プラットフォーム／インフラ** ティッカーのウェイト合計（重複は一度だけ）。AI 明示リスト: AAPL, ADBE, AMZN, ANET, CDNS, CRM, CRWD, DDOG, DELL, FB, FTNT, GOOGL, IBM, INTU, MDB, META, MSFT, NFLX, NOW, ORCL, PANW, PLTR, SNPS, TEAM, WDAY, ZS。 |
Emma 観点: 半導体キャップ 30% でも、ハイパースケーラ＋半導体の合算でポートが AI 集中に見えるかを **AI ティルト %** で量化する。
## 年次サマリー
| 年 | リバランス日 | 半導体 % | AI ティルト % | 入替 | 退出 |
|---|---|---:|---:|---|---|
| 2016 | 2016-10-03 | 3.7% | 61.4% | AAPL, GOOGL, AMZN, MSFT, FB, JNJ, GE, WMT, PG, INTC, CERN, KO, PFE, MRK, CVX | — |
| 2017 | 2017-10-02 | 3.3% | 64.6% | UNH, HD, BA | KO, PFE, MRK |
| 2018 | 2018-10-01 | 5.7% | 72.3% | PFE, CSCO, NVDA | GE, PG, CVX |
| 2019 | 2019-10-01 | 3.1% | 68.1% | PG, DIS, KO, MRK | PFE, CSCO, CERN, NVDA |
| 2020 | 2020-10-01 | 5.5% | 84.1% | NVDA, ADBE, NFLX, CRM | BA, DIS, KO, MRK |
| 2021 | 2021-10-01 | 4.1% | 75.5% | TSLA, ISRG, DIS | NFLX, CRM, INTC |
| 2022 | 2022-10-03 | 3.0% | 68.8% | META, LLY, CVX, KO | FB, ISRG, DIS, ADBE |
| 2023 | 2023-10-02 | 10.6% | 77.2% | AVGO, ORCL | CVX, KO |
| 2024 | 2024-10-01 | 22.6% | 82.8% | LRCX | JNJ |
| 2025 | 2025-10-01 | 23.2% | 85.2% | NFLX, PLTR, JNJ, ABBV | LRCX, UNH, PG, HD |
| 2026 | 2026-10-01 | 30.0% | 86.1% | MU, AMD | ORCL, NFLX |
## 年別詳細
### 2016（2016-10-03）
半導体 **3.70%**（30% キャップ 未達）· AI ティルト **61.37%**
**新規:** AAPL, GOOGL, AMZN, MSFT, FB, JNJ, GE, WMT, PG, INTC, CERN, KO, PFE, MRK, CVX · **退出:** なし
| # | Ticker | Wt % | Sector | Sub-industry | AI枠 |
|---:|---|---:|---|---|---|
| 1 | AAPL | 14.05 | Information Technology | Technology Hardware, Storage & Peripherals | AI |
| 2 | GOOGL | 13.98 | Communication Services | Interactive Media & Services | AI |
| 3 | AMZN | 10.17 | Consumer Discretionary | Broadline Retail | AI |
| 4 | MSFT | 10.15 | Information Technology | Systems Software | AI |
| 5 | FB | 9.32 | — | — | AI |
| 6 | JNJ | 6.36 | Health Care | Pharmaceuticals | — |
| 7 | GE | 6.05 | Industrials | Aerospace & Defense | — |
| 8 | WMT | 4.82 | Consumer Staples | Consumer Staples Merchandise Retail | — |
| 9 | PG | 4.62 | Consumer Staples | Personal Care Products | — |
| 10 | INTC | 3.70 | Information Technology | Semiconductors | 半導体+AI |
| 11 | CERN | 3.53 | — | — | — |
| 12 | KO | 3.41 | Consumer Staples | Soft Drinks & Non-alcoholic Beverages | — |
| 13 | PFE | 3.33 | Health Care | Pharmaceuticals | — |
| 14 | MRK | 3.26 | Health Care | Pharmaceuticals | — |
| 15 | CVX | 3.25 | Energy | Integrated Oil & Gas | — |
**GICS Sector 内訳**
| Sector | Wt % |
|---|---:|
| Information Technology | 27.9% |
| Communication Services | 14.0% |
| Health Care | 13.0% |
| Consumer Staples | 12.9% |
| Unknown | 12.8% |
| Consumer Discretionary | 10.2% |
| Industrials | 6.1% |
| Energy | 3.2% |
**AI ティルト内訳（6 銘柄）:** AAPL, GOOGL, AMZN, MSFT, FB, INTC
### 2017（2017-10-02）
半導体 **3.26%**（30% キャップ 未達）· AI ティルト **64.58%**
**新規:** UNH, HD, BA · **退出:** KO, PFE, MRK
| # | Ticker | Wt % | Sector | Sub-industry | AI枠 |
|---:|---|---:|---|---|---|
| 1 | AAPL | 15.67 | Information Technology | Technology Hardware, Storage & Peripherals | AI |
| 2 | GOOGL | 14.22 | Communication Services | Interactive Media & Services | AI |
| 3 | MSFT | 11.18 | Information Technology | Systems Software | AI |
| 4 | FB | 10.39 | — | — | AI |
| 5 | AMZN | 9.87 | Consumer Discretionary | Broadline Retail | AI |
| 6 | JNJ | 5.91 | Health Care | Pharmaceuticals | — |
| 7 | WMT | 4.35 | Consumer Staples | Consumer Staples Merchandise Retail | — |
| 8 | GE | 4.24 | Industrials | Aerospace & Defense | — |
| 9 | PG | 3.90 | Consumer Staples | Personal Care Products | — |
| 10 | CERN | 3.80 | — | — | — |
| 11 | UNH | 3.51 | Health Care | Managed Health Care | — |
| 12 | HD | 3.31 | Consumer Discretionary | Home Improvement Retail | — |
| 13 | INTC | 3.26 | Information Technology | Semiconductors | 半導体+AI |
| 14 | CVX | 3.25 | Energy | Integrated Oil & Gas | — |
| 15 | BA | 3.13 | Industrials | Aerospace & Defense | — |
**GICS Sector 内訳**
| Sector | Wt % |
|---|---:|
| Information Technology | 30.1% |
| Communication Services | 14.2% |
| Unknown | 14.2% |
| Consumer Discretionary | 13.2% |
| Health Care | 9.4% |
| Consumer Staples | 8.3% |
| Industrials | 7.4% |
| Energy | 3.2% |
**AI ティルト内訳（6 銘柄）:** AAPL, GOOGL, MSFT, FB, AMZN, INTC
### 2018（2018-10-01）
半導体 **5.74%**（30% キャップ 未達）· AI ティルト **72.33%**
**新規:** PFE, CSCO, NVDA · **退出:** GE, PG, CVX
| # | Ticker | Wt % | Sector | Sub-industry | AI枠 |
|---:|---|---:|---|---|---|
| 1 | AAPL | 16.50 | Information Technology | Technology Hardware, Storage & Peripherals | AI |
| 2 | AMZN | 15.83 | Consumer Discretionary | Broadline Retail | AI |
| 3 | GOOGL | 13.46 | Communication Services | Interactive Media & Services | AI |
| 4 | MSFT | 13.28 | Information Technology | Systems Software | AI |
| 5 | FB | 7.53 | — | — | AI |
| 6 | JNJ | 4.86 | Health Care | Pharmaceuticals | — |
| 7 | WMT | 3.98 | Consumer Staples | Consumer Staples Merchandise Retail | — |
| 8 | UNH | 3.65 | Health Care | Managed Health Care | — |
| 9 | BA | 3.48 | Industrials | Aerospace & Defense | — |
| 10 | HD | 3.14 | Consumer Discretionary | Home Improvement Retail | — |
| 11 | INTC | 2.93 | Information Technology | Semiconductors | 半導体+AI |
| 12 | PFE | 2.89 | Health Care | Pharmaceuticals | — |
| 13 | CSCO | 2.86 | Information Technology | Communications Equipment | — |
| 14 | CERN | 2.82 | — | — | — |
| 15 | NVDA | 2.81 | Information Technology | Semiconductors | 半導体+AI |
**GICS Sector 内訳**
| Sector | Wt % |
|---|---:|
| Information Technology | 38.4% |
| Consumer Discretionary | 19.0% |
| Communication Services | 13.5% |
| Health Care | 11.4% |
| Unknown | 10.3% |
| Consumer Staples | 4.0% |
| Industrials | 3.5% |
**AI ティルト内訳（7 銘柄）:** AAPL, AMZN, GOOGL, MSFT, FB, INTC, NVDA
### 2019（2019-10-01）
半導体 **3.06%**（30% キャップ 未達）· AI ティルト **68.11%**
**新規:** PG, DIS, KO, MRK · **退出:** PFE, CSCO, CERN, NVDA
| # | Ticker | Wt % | Sector | Sub-industry | AI枠 |
|---:|---|---:|---|---|---|
| 1 | MSFT | 15.52 | Information Technology | Systems Software | AI |
| 2 | AAPL | 15.11 | Information Technology | Technology Hardware, Storage & Peripherals | AI |
| 3 | AMZN | 13.56 | Consumer Discretionary | Broadline Retail | AI |
| 4 | GOOGL | 13.02 | Communication Services | Interactive Media & Services | AI |
| 5 | FB | 7.84 | — | — | AI |
| 6 | WMT | 4.81 | Consumer Staples | Consumer Staples Merchandise Retail | — |
| 7 | JNJ | 4.49 | Health Care | Pharmaceuticals | — |
| 8 | PG | 4.08 | Consumer Staples | Personal Care Products | — |
| 9 | HD | 3.36 | Consumer Discretionary | Home Improvement Retail | — |
| 10 | BA | 3.31 | Industrials | Aerospace & Defense | — |
| 11 | DIS | 3.26 | Communication Services | Movies & Entertainment | — |
| 12 | INTC | 3.06 | Information Technology | Semiconductors | 半導体+AI |
| 13 | KO | 2.98 | Consumer Staples | Soft Drinks & Non-alcoholic Beverages | — |
| 14 | UNH | 2.87 | Health Care | Managed Health Care | — |
| 15 | MRK | 2.73 | Health Care | Pharmaceuticals | — |
**GICS Sector 内訳**
| Sector | Wt % |
|---|---:|
| Information Technology | 33.7% |
| Consumer Discretionary | 16.9% |
| Communication Services | 16.3% |
| Consumer Staples | 11.9% |
| Health Care | 10.1% |
| Unknown | 7.8% |
| Industrials | 3.3% |
**AI ティルト内訳（6 銘柄）:** MSFT, AAPL, AMZN, GOOGL, FB, INTC
### 2020（2020-10-01）
半導体 **5.50%**（30% キャップ 未達）· AI ティルト **84.06%**
**新規:** NVDA, ADBE, NFLX, CRM · **退出:** BA, DIS, KO, MRK
| # | Ticker | Wt % | Sector | Sub-industry | AI枠 |
|---:|---|---:|---|---|---|
| 1 | AAPL | 20.08 | Information Technology | Technology Hardware, Storage & Peripherals | AI |
| 2 | AMZN | 16.90 | Consumer Discretionary | Broadline Retail | AI |
| 3 | MSFT | 15.97 | Information Technology | Systems Software | AI |
| 4 | GOOGL | 10.44 | Communication Services | Interactive Media & Services | AI |
| 5 | FB | 7.87 | — | — | AI |
| 6 | WMT | 3.92 | Consumer Staples | Consumer Staples Merchandise Retail | — |
| 7 | NVDA | 3.49 | Information Technology | Semiconductors | 半導体+AI |
| 8 | JNJ | 3.44 | Health Care | Pharmaceuticals | — |
| 9 | PG | 3.10 | Consumer Staples | Personal Care Products | — |
| 10 | UNH | 2.80 | Health Care | Managed Health Care | — |
| 11 | HD | 2.69 | Consumer Discretionary | Home Improvement Retail | — |
| 12 | ADBE | 2.50 | Information Technology | Application Software | AI |
| 13 | NFLX | 2.44 | Communication Services | Movies & Entertainment | AI |
| 14 | CRM | 2.37 | Information Technology | Application Software | AI |
| 15 | INTC | 2.01 | Information Technology | Semiconductors | 半導体+AI |
**GICS Sector 内訳**
| Sector | Wt % |
|---|---:|
| Information Technology | 46.4% |
| Consumer Discretionary | 19.6% |
| Communication Services | 12.9% |
| Unknown | 7.9% |
| Consumer Staples | 7.0% |
| Health Care | 6.2% |
**AI ティルト内訳（10 銘柄）:** AAPL, AMZN, MSFT, GOOGL, FB, NVDA, ADBE, NFLX, CRM, INTC
### 2021（2021-10-01）
半導体 **4.06%**（30% キャップ 未達）· AI ティルト **75.46%**
**新規:** TSLA, ISRG, DIS · **退出:** NFLX, CRM, INTC
| # | Ticker | Wt % | Sector | Sub-industry | AI枠 |
|---:|---|---:|---|---|---|
| 1 | AAPL | 17.99 | Information Technology | Technology Hardware, Storage & Peripherals | AI |
| 2 | MSFT | 16.40 | Information Technology | Systems Software | AI |
| 3 | GOOGL | 14.16 | Communication Services | Interactive Media & Services | AI |
| 4 | AMZN | 13.11 | Consumer Discretionary | Broadline Retail | AI |
| 5 | FB | 7.58 | — | — | AI |
| 6 | TSLA | 6.13 | Consumer Discretionary | Automobile Manufacturers | — |
| 7 | NVDA | 4.06 | Information Technology | Semiconductors | 半導体+AI |
| 8 | JNJ | 2.89 | Health Care | Pharmaceuticals | — |
| 9 | ISRG | 2.84 | Health Care | Health Care Equipment | — |
| 10 | WMT | 2.83 | Consumer Staples | Consumer Staples Merchandise Retail | — |
| 11 | UNH | 2.66 | Health Care | Managed Health Care | — |
| 12 | DIS | 2.44 | Communication Services | Movies & Entertainment | — |
| 13 | HD | 2.41 | Consumer Discretionary | Home Improvement Retail | — |
| 14 | PG | 2.34 | Consumer Staples | Personal Care Products | — |
| 15 | ADBE | 2.16 | Information Technology | Application Software | AI |
**GICS Sector 内訳**
| Sector | Wt % |
|---|---:|
| Information Technology | 40.6% |
| Consumer Discretionary | 21.6% |
| Communication Services | 16.6% |
| Health Care | 8.4% |
| Unknown | 7.6% |
| Consumer Staples | 5.2% |
**AI ティルト内訳（7 銘柄）:** AAPL, MSFT, GOOGL, AMZN, FB, NVDA, ADBE
### 2022（2022-10-03）
半導体 **3.01%**（30% キャップ 未達）· AI ティルト **68.77%**
**新規:** META, LLY, CVX, KO · **退出:** FB, ISRG, DIS, ADBE
| # | Ticker | Wt % | Sector | Sub-industry | AI枠 |
|---:|---|---:|---|---|---|
| 1 | AAPL | 21.59 | Information Technology | Technology Hardware, Storage & Peripherals | AI |
| 2 | MSFT | 16.84 | Information Technology | Systems Software | AI |
| 3 | GOOGL | 12.28 | Communication Services | Interactive Media & Services | AI |
| 4 | AMZN | 11.45 | Consumer Discretionary | Broadline Retail | AI |
| 5 | TSLA | 7.42 | Consumer Discretionary | Automobile Manufacturers | — |
| 6 | UNH | 4.32 | Health Care | Managed Health Care | — |
| 7 | JNJ | 3.71 | Health Care | Pharmaceuticals | — |
| 8 | META | 3.60 | Communication Services | Interactive Media & Services | AI |
| 9 | WMT | 3.33 | Consumer Staples | Consumer Staples Merchandise Retail | — |
| 10 | NVDA | 3.01 | Information Technology | Semiconductors | 半導体+AI |
| 11 | LLY | 2.72 | Health Care | Pharmaceuticals | — |
| 12 | PG | 2.66 | Consumer Staples | Personal Care Products | — |
| 13 | HD | 2.54 | Consumer Discretionary | Home Improvement Retail | — |
| 14 | CVX | 2.42 | Energy | Integrated Oil & Gas | — |
| 15 | KO | 2.12 | Consumer Staples | Soft Drinks & Non-alcoholic Beverages | — |
**GICS Sector 内訳**
| Sector | Wt % |
|---|---:|
| Information Technology | 41.4% |
| Consumer Discretionary | 21.4% |
| Communication Services | 15.9% |
| Health Care | 10.8% |
| Consumer Staples | 8.1% |
| Energy | 2.4% |
**AI ティルト内訳（6 銘柄）:** AAPL, MSFT, GOOGL, AMZN, META, NVDA
### 2023（2023-10-02）
半導体 **10.56%**（30% キャップ 未達）· AI ティルト **77.22%**
**新規:** AVGO, ORCL · **退出:** CVX, KO
| # | Ticker | Wt % | Sector | Sub-industry | AI枠 |
|---:|---|---:|---|---|---|
| 1 | AAPL | 19.59 | Information Technology | Technology Hardware, Storage & Peripherals | AI |
| 2 | MSFT | 17.17 | Information Technology | Systems Software | AI |
| 3 | GOOGL | 12.25 | Communication Services | Interactive Media & Services | AI |
| 4 | AMZN | 9.83 | Consumer Discretionary | Broadline Retail | AI |
| 5 | NVDA | 8.10 | Information Technology | Semiconductors | 半導体+AI |
| 6 | TSLA | 5.88 | Consumer Discretionary | Automobile Manufacturers | — |
| 7 | META | 5.76 | Communication Services | Interactive Media & Services | AI |
| 8 | LLY | 3.49 | Health Care | Pharmaceuticals | — |
| 9 | UNH | 3.28 | Health Care | Managed Health Care | — |
| 10 | WMT | 3.07 | Consumer Staples | Consumer Staples Merchandise Retail | — |
| 11 | JNJ | 2.70 | Health Care | Pharmaceuticals | — |
| 12 | AVGO | 2.45 | Information Technology | Semiconductors | 半導体+AI |
| 13 | PG | 2.32 | Consumer Staples | Personal Care Products | — |
| 14 | ORCL | 2.07 | Information Technology | Application Software | AI |
| 15 | HD | 2.04 | Consumer Discretionary | Home Improvement Retail | — |
**GICS Sector 内訳**
| Sector | Wt % |
|---|---:|
| Information Technology | 49.4% |
| Communication Services | 18.0% |
| Consumer Discretionary | 17.7% |
| Health Care | 9.5% |
| Consumer Staples | 5.4% |
**AI ティルト内訳（8 銘柄）:** AAPL, MSFT, GOOGL, AMZN, NVDA, META, AVGO, ORCL
### 2024（2024-10-01）
半導体 **22.65%**（30% キャップ 未達）· AI ティルト **82.77%**
**新規:** LRCX · **退出:** JNJ
| # | Ticker | Wt % | Sector | Sub-industry | AI枠 |
|---:|---|---:|---|---|---|
| 1 | AAPL | 16.50 | Information Technology | Technology Hardware, Storage & Peripherals | AI |
| 2 | MSFT | 14.99 | Information Technology | Systems Software | AI |
| 3 | NVDA | 13.97 | Information Technology | Semiconductors | 半導体+AI |
| 4 | GOOGL | 9.90 | Communication Services | Interactive Media & Services | AI |
| 5 | AMZN | 9.47 | Consumer Discretionary | Broadline Retail | AI |
| 6 | META | 7.07 | Communication Services | Interactive Media & Services | AI |
| 7 | LRCX | 4.94 | Information Technology | Semiconductor Materials & Equipment | 半導体+AI |
| 8 | TSLA | 4.03 | Consumer Discretionary | Automobile Manufacturers | — |
| 9 | LLY | 3.82 | Health Care | Pharmaceuticals | — |
| 10 | AVGO | 3.74 | Information Technology | Semiconductors | 半導体+AI |
| 11 | WMT | 3.12 | Consumer Staples | Consumer Staples Merchandise Retail | — |
| 12 | UNH | 2.50 | Health Care | Managed Health Care | — |
| 13 | ORCL | 2.21 | Information Technology | Application Software | AI |
| 14 | PG | 1.88 | Consumer Staples | Personal Care Products | — |
| 15 | HD | 1.88 | Consumer Discretionary | Home Improvement Retail | — |
**GICS Sector 内訳**
| Sector | Wt % |
|---|---:|
| Information Technology | 56.3% |
| Communication Services | 17.0% |
| Consumer Discretionary | 15.4% |
| Health Care | 6.3% |
| Consumer Staples | 5.0% |
**AI ティルト内訳（9 銘柄）:** AAPL, MSFT, NVDA, GOOGL, AMZN, META, LRCX, AVGO, ORCL
### 2025（2025-10-01）
半導体 **23.21%**（30% キャップ 未達）· AI ティルト **85.20%**
**新規:** NFLX, PLTR, JNJ, ABBV · **退出:** LRCX, UNH, PG, HD
| # | Ticker | Wt % | Sector | Sub-industry | AI枠 |
|---:|---|---:|---|---|---|
| 1 | NVDA | 17.32 | Information Technology | Semiconductors | 半導体+AI |
| 2 | MSFT | 14.44 | Information Technology | Systems Software | AI |
| 3 | AAPL | 14.17 | Information Technology | Technology Hardware, Storage & Peripherals | AI |
| 4 | GOOGL | 11.12 | Communication Services | Interactive Media & Services | AI |
| 5 | AMZN | 8.89 | Consumer Discretionary | Broadline Retail | AI |
| 6 | META | 6.79 | Communication Services | Interactive Media & Services | AI |
| 7 | AVGO | 5.89 | Information Technology | Semiconductors | 半導体+AI |
| 8 | TSLA | 5.76 | Consumer Discretionary | Automobile Manufacturers | — |
| 9 | ORCL | 3.06 | Information Technology | Application Software | AI |
| 10 | WMT | 3.04 | Consumer Staples | Consumer Staples Merchandise Retail | — |
| 11 | LLY | 2.78 | Health Care | Pharmaceuticals | — |
| 12 | NFLX | 1.87 | Communication Services | Movies & Entertainment | AI |
| 13 | PLTR | 1.66 | Information Technology | Application Software | AI |
| 14 | JNJ | 1.65 | Health Care | Pharmaceuticals | — |
| 15 | ABBV | 1.58 | Health Care | Biotechnology | — |
**GICS Sector 内訳**
| Sector | Wt % |
|---|---:|
| Information Technology | 56.5% |
| Communication Services | 19.8% |
| Consumer Discretionary | 14.6% |
| Health Care | 6.0% |
| Consumer Staples | 3.0% |
**AI ティルト内訳（10 銘柄）:** NVDA, MSFT, AAPL, GOOGL, AMZN, META, AVGO, ORCL, NFLX, PLTR
### 2026（2026-10-01）
半導体 **30.00%**（30% キャップ **効いてる**）· AI ティルト **86.11%**
**新規:** MU, AMD · **退出:** ORCL, NFLX
| # | Ticker | Wt % | Sector | Sub-industry | AI枠 |
|---:|---|---:|---|---|---|
| 1 | NVDA | 17.81 | Information Technology | Semiconductors | 半導体+AI |
| 2 | AAPL | 15.25 | Information Technology | Technology Hardware, Storage & Peripherals | AI |
| 3 | GOOGL | 13.08 | Communication Services | Interactive Media & Services | AI |
| 4 | MSFT | 12.04 | Information Technology | Systems Software | AI |
| 5 | AMZN | 8.47 | Consumer Discretionary | Broadline Retail | AI |
| 6 | META | 5.83 | Communication Services | Interactive Media & Services | AI |
| 7 | AVGO | 5.15 | Information Technology | Semiconductors | 半導体+AI |
| 8 | TSLA | 4.42 | Consumer Discretionary | Automobile Manufacturers | — |
| 9 | MU | 3.89 | Information Technology | Semiconductors | 半導体+AI |
| 10 | LLY | 3.42 | Health Care | Pharmaceuticals | — |
| 11 | AMD | 3.15 | Information Technology | Semiconductors | 半導体+AI |
| 12 | WMT | 2.62 | Consumer Staples | Consumer Staples Merchandise Retail | — |
| 13 | JNJ | 1.97 | Health Care | Pharmaceuticals | — |
| 14 | ABBV | 1.45 | Health Care | Biotechnology | — |
| 15 | PLTR | 1.44 | Information Technology | Application Software | AI |
**GICS Sector 内訳**
| Sector | Wt % |
|---|---:|
| Information Technology | 58.7% |
| Communication Services | 18.9% |
| Consumer Discretionary | 12.9% |
| Health Care | 6.8% |
| Consumer Staples | 2.6% |
**AI ティルト内訳（10 銘柄）:** NVDA, AAPL, GOOGL, MSFT, AMZN, META, AVGO, MU, AMD, PLTR
> **2026-10-01:** 半導体サブ業種が **30% キャップに張り付き**。NVDA / AAPL / GOOGL / MSFT / AMZN / META がウェイト上位を占有（詳細 [`ROUND19_V1_WEIGHTS_2026-10-01.md`](ROUND19_V1_WEIGHTS_2026-10-01.md)）。
