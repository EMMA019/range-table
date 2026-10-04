# Round 19 — Saka Index（研究）

事前登録: `6e3ad93`（`docs/ROUND19_PREREG_ja.md`）— **ウォッチリスト未使用・PIT S&P 500 のみ**

## 事実

### データ

- 構成: [fja05680/sp500](https://github.com/fja05680/sp500) `sp500_ticker_start_end.csv`
- GICS: 同 `sp500.csv`（現行・ルックアヘッド）
- 時価総額: EDGAR companyfacts 株式数（リバランス日以前の最新）× 当日終値
- 繰り越し株数: 最終リバランスで mcap 算出可能銘柄 **132** 件中 **0.0%** が過去株数繰り越し
- SPY 暦年チェック: 2017 **19.4%**, 2018 **-6.3%**（前年最終営業日基準）

### 試行と採用

- **30** 構成（3 選定 × 2 N × 5 ウェイト）、四半期・小数株・$3,200
- IS 採用: **corrdiverse_15__mcap_cap5**（IS CAGR 17.4%、IS DD -26.6%、ターンオーバー 28.5%/回）

### OOS 全構成（$0.35 約定・2021–2026-10-02）

| 順位 | 構成 | 年率 | 最大DD | プラス年% | ターンオーバー/回 | 手数料ドラッグ OOS ($0.35) | OOS ($1) |
|---:|---|---:|---:|---:|---:|---|---|
| 1 | plain_15__mcap | 16.3% | -31.0% | 80% | 10.2% | 7.8% / $248 | 22.0% / $704 |
| 2 | plain_20__mcap | 15.9% | -30.5% | 80% | 10.1% | 10.4% / $332 | 29.6% / $948 |
| 3 | plain_15__mcap_cap10 | 15.6% | -25.3% | 80% | 9.9% | 7.7% / $247 | 22.2% / $711 |
| 4 | plain_15__equal | 14.3% | -20.5% | 80% | 9.8% | 7.7% / $246 | 21.9% / $700 |
| 5 | plain_20__mcap_cap10 | 14.3% | -26.3% | 80% | 9.7% | 10.3% / $330 | 29.6% / $948 |
| 6 | plain_15__mcap_cap5 | 13.4% | -23.0% | 80% | 14.0% | 7.7% / $246 | 22.1% / $707 |
| 7 | plain_20__mcap_cap5 | 12.7% | -23.1% | 80% | 9.4% | 10.4% / $333 | 29.8% / $955 |
| 8 | plain_20__equal | 12.7% | -23.1% | 80% | 9.4% | 10.4% / $334 | 29.8% / $954 |
| 9 | plain_15__invvol | 12.4% | -18.1% | 80% | 17.2% | 7.7% / $247 | 22.1% / $707 |
| 10 | plain_20__invvol | 10.5% | -22.3% | 80% | 17.0% | 10.4% / $332 | 29.7% / $949 |
| 11 | volprune_15__mcap_cap10 | 8.3% | -20.8% | 80% | 28.0% | 7.6% / $244 | 21.8% / $699 |
| 12 | volprune_20__equal | 7.9% | -25.8% | 80% | 22.0% | 10.4% / $332 | 29.8% / $953 |
| 13 | volprune_15__mcap | 7.7% | -23.0% | 70% | 34.2% | 7.7% / $247 | 22.0% / $705 |
| 14 | volprune_20__mcap_cap5 | 7.6% | -24.9% | 80% | 22.3% | 10.3% / $329 | 29.4% / $941 |
| 15 | volprune_15__equal | 7.5% | -22.6% | 80% | 25.1% | 7.7% / $245 | 21.9% / $702 |
| 16 | volprune_15__mcap_cap5 | 7.0% | -23.0% | 80% | 29.3% | 7.7% / $245 | 21.9% / $702 |
| 17 | corrdiverse_20__equal | 6.8% | -19.6% | 80% | 21.7% | 10.4% / $333 | 29.8% / $952 |
| 18 | corrdiverse_15__equal | 6.8% | -23.3% | 80% | 24.3% | 7.7% / $246 | 21.9% / $700 |
| 19 | corrdiverse_20__mcap_cap5 | 6.6% | -19.8% | 80% | 21.8% | 10.3% / $330 | 29.4% / $940 |
| 20 | **corrdiverse_15__mcap_cap5** | 6.2% | -23.8% | 70% | 28.5% | 7.7% / $247 | 22.2% / $709 |
| 21 | volprune_20__invvol | 5.8% | -23.5% | 80% | 28.6% | 10.3% / $331 | 29.6% / $947 |
| 22 | volprune_15__invvol | 5.4% | -23.0% | 80% | 31.0% | 7.7% / $247 | 22.1% / $707 |
| 23 | corrdiverse_15__invvol | 5.3% | -23.9% | 80% | 30.6% | 7.7% / $246 | 22.0% / $705 |
| 24 | corrdiverse_20__invvol | 5.1% | -21.3% | 80% | 27.9% | 10.4% / $331 | 29.6% / $948 |
| 25 | volprune_20__mcap_cap10 | 5.1% | -26.6% | 80% | 26.9% | 10.2% / $327 | 29.2% / $935 |
| 26 | corrdiverse_20__mcap | 4.8% | -23.1% | 50% | 32.0% | 10.3% / $329 | 29.5% / $945 |
| 27 | corrdiverse_15__mcap_cap10 | 4.8% | -25.6% | 70% | 28.0% | 7.7% / $247 | 22.1% / $706 |
| 28 | corrdiverse_20__mcap_cap10 | 4.0% | -23.3% | 70% | 26.8% | 10.2% / $328 | 29.4% / $940 |
| 29 | corrdiverse_15__mcap | 3.3% | -25.2% | 60% | 34.4% | 7.7% / $246 | 22.1% / $706 |
| 30 | volprune_20__mcap | 2.1% | -31.1% | 70% | 32.7% | 10.3% / $328 | 29.3% / $939 |
| — | **SPY** | 13.7% | -25.4% | — | — | — | — |
| — | **QQQ** | 16.6% | -35.6% | — | — | — | — |
| — | SOXX（参考） | 30.8% | -46.2% | — | — | — | — |

**採用構成の OOS 順位:** **20 / 30**（年率降順）

### 採用構成サマリ（OOS）

| 指標 | $0.35 | $1.00 |
|---|---:|---:|
| CAGR | 6.2% | 5.3% |
| 最大DD | -23.8% | -24.0% |
| プラス年% | 70% | 70% |
| OOS 手数料合計 | $247 (7.7%) | $709 (22.2%) |

**IS→OOS CAGR:** 17.4% → 6.2%

### 暦年（採用・前年最終営業日基準）

| 年 | Saka | SPY |
|---|---:|---:|
| 2016 | — | 9.6% |
| 2017 | 21.2% | 19.4% |
| 2018 | -0.3% | -6.3% |
| 2019 | 26.8% | 28.8% |
| 2020 | 20.1% | 16.2% |
| 2021 | 12.9% | 27.0% |
| 2022 | -12.4% | -19.5% |
| 2023 | -1.9% | 24.3% |
| 2024 | 19.5% | 23.3% |
| 2025 | 7.0% | 16.4% |
| 2026 YTD | 13.1% | 12.9% |

### Saka v1 草案ホールディング

#### 採用 corrdiverse_15__mcap_cap5（2026-10-01・mcap_cap5）

最大ペア ρ: **0.67**

| ティッカー | GICS | ウェイト |
|---|---|---:|
| MO | Consumer Staples | 5.0% |
| VRSK | Industrials | 5.0% |
| CVX | Energy | 8.1% |
| TMUS | Communication Services | 8.1% |
| T | Communication Services | 8.1% |
| PM | Consumer Staples | 8.1% |
| TYL | Information Technology | 5.0% |
| FANG | Energy | 5.0% |
| NOW | Information Technology | 5.0% |
| VLO | Energy | 5.0% |
| DGX | Health Care | 8.1% |
| WMT | Consumer Staples | 8.1% |
| NFLX | Communication Services | 8.1% |
| AMT | Real Estate | 5.0% |
| WELL | Real Estate | 8.1% |

#### 参考 corrdiverse_15（2026-10-01・equal）

最大ペア ρ: **0.67**

| ティッカー | GICS | ウェイト |
|---|---|---:|
| MO | Consumer Staples | 6.7% |
| VRSK | Industrials | 6.7% |
| CVX | Energy | 6.7% |
| TMUS | Communication Services | 6.7% |
| T | Communication Services | 6.7% |
| PM | Consumer Staples | 6.7% |
| TYL | Information Technology | 6.7% |
| FANG | Energy | 6.7% |
| NOW | Information Technology | 6.7% |
| VLO | Energy | 6.7% |
| DGX | Health Care | 6.7% |
| WMT | Consumer Staples | 6.7% |
| NFLX | Communication Services | 6.7% |
| AMT | Real Estate | 6.7% |
| WELL | Real Estate | 6.7% |

#### 参考 corrdiverse_20（2026-10-01・equal）

最大ペア ρ: **0.67**

| ティッカー | GICS | ウェイト |
|---|---|---:|
| MO | Consumer Staples | 5.0% |
| VRSK | Industrials | 5.0% |
| CVX | Energy | 5.0% |
| TMUS | Communication Services | 5.0% |
| T | Communication Services | 5.0% |
| PM | Consumer Staples | 5.0% |
| TYL | Information Technology | 5.0% |
| FANG | Energy | 5.0% |
| NOW | Information Technology | 5.0% |
| VLO | Energy | 5.0% |
| DGX | Health Care | 5.0% |
| WMT | Consumer Staples | 5.0% |
| NFLX | Communication Services | 5.0% |
| AMT | Real Estate | 5.0% |
| WELL | Real Estate | 5.0% |
| ADSK | Information Technology | 5.0% |
| CPRT | Industrials | 5.0% |
| TJX | Consumer Discretionary | 5.0% |
| CHTR | Communication Services | 5.0% |
| ADM | Consumer Staples | 5.0% |


![OOS equity](round19_equity.png)

## 解釈

- PIT 構成はサバイバーシップを下げるが、GICS・EDGAR 欠損・株数繰り越しはバイアス／保守性の残り要因。
- **30 通り**から IS で 1 つ選ぶため OOS は過適合リスクあり（順位 20）。
- 上場廃止は最終価格固定（0% その後）。

---

*生成: `npx tsx scripts/round19-saka-study.ts`*
