# Round 19 Corrected v1 — 採用構成の詳細レポート（確定版）

**対象:** Corrected v1（事前登録 `6e3ad93`・差分リバランス・PIT データ）  
**採用構成 ID:** `plain_15__mcap`（IS 2016–2020 を `selectSakaConfig` で再計算）  
**初期資金:** $3200　**手数料（主計算）:** $0.35/注文  
**データ:** `data/.cache/pit/`（`docs/DATA_PIT_ja.md`）　**生成コミット:** `8d54900`

### 事前登録合格基準（OOS・$0.35・`ROUND19_PREREG_ja.md`）— 先に判定

| # | 基準 | 採用 | SPY/参照 | 判定 |
|---|---|---:|---:|---|
| 1 | OOS CAGR ≥ 10% | 19.5% | — | **合格** |
| 2 | OOS MaxDD **が SPY より浅い** | -36.1% | -24.5% | **不合格** |
| 3 | 暦年プラス比率 ≥ 70%（OOS 暦年） | 90% | — | **合格** |

### ヘッドライン（採用構成 vs SPY・差分リバランス $0.35/注文）

| 期間 | 採用 CAGR | SPY CAGR | 採用 MaxDD | SPY MaxDD |
|---|---:|---:|---:|---:|
| IS (2016–2020) | 22.98% | 15.42% | -27.20% | -33.72% |
| OOS (2021–2026) | 19.55% | 15.18% | -36.08% | -24.50% |

**データ品質ゲート（確定版前条件）:** 全リバランス監査（S&P #40 フロア + `detectMcapJump`）**0 失敗**（`pit-mcap-rebalance-audit.test.ts`）。全保有銘柄の PIT mcap vs Yahoo 参照 **0 失敗**（`PIT_YAHOO_REF_TEST=1`・`pit-mcap-yahoo-ref.test.ts`）。2021-10-01 バスケットに **ISRG 含む**（3:1 前過大 mcap 修正後）。

全期間の最大 DD 局面（採用曲線）: ピーク **2022-01-03** → ボトム **2023-01-05**（深さ -36.1%）→ 回復 **2023-11-16**。OOS MaxDD **-36.1%**（2022-01-03→2023-01-05）vs SPY OOS **-24.5%**。

### 採用構成のデータ版別変遷


| データ版 (git) | 採用構成 ID | 備考 |
|---|---|---|
| `e2380b8` | `plain_15__equal` | filed PIT 黒字・初回 corrected v1 PIT データ |
| `216dfc6` | `plain_15__mcap_cap5` | 詳細レポート初版（mcap 順位バグ残存） |
| `fe6c787` | `plain_20__mcap_cap10` | mcapC・ATVI/CERN 修正後 IS 再採用 |
| `cc6ffaa` | `plain_15__mcap` | HOLX 株数・XOM CIK 一貫 |
| `cc6ffaa`～`d35d888` | `plain_15__mcap` | NVDA/GOOGL/SMCI スプリット整合・OOS リバランス監査 |
| `8d54900` | `plain_15__mcap` | **確定版:** ISRG 2021-10 3:1 ガード + 全リバランス Yahoo mcap クロスチェック（`PIT_YAHOO_REF_TEST`）。採用 ID **変更なし** — ISRG 過大 mcap 修正により 2021-10 バスケットから ISRG 外れ、eligible 順位が再計算されたが IS 勝者は同一。 |


---

## 事実と解釈の区別

- **事実:** シミュレーション・EDGAR・価格キャッシュから機械的に数えた値。
- **解釈:** 因果や「なぜそうなったか」の平易な説明（検証可能な単純分解を含む）。

---

## データ修正（META 株数・XOM CIK）


**(a) META 株数:** `dei:EntityCommonStockSharesOutstanding` 欠損時は `us-gaap` の加重平均株数へフォールバック（`pit-shares.ts`）。2026-10-01 時点株数: **2,538,000,000**。

**(b) XOM CIK:** `data/pit_cik_overrides.json` で **34088**（Exxon Mobil）。黒字判定 2026-10-01: **unknown**。

| チェック | 結果 |
|---|---|
| CIK↔SEC 不一致（全 PIT 履歴銘柄） | **1** |
| GICS CSV CIK≠解決後 CIK（2026-10-01 構成員） | **1**（XOM:2115436→34088） |
| リバランス日・mcap=0（価格あり） | 直近サンプル: [{"date":"2026-07-01","tickers":["ERIE","HONA","STZ","XOM"]},{"date":"2026-10-01","tickers":["ERIE","STZ","XOM"]}] |

**主要リバランス日の採用15（PIT mcap・Yahoo スプリット整合後）:** 詳細は §(1)。検証: `pit-mcap-top30-validation.test.ts`（NVDA/AVGO/META が 2025-01-02・2026-10-01 で eligible 上位10）。

| 日付 | 採用15（先頭5銘柄） |
|---|---|
| 2024-07-01 | MSFT, AAPL, NVDA, GOOGL, AMZN … |
| 2025-01-02 | AAPL, NVDA, MSFT, AMZN, GOOGL … |
| 2026-10-01 | NVDA, AAPL, GOOGL, MSFT, AMZN … |


---

## (1) 四半期ごとの保有履歴（2016–2026）

各リバランス日: 保有銘柄数、追加・除外ティッカー、**入替銘柄数**（追加数＝除外数）、注文内訳は (3) と一致。

| リバランス日 | 保有数 | 追加 | 除外 | 入替数 | スワップ注文 | リウェイト注文 | 手数料$0.35 |
|---|---:|---|---|---:|---:|---:|---:|
| 2016-01-04 | 15 | AAPL, GOOGL, MSFT, AMZN, FB, JNJ, WMT, PG, KO, CERN, HD, BA, INTC, PFE, MRK | — | 15 | 14 | 0 | $4.90 |
| 2016-04-01 | 15 | VZ, T | BA, MRK | 2 | 2 | 0 | $0.70 |
| 2016-07-01 | 15 | GE, CVX | HD, INTC | 2 | 3 | 2 | $1.75 |
| 2016-10-03 | 15 | INTC, MRK | VZ, T | 2 | 3 | 0 | $1.05 |
| 2017-01-03 | 15 | BA, T | PFE, MRK | 2 | 3 | 1 | $1.40 |
| 2017-04-03 | 15 | HD, CMCSA, UNH | BA, CVX, T | 3 | 4 | 0 | $1.40 |
| 2017-07-03 | 15 | CVX | INTC | 1 | 1 | 2 | $1.05 |
| 2017-10-02 | 15 | INTC, BA | KO, CMCSA | 2 | 3 | 1 | $1.40 |
| 2018-01-02 | 15 | CMCSA | GE | 1 | 2 | 4 | $2.10 |
| 2018-04-02 | 15 | PFE | CMCSA | 1 | 1 | 1 | $0.70 |
| 2018-07-02 | 15 | NFLX | PFE | 1 | 0 | 0 | $0.00 |
| 2018-10-01 | 15 | PFE, CSCO, NVDA | NFLX, CVX, PG | 3 | 4 | 1 | $1.75 |
| 2019-01-02 | 15 | PG, MRK, KO | CSCO, CERN, NVDA | 3 | 4 | 1 | $1.75 |
| 2019-04-01 | 15 | CSCO, CVX | PFE, KO | 2 | 2 | 1 | $1.05 |
| 2019-07-01 | 15 | KO | CVX | 1 | 1 | 1 | $0.70 |
| 2019-10-01 | 15 | DIS | CSCO | 1 | 1 | 0 | $0.35 |
| 2020-01-02 | 15 | — | — | 0 | 0 | 3 | $1.05 |
| 2020-04-01 | 15 | NFLX, VZ | BA, KO | 2 | 3 | 1 | $1.40 |
| 2020-07-01 | 15 | NVDA, ADBE | MRK, VZ | 2 | 2 | 3 | $1.75 |
| 2020-10-01 | 15 | CRM | DIS | 1 | 1 | 2 | $1.05 |
| 2021-01-04 | 15 | TSLA, NKE | CRM, INTC | 2 | 2 | 6 | $2.80 |
| 2021-04-01 | 15 | INTC | NKE | 1 | 0 | 0 | $0.00 |
| 2021-07-01 | 15 | NKE | INTC | 1 | 0 | 2 | $0.70 |
| 2021-10-01 | 15 | ISRG, DIS | NFLX, NKE | 2 | 2 | 2 | $1.40 |
| 2022-01-03 | 15 | NFLX | ISRG | 1 | 1 | 2 | $1.05 |
| 2022-04-01 | 15 | CVX, LLY, ABBV | DIS, ADBE, NFLX | 3 | 4 | 0 | $1.40 |
| 2022-07-01 | 15 | META, KO | FB, ABBV | 2 | 2 | 12 | $4.90 |
| 2022-10-03 | 15 | — | — | 0 | 0 | 13 | $4.55 |
| 2023-01-03 | 15 | ABBV | KO | 1 | 1 | 0 | $0.35 |
| 2023-04-03 | 15 | AVGO | AMZN | 1 | 2 | 7 | $3.15 |
| 2023-07-03 | 15 | AMZN, ORCL | CVX, ABBV | 2 | 3 | 8 | $3.85 |
| 2023-10-02 | 15 | — | — | 0 | 0 | 0 | $0.00 |
| 2024-01-02 | 15 | COST | ORCL | 1 | 1 | 5 | $2.10 |
| 2024-04-01 | 15 | ORCL | COST | 1 | 0 | 2 | $0.70 |
| 2024-07-01 | 15 | SMCI, COST | JNJ, HD | 2 | 3 | 4 | $2.45 |
| 2024-10-01 | 15 | LRCX, HD | SMCI, COST | 2 | 2 | 11 | $4.55 |
| 2025-01-02 | 15 | COST, NFLX | LRCX, HD | 2 | 3 | 7 | $3.50 |
| 2025-04-01 | 15 | — | — | 0 | 0 | 0 | $0.00 |
| 2025-07-01 | 15 | JNJ | UNH | 1 | 1 | 2 | $1.05 |
| 2025-10-01 | 15 | PLTR, ABBV | COST, PG | 2 | 3 | 6 | $3.15 |
| 2026-01-02 | 15 | — | — | 0 | 0 | 3 | $1.05 |
| 2026-04-01 | 15 | BKNG, COST, MU | PLTR, ABBV, NFLX | 3 | 4 | 12 | $5.60 |
| 2026-07-01 | 15 | AMD, AMAT, LRCX | BKNG, COST, ORCL | 3 | 4 | 10 | $4.90 |
| 2026-10-01 | 15 | ABBV, PLTR | AMAT, LRCX | 2 | 2 | 11 | $4.55 |

### 入替理由（四半期ごと）

#### 2016-01-04（入替 15 銘柄）

**追加:** 
- **+AAPL**: eligible順位 2位→1位（時価総額上位15入り）
- **+GOOGL**: eligible順位 1位→2位（時価総額上位15入り）
- **+MSFT**: eligible順位 3位→3位（時価総額上位15入り）
- **+AMZN**: eligible順位 4位→4位（時価総額上位15入り）
- **+FB**: eligible順位 5位→5位（時価総額上位15入り）
- **+JNJ**: eligible順位 6位→6位（時価総額上位15入り）
- **+WMT**: eligible順位 7位→7位（時価総額上位15入り）
- **+PG**: eligible順位 8位→8位（時価総額上位15入り）
- **+KO**: eligible順位 9位→9位（時価総額上位15入り）
- **+CERN**: eligible順位 11位→10位（時価総額上位15入り）
- **+HD**: eligible順位 12位→11位（時価総額上位15入り）
- **+BA**: eligible順位 10位→12位（時価総額上位15入り）
- **+INTC**: eligible順位 13位→13位（時価総額上位15入り）
- **+PFE**: eligible順位 14位→14位（時価総額上位15入り）
- **+MRK**: eligible順位 15位→15位（時価総額上位15入り）

**除外:** なし


#### 2016-04-01（入替 2 銘柄）

**追加:** 
- **+VZ**: eligible順位 16位→12位（時価総額上位15入り）
- **+T**: eligible順位 23位→14位（時価総額上位15入り）

**除外:** 
- **−BA**: eligible順位 12位→30位（上位15から落ち）
- **−MRK**: eligible順位 15位→19位（上位15から落ち）

#### 2016-07-01（入替 2 銘柄）

**追加:** 
- **+GE**: 新規eligible化＋eligible順位 not eligible: 赤字（TTM・filed PIT）→6位（上位15入り）
- **+CVX**: eligible順位 17位→15位（時価総額上位15入り）

**除外:** 
- **−HD**: eligible順位 11位→16位（上位15から落ち）
- **−INTC**: eligible順位 13位→17位（上位15から落ち）

#### 2016-10-03（入替 2 銘柄）

**追加:** 
- **+INTC**: eligible順位 17位→10位（時価総額上位15入り）
- **+MRK**: eligible順位 19位→14位（時価総額上位15入り）

**除外:** 
- **−VZ**: eligible順位 13位→19位（上位15から落ち）
- **−T**: eligible順位 14位→16位（上位15から落ち）

#### 2017-01-03（入替 2 銘柄）

**追加:** 
- **+BA**: eligible順位 28位→10位（時価総額上位15入り）
- **+T**: eligible順位 16位→14位（時価総額上位15入り）

**除外:** 
- **−PFE**: eligible順位 13位→20位（上位15から落ち）
- **−MRK**: eligible順位 14位→21位（上位15から落ち）

#### 2017-04-03（入替 3 銘柄）

**追加:** 
- **+HD**: eligible順位 19位→12位（時価総額上位15入り）
- **+CMCSA**: eligible順位 18位→13位（時価総額上位15入り）
- **+UNH**: eligible順位 17位→14位（時価総額上位15入り）

**除外:** 
- **−BA**: eligible順位 10位→24位（上位15から落ち）
- **−CVX**: 赤字（TTM・filed PIT）
- **−T**: eligible順位 14位→17位（上位15から落ち）

#### 2017-07-03（入替 1 銘柄）

**追加:** 
- **+CVX**: 新規eligible化＋eligible順位 not eligible: 赤字（TTM・filed PIT）→15位（上位15入り）

**除外:** 
- **−INTC**: eligible順位 11位→18位（上位15から落ち）

#### 2017-10-02（入替 2 銘柄）

**追加:** 
- **+INTC**: eligible順位 18位→13位（時価総額上位15入り）
- **+BA**: eligible順位 23位→15位（時価総額上位15入り）

**除外:** 
- **−KO**: eligible順位 13位→16位（上位15から落ち）
- **−CMCSA**: eligible順位 14位→18位（上位15から落ち）

#### 2018-01-02（入替 1 銘柄）

**追加:** 
- **+CMCSA**: eligible順位 18位→15位（時価総額上位15入り）

**除外:** 
- **−GE**: eligible順位 8位→18位（上位15から落ち）

#### 2018-04-02（入替 1 銘柄）

**追加:** 
- **+PFE**: eligible順位 19位→15位（時価総額上位15入り）

**除外:** 
- **−CMCSA**: eligible順位 15位→18位（上位15から落ち）

#### 2018-07-02（入替 1 銘柄）

**追加:** 
- **+NFLX**: eligible順位 20位→12位（時価総額上位15入り）

**除外:** 
- **−PFE**: eligible順位 15位→16位（上位15から落ち）

#### 2018-10-01（入替 3 銘柄）

**追加:** 
- **+PFE**: eligible順位 16位→12位（時価総額上位15入り）
- **+CSCO**: 新規eligible化＋eligible順位 not eligible: 赤字（TTM・filed PIT）→13位（上位15入り）
- **+NVDA**: eligible順位 17位→15位（時価総額上位15入り）

**除外:** 
- **−NFLX**: eligible順位 12位→18位（上位15から落ち）
- **−CVX**: eligible順位 13位→17位（上位15から落ち）
- **−PG**: eligible順位 14位→16位（上位15から落ち）

#### 2019-01-02（入替 3 銘柄）

**追加:** 
- **+PG**: eligible順位 16位→10位（時価総額上位15入り）
- **+MRK**: eligible順位 20位→14位（時価総額上位15入り）
- **+KO**: eligible順位 19位→15位（時価総額上位15入り）

**除外:** 
- **−CSCO**: eligible順位 13位→16位（上位15から落ち）
- **−CERN**: eligible順位 14位→19位（上位15から落ち）
- **−NVDA**: eligible順位 15位→37位（上位15から落ち）

#### 2019-04-01（入替 2 銘柄）

**追加:** 
- **+CSCO**: eligible順位 16位→12位（時価総額上位15入り）
- **+CVX**: eligible順位 17位→14位（時価総額上位15入り）

**除外:** 
- **−PFE**: eligible順位 12位→16位（上位15から落ち）
- **−KO**: eligible順位 15位→20位（上位15から落ち）

#### 2019-07-01（入替 1 銘柄）

**追加:** 
- **+KO**: eligible順位 20位→14位（時価総額上位15入り）

**除外:** 
- **−CVX**: eligible順位 14位→17位（上位15から落ち）

#### 2019-10-01（入替 1 銘柄）

**追加:** 
- **+DIS**: 新規eligible化＋eligible順位 not eligible: 黒字不明（facts欠損等）→11位（上位15入り）

**除外:** 
- **−CSCO**: eligible順位 12位→19位（上位15から落ち）

#### 2020-01-02（入替 0 銘柄）

**追加:** なし


**除外:** なし


#### 2020-04-01（入替 2 銘柄）

**追加:** 
- **+NFLX**: eligible順位 27位→13位（時価総額上位15入り）
- **+VZ**: eligible順位 17位→15位（時価総額上位15入り）

**除外:** 
- **−BA**: 赤字（TTM・filed PIT）
- **−KO**: eligible順位 14位→16位（上位15から落ち）

#### 2020-07-01（入替 2 銘柄）

**追加:** 
- **+NVDA**: eligible順位 17位→10位（時価総額上位15入り）
- **+ADBE**: eligible順位 18位→14位（時価総額上位15入り）

**除外:** 
- **−MRK**: eligible順位 14位→16位（上位15から落ち）
- **−VZ**: eligible順位 15位→19位（上位15から落ち）

#### 2020-10-01（入替 1 銘柄）

**追加:** 
- **+CRM**: 新規eligible化＋eligible順位 not eligible: 赤字（TTM・filed PIT）→14位（上位15入り）

**除外:** 
- **−DIS**: 赤字（TTM・filed PIT）

#### 2021-01-04（入替 2 銘柄）

**追加:** 
- **+TSLA**: 新規eligible化＋eligible順位 not eligible: S&P構成外→6位（上位15入り）
- **+NKE**: eligible順位 16位→15位（時価総額上位15入り）

**除外:** 
- **−CRM**: eligible順位 14位→16位（上位15から落ち）
- **−INTC**: eligible順位 15位→20位（上位15から落ち）

#### 2021-04-01（入替 1 銘柄）

**追加:** 
- **+INTC**: eligible順位 20位→14位（時価総額上位15入り）

**除外:** 
- **−NKE**: eligible順位 15位→21位（上位15から落ち）

#### 2021-07-01（入替 1 銘柄）

**追加:** 
- **+NKE**: eligible順位 21位→15位（時価総額上位15入り）

**除外:** 
- **−INTC**: eligible順位 14位→18位（上位15から落ち）

#### 2021-10-01（入替 2 銘柄）

**追加:** 
- **+ISRG**: eligible順位 53位→9位（時価総額上位15入り）
- **+DIS**: 新規eligible化＋eligible順位 not eligible: 赤字（TTM・filed PIT）→12位（上位15入り）

**除外:** 
- **−NFLX**: eligible順位 14位→16位（上位15から落ち）
- **−NKE**: eligible順位 15位→21位（上位15から落ち）

#### 2022-01-03（入替 1 銘柄）

**追加:** 
- **+NFLX**: eligible順位 16位→15位（時価総額上位15入り）

**除外:** 
- **−ISRG**: eligible順位 9位→49位（上位15から落ち）

#### 2022-04-01（入替 3 銘柄）

**追加:** 
- **+CVX**: eligible順位 33位→13位（時価総額上位15入り）
- **+LLY**: eligible順位 23位→14位（時価総額上位15入り）
- **+ABBV**: eligible順位 30位→15位（時価総額上位15入り）

**除外:** 
- **−DIS**: eligible順位 13位→17位（上位15から落ち）
- **−ADBE**: eligible順位 14位→22位（上位15から落ち）
- **−NFLX**: eligible順位 15位→35位（上位15から落ち）

#### 2022-07-01（入替 2 銘柄）

**追加:** 
- **+META**: 新規eligible化＋eligible順位 not eligible: S&P構成外→7位（上位15入り）
- **+KO**: eligible順位 18位→14位（時価総額上位15入り）

**除外:** 
- **−FB**: 同一CIKのティッカー変更（FB→META、連続保有）
- **−ABBV**: eligible順位 15位→16位（上位15から落ち）

#### 2022-10-03（入替 0 銘柄）

**追加:** なし


**除外:** なし


#### 2023-01-03（入替 1 銘柄）

**追加:** 
- **+ABBV**: eligible順位 16位→15位（時価総額上位15入り）

**除外:** 
- **−KO**: eligible順位 15位→17位（上位15から落ち）

#### 2023-04-03（入替 1 銘柄）

**追加:** 
- **+AVGO**: eligible順位 19位→14位（時価総額上位15入り）

**除外:** 
- **−AMZN**: 赤字（TTM・filed PIT）

#### 2023-07-03（入替 2 銘柄）

**追加:** 
- **+AMZN**: 新規eligible化＋eligible順位 not eligible: 赤字（TTM・filed PIT）→4位（上位15入り）
- **+ORCL**: eligible順位 18位→14位（時価総額上位15入り）

**除外:** 
- **−CVX**: eligible順位 12位→17位（上位15から落ち）
- **−ABBV**: eligible順位 15位→22位（上位15から落ち）

#### 2023-10-02（入替 0 銘柄）

**追加:** なし


**除外:** なし


#### 2024-01-02（入替 1 銘柄）

**追加:** 
- **+COST**: eligible順位 17位→15位（時価総額上位15入り）

**除外:** 
- **−ORCL**: eligible順位 14位→16位（上位15から落ち）

#### 2024-04-01（入替 1 銘柄）

**追加:** 
- **+ORCL**: eligible順位 16位→15位（時価総額上位15入り）

**除外:** 
- **−COST**: eligible順位 15位→16位（上位15から落ち）

#### 2024-07-01（入替 2 銘柄）

**追加:** 
- **+SMCI**: eligible順位 119位→11位（時価総額上位15入り）
- **+COST**: eligible順位 16位→14位（時価総額上位15入り）

**除外:** 
- **−JNJ**: eligible順位 13位→16位（上位15から落ち）
- **−HD**: eligible順位 14位→17位（上位15から落ち）

#### 2024-10-01（入替 2 銘柄）

**追加:** 
- **+LRCX**: eligible順位 51位→7位（時価総額上位15入り）
- **+HD**: eligible順位 17位→15位（時価総額上位15入り）

**除外:** 
- **−SMCI**: eligible順位 11位→257位（上位15から落ち）
- **−COST**: eligible順位 14位→16位（上位15から落ち）

#### 2025-01-02（入替 2 銘柄）

**追加:** 
- **+COST**: eligible順位 16位→13位（時価総額上位15入り）
- **+NFLX**: eligible順位 19位→14位（時価総額上位15入り）

**除外:** 
- **−LRCX**: eligible順位 7位→76位（上位15から落ち）
- **−HD**: eligible順位 15位→16位（上位15から落ち）

#### 2025-04-01（入替 0 銘柄）

**追加:** なし


**除外:** なし


#### 2025-07-01（入替 1 銘柄）

**追加:** 
- **+JNJ**: eligible順位 16位→15位（時価総額上位15入り）

**除外:** 
- **−UNH**: eligible順位 11位→20位（上位15から落ち）

#### 2025-10-01（入替 2 銘柄）

**追加:** 
- **+PLTR**: eligible順位 18位→13位（時価総額上位15入り）
- **+ABBV**: eligible順位 17位→15位（時価総額上位15入り）

**除外:** 
- **−COST**: eligible順位 13位→16位（上位15から落ち）
- **−PG**: eligible順位 14位→18位（上位15から落ち）

#### 2026-01-02（入替 0 銘柄）

**追加:** なし


**除外:** なし


#### 2026-04-01（入替 3 銘柄）

**追加:** 
- **+BKNG**: eligible順位 47位→4位（時価総額上位15入り）
- **+COST**: eligible順位 16位→13位（時価総額上位15入り）
- **+MU**: eligible順位 18位→15位（時価総額上位15入り）

**除外:** 
- **−PLTR**: eligible順位 13位→19位（上位15から落ち）
- **−ABBV**: eligible順位 14位→18位（上位15から落ち）
- **−NFLX**: eligible順位 15位→16位（上位15から落ち）

#### 2026-07-01（入替 3 銘柄）

**追加:** 
- **+AMD**: eligible順位 20位→11位（時価総額上位15入り）
- **+AMAT**: eligible順位 28位→14位（時価総額上位15入り）
- **+LRCX**: eligible順位 29位→15位（時価総額上位15入り）

**除外:** 
- **−BKNG**: eligible順位 4位→66位（上位15から落ち）
- **−COST**: eligible順位 13位→19位（上位15から落ち）
- **−ORCL**: eligible順位 14位→20位（上位15から落ち）

#### 2026-10-01（入替 2 銘柄）

**追加:** 
- **+ABBV**: eligible順位 18位→14位（時価総額上位15入り）
- **+PLTR**: eligible順位 30位→15位（時価総額上位15入り）

**除外:** 
- **−AMAT**: eligible順位 14位→18位（上位15から落ち）
- **−LRCX**: eligible順位 15位→17位（上位15から落ち）


<details>
<summary>全リバランス日の保有15（クリックで展開）</summary>

| 日付 | 保有ティッカー |
|---|---|
| 2016-01-04 | AAPL, GOOGL, MSFT, AMZN, FB, JNJ, WMT, PG, KO, CERN, HD, BA, INTC, PFE, MRK |
| 2016-04-01 | AAPL, GOOGL, MSFT, FB, AMZN, JNJ, WMT, PG, KO, CERN, HD, VZ, INTC, T, PFE |
| 2016-07-01 | GOOGL, AAPL, MSFT, AMZN, FB, GE, JNJ, WMT, PG, CERN, KO, PFE, VZ, T, CVX |
| 2016-10-03 | AAPL, GOOGL, AMZN, MSFT, FB, JNJ, GE, WMT, PG, INTC, CERN, KO, PFE, MRK, CVX |
| 2017-01-03 | AAPL, GOOGL, MSFT, AMZN, FB, GE, JNJ, WMT, PG, BA, CVX, INTC, CERN, T, KO |
| 2017-04-03 | AAPL, GOOGL, MSFT, AMZN, FB, JNJ, GE, WMT, PG, CERN, INTC, HD, CMCSA, UNH, KO |
| 2017-07-03 | AAPL, GOOGL, MSFT, AMZN, FB, JNJ, GE, WMT, CERN, PG, UNH, HD, KO, CMCSA, CVX |
| 2017-10-02 | AAPL, GOOGL, MSFT, FB, AMZN, JNJ, WMT, GE, PG, CERN, UNH, HD, INTC, CVX, BA |
| 2018-01-02 | AAPL, GOOGL, MSFT, AMZN, FB, JNJ, BA, WMT, UNH, INTC, PG, HD, CERN, CVX, CMCSA |
| 2018-04-02 | AAPL, GOOGL, AMZN, MSFT, FB, JNJ, WMT, INTC, BA, UNH, HD, CERN, PG, CVX, PFE |
| 2018-07-02 | AAPL, AMZN, GOOGL, MSFT, FB, JNJ, WMT, UNH, INTC, BA, HD, NFLX, CVX, PG, CERN |
| 2018-10-01 | AAPL, AMZN, GOOGL, MSFT, FB, JNJ, WMT, UNH, BA, HD, INTC, PFE, CSCO, CERN, NVDA |
| 2019-01-02 | AMZN, GOOGL, MSFT, AAPL, FB, BA, JNJ, WMT, UNH, PG, INTC, PFE, HD, MRK, KO |
| 2019-04-01 | AMZN, MSFT, AAPL, GOOGL, FB, JNJ, WMT, BA, PG, INTC, UNH, CSCO, HD, CVX, MRK |
| 2019-07-01 | MSFT, AMZN, AAPL, GOOGL, FB, JNJ, WMT, PG, UNH, BA, HD, CSCO, INTC, KO, MRK |
| 2019-10-01 | MSFT, AAPL, AMZN, GOOGL, FB, WMT, JNJ, PG, HD, BA, DIS, INTC, KO, UNH, MRK |
| 2020-01-02 | AAPL, MSFT, AMZN, GOOGL, FB, BA, JNJ, WMT, DIS, PG, UNH, INTC, HD, KO, MRK |
| 2020-04-01 | MSFT, AAPL, AMZN, GOOGL, FB, WMT, JNJ, PG, UNH, INTC, DIS, HD, NFLX, MRK, VZ |
| 2020-07-01 | AAPL, MSFT, AMZN, GOOGL, FB, WMT, JNJ, PG, UNH, NVDA, HD, INTC, NFLX, ADBE, DIS |
| 2020-10-01 | AAPL, AMZN, MSFT, GOOGL, FB, WMT, NVDA, JNJ, PG, UNH, HD, ADBE, NFLX, CRM, INTC |
| 2021-01-04 | AAPL, AMZN, MSFT, GOOGL, FB, TSLA, WMT, JNJ, NVDA, UNH, PG, HD, ADBE, NFLX, NKE |
| 2021-04-01 | AAPL, MSFT, AMZN, GOOGL, FB, TSLA, JNJ, WMT, NVDA, UNH, HD, PG, NFLX, INTC, ADBE |
| 2021-07-01 | AAPL, MSFT, AMZN, GOOGL, FB, TSLA, NVDA, JNJ, WMT, UNH, HD, PG, ADBE, NFLX, NKE |
| 2021-10-01 | AAPL, MSFT, GOOGL, AMZN, FB, TSLA, NVDA, JNJ, ISRG, WMT, UNH, DIS, HD, PG, ADBE |
| 2022-01-03 | AAPL, MSFT, GOOGL, AMZN, TSLA, FB, NVDA, UNH, JNJ, WMT, HD, PG, DIS, ADBE, NFLX |
| 2022-04-01 | AAPL, MSFT, GOOGL, AMZN, TSLA, NVDA, FB, UNH, JNJ, WMT, PG, HD, CVX, LLY, ABBV |
| 2022-07-01 | GOOGL, AAPL, MSFT, AMZN, TSLA, UNH, META, JNJ, NVDA, WMT, PG, LLY, HD, KO, CVX |
| 2022-10-03 | AAPL, MSFT, GOOGL, AMZN, TSLA, UNH, JNJ, META, WMT, NVDA, LLY, PG, HD, CVX, KO |
| 2023-01-03 | AAPL, MSFT, GOOGL, AMZN, UNH, JNJ, WMT, NVDA, TSLA, META, PG, LLY, HD, CVX, ABBV |
| 2023-04-03 | AAPL, MSFT, GOOGL, NVDA, TSLA, META, UNH, WMT, JNJ, PG, LLY, CVX, HD, AVGO, ABBV |
| 2023-07-03 | AAPL, MSFT, GOOGL, AMZN, NVDA, TSLA, META, UNH, WMT, LLY, JNJ, AVGO, PG, ORCL, HD |
| 2023-10-02 | AAPL, MSFT, GOOGL, AMZN, NVDA, TSLA, META, LLY, UNH, WMT, JNJ, AVGO, PG, ORCL, HD |
| 2024-01-02 | AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA, LLY, AVGO, UNH, WMT, JNJ, PG, HD, COST |
| 2024-04-01 | MSFT, AAPL, NVDA, GOOGL, AMZN, META, LLY, AVGO, TSLA, WMT, UNH, PG, JNJ, HD, ORCL |
| 2024-07-01 | MSFT, AAPL, NVDA, GOOGL, AMZN, META, LLY, AVGO, TSLA, WMT, SMCI, UNH, ORCL, COST, PG |
| 2024-10-01 | AAPL, MSFT, NVDA, GOOGL, AMZN, META, LRCX, TSLA, LLY, AVGO, WMT, UNH, ORCL, PG, HD |
| 2025-01-02 | AAPL, NVDA, MSFT, AMZN, GOOGL, META, TSLA, AVGO, WMT, LLY, ORCL, UNH, COST, NFLX, PG |
| 2025-04-01 | AAPL, MSFT, NVDA, AMZN, GOOGL, META, TSLA, AVGO, LLY, WMT, UNH, COST, NFLX, ORCL, PG |
| 2025-07-01 | NVDA, MSFT, AAPL, AMZN, GOOGL, META, AVGO, TSLA, WMT, LLY, ORCL, NFLX, COST, PG, JNJ |
| 2025-10-01 | NVDA, MSFT, AAPL, GOOGL, AMZN, META, AVGO, TSLA, ORCL, WMT, LLY, NFLX, PLTR, JNJ, ABBV |
| 2026-01-02 | NVDA, AAPL, GOOGL, MSFT, AMZN, TSLA, AVGO, META, LLY, WMT, ORCL, JNJ, PLTR, ABBV, NFLX |
| 2026-04-01 | NVDA, AAPL, GOOGL, BKNG, MSFT, AMZN, AVGO, META, TSLA, WMT, LLY, JNJ, COST, ORCL, MU |
| 2026-07-01 | NVDA, GOOGL, AAPL, MSFT, AMZN, AVGO, TSLA, META, MU, LLY, AMD, WMT, JNJ, AMAT, LRCX |
| 2026-10-01 | NVDA, AAPL, GOOGL, MSFT, AMZN, META, AVGO, TSLA, MU, LLY, AMD, WMT, JNJ, ABBV, PLTR |

</details>

---

## (2) 追加・除外の理由（要約）

- **入り:** 原則として「その日の eligible プール（黒字・価格あり・金融/テーマ除外・株クラス1本）」の**時価総額順位が上位15入り**。
- **外れ:** (a) S&P 500から外れた (b) 赤字化（TTM net income・filed日 PIT）(c) 株価/facts 欠損 (d) 順位が15位以下に低下、など。四半期別の文言は上表。

---

## (3) 四半期ごとの手数料

| 四半期 | 注文合計 | うちスワップ系 | うちリウェイト系 | 当四半期$0.35 | 累計$0.35 | 当四半期$1 | 累計$1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2016-Q1 | 14 | 14 | 0 | $4.90 | $4.90 | $14.00 | $14.00 |
| 2016-Q2 | 2 | 2 | 0 | $0.70 | $5.60 | $2.00 | $16.00 |
| 2016-Q3 | 5 | 3 | 2 | $1.75 | $7.35 | $5.00 | $21.00 |
| 2016-Q4 | 3 | 3 | 0 | $1.05 | $8.40 | $3.00 | $24.00 |
| 2017-Q1 | 4 | 3 | 1 | $1.40 | $9.80 | $4.00 | $28.00 |
| 2017-Q2 | 4 | 4 | 0 | $1.40 | $11.20 | $4.00 | $32.00 |
| 2017-Q3 | 3 | 1 | 2 | $1.05 | $12.25 | $3.00 | $35.00 |
| 2017-Q4 | 4 | 3 | 1 | $1.40 | $13.65 | $4.00 | $39.00 |
| 2018-Q1 | 6 | 2 | 4 | $2.10 | $15.75 | $6.00 | $45.00 |
| 2018-Q2 | 2 | 1 | 1 | $0.70 | $16.45 | $2.00 | $47.00 |
| 2018-Q3 | 0 | 0 | 0 | $0.00 | $16.45 | $0.00 | $47.00 |
| 2018-Q4 | 5 | 4 | 1 | $1.75 | $18.20 | $5.00 | $52.00 |
| 2019-Q1 | 5 | 4 | 1 | $1.75 | $19.95 | $5.00 | $57.00 |
| 2019-Q2 | 3 | 2 | 1 | $1.05 | $21.00 | $3.00 | $60.00 |
| 2019-Q3 | 2 | 1 | 1 | $0.70 | $21.70 | $2.00 | $62.00 |
| 2019-Q4 | 1 | 1 | 0 | $0.35 | $22.05 | $1.00 | $63.00 |
| 2020-Q1 | 3 | 0 | 3 | $1.05 | $23.10 | $3.00 | $66.00 |
| 2020-Q2 | 4 | 3 | 1 | $1.40 | $24.50 | $4.00 | $70.00 |
| 2020-Q3 | 5 | 2 | 3 | $1.75 | $26.25 | $5.00 | $75.00 |
| 2020-Q4 | 3 | 1 | 2 | $1.05 | $27.30 | $3.00 | $78.00 |
| 2021-Q1 | 8 | 2 | 6 | $2.80 | $30.10 | $8.00 | $86.00 |
| 2021-Q2 | 0 | 0 | 0 | $0.00 | $30.10 | $0.00 | $86.00 |
| 2021-Q3 | 2 | 0 | 2 | $0.70 | $30.80 | $2.00 | $88.00 |
| 2021-Q4 | 4 | 2 | 2 | $1.40 | $32.20 | $4.00 | $92.00 |
| 2022-Q1 | 3 | 1 | 2 | $1.05 | $33.25 | $3.00 | $95.00 |
| 2022-Q2 | 4 | 4 | 0 | $1.40 | $34.65 | $4.00 | $99.00 |
| 2022-Q3 | 14 | 2 | 12 | $4.90 | $39.55 | $14.00 | $113.00 |
| 2022-Q4 | 13 | 0 | 13 | $4.55 | $44.10 | $13.00 | $126.00 |
| 2023-Q1 | 1 | 1 | 0 | $0.35 | $44.45 | $1.00 | $127.00 |
| 2023-Q2 | 9 | 2 | 7 | $3.15 | $47.60 | $9.00 | $136.00 |
| 2023-Q3 | 11 | 3 | 8 | $3.85 | $51.45 | $11.00 | $147.00 |
| 2023-Q4 | 0 | 0 | 0 | $0.00 | $51.45 | $0.00 | $147.00 |
| 2024-Q1 | 6 | 1 | 5 | $2.10 | $53.55 | $6.00 | $153.00 |
| 2024-Q2 | 2 | 0 | 2 | $0.70 | $54.25 | $2.00 | $155.00 |
| 2024-Q3 | 7 | 3 | 4 | $2.45 | $56.70 | $7.00 | $162.00 |
| 2024-Q4 | 13 | 2 | 11 | $4.55 | $61.25 | $13.00 | $175.00 |
| 2025-Q1 | 10 | 3 | 7 | $3.50 | $64.75 | $10.00 | $185.00 |
| 2025-Q2 | 0 | 0 | 0 | $0.00 | $64.75 | $0.00 | $185.00 |
| 2025-Q3 | 3 | 1 | 2 | $1.05 | $65.80 | $3.00 | $188.00 |
| 2025-Q4 | 9 | 3 | 6 | $3.15 | $68.95 | $9.00 | $197.00 |
| 2026-Q1 | 3 | 0 | 3 | $1.05 | $70.00 | $3.00 | $200.00 |
| 2026-Q2 | 16 | 4 | 12 | $5.60 | $75.60 | $16.00 | $216.00 |
| 2026-Q3 | 14 | 4 | 10 | $4.90 | $80.50 | $14.00 | $230.00 |
| 2026-Q4 | 13 | 2 | 11 | $4.55 | $85.05 | $13.00 | $243.00 |

**定義:** **スワップ系**＝そのリバランスで「前回は保有15に無かった銘柄」への新規買い、または「今回の15から外れた銘柄」の売却に伴う注文。**リウェイト系**＝継続保有銘柄のウェイト調整注文。

---

## (4) 寄与分析（2025-07-01 ～ 2026-10-02）

**方法:** 各営業日、前日終値ベースのポートフォリオウェイト × 銘柄日次リターンを積み上げ（リバランス日は目標ウェイトにリセット・手数料は本節では控除しない簡易版）。


| 銘柄 | 寄与（%ポイント） | 寄与（$・$3,200ベース） | 半導体 |
|---|---:|---:|---|
| GOOGL | +8.03pt | +$257 | — |
| NVDA | +7.30pt | +$234 | 半導体 |
| AAPL | +6.74pt | +$216 | — |
| MU | +2.49pt | +$80 | 半導体 |
| AVGO | +1.99pt | +$64 | 半導体 |
| AMZN | +1.44pt | +$46 | — |
| LLY | +1.09pt | +$35 | — |
| MSFT | +0.85pt | +$27 | — |
| TSLA | +0.83pt | +$26 | — |
| JNJ | +0.64pt | +$21 | — |
| AMD | +0.45pt | +$14 | 半導体 |
| WMT | +0.30pt | +$10 | — |
| META | +0.14pt | +$5 | — |
| ABBV | +0.02pt | +$1 | — |
| PG | -0.07pt | $-2 | — |
| COST | -0.22pt | $-7 | — |
| AMAT | -0.30pt | $-10 | 半導体 |
| PLTR | -0.32pt | $-10 | — |
| NFLX | -0.54pt | $-17 | — |
| ORCL | -0.66pt | $-21 | — |

- 期間ポートリターン: **32.56%**（単純リプレイ・差分リバランス近似）
- 同期間 SPY: **26.30%** → ギャップ **6.26pt**
- 半導体サブ業種の寄与合計: **11.93pt**（全寄与の **39%**）
- 上位1/3/5銘柄の寄与シェア: **27% / 73% / 88%**
- 上位1銘柄を除いた場合の期間リターン（寄与差し引き）: **24.52%**
- 上位3銘柄を除いた場合: **10.48%**

**解釈（ギャップの単純分解）:** 本構成は金融セクターとテーマ株を持たないため SPY より大型金融・一部超大型のウェイトが薄い。期間中は半導体・大型テックの寄与がポート側のドライバーとなり、除外セクターが SPY にあって本ポートに無い分がギャップの主因となり得る（厳密な要因分析ではない）。


![寄与（上位銘柄）](round19_v1_contribution.png)

---

## (5) 最終リバランス（2026-10-01）で持っていない銘柄

### S&P 構成員の時価総額上位40のうち、保有15外

**eligibleだが上位15外**
  - CSCO（S&P時価総額順 21位・約427B USD）
  - LRCX（S&P時価総額順 22位・約426B USD）
  - AMAT（S&P時価総額順 23位・約420B USD）
  - ORCL（S&P時価総額順 24位・約417B USD）
  - CVX（S&P時価総額順 25位・約409B USD）
  - COST（S&P時価総額順 26位・約406B USD）
  - CAT（S&P時価総額順 27位・約380B USD）
  - KO（S&P時価総額順 29位・約370B USD）
  - MRK（S&P時価総額順 30位・約355B USD）
  - DELL（S&P時価総額順 31位・約347B USD）
  - PG（S&P時価総額順 32位・約335B USD）
  - UNH（S&P時価総額順 33位・約328B USD）
  - PANW（S&P時価総額順 34位・約324B USD）
  - GE（S&P時価総額順 35位・約324B USD）
  - PM（S&P時価総額順 37位・約291B USD）
  - NFLX（S&P時価総額順 38位・約283B USD）
  - HD（S&P時価総額順 39位・約282B USD）

**株クラス重複で除外**
  - GOOG（S&P時価総額順 4位・約4096B USD）

**赤字（TTM・filed PIT）**
  - INTC（S&P時価総額順 17位・約605B USD）
  - CRWD（S&P時価総額順 40位・約272B USD）

**金融セクター除外**
  - JPM（S&P時価総額順 13位・約886B USD）
  - V（S&P時価総額順 15位・約675B USD）
  - MA（S&P時価総額順 18位・約488B USD）
  - BAC（S&P時価総額順 28位・約376B USD）
  - MS（S&P時価総額順 36位・約295B USD）

### eligible プールの16～25位（惜しくも15入りしなかった銘柄）

| eligible順位 | ティッカー | 時価総額（約・B USD） |
|---:|---|---:|
| 16 | CSCO | 427 |
| 17 | LRCX | 426 |
| 18 | AMAT | 420 |
| 19 | ORCL | 417 |
| 20 | CVX | 409 |
| 21 | COST | 406 |
| 22 | CAT | 380 |
| 23 | KO | 370 |
| 24 | MRK | 355 |
| 25 | DELL | 347 |

---

## (6) 暦年リターン vs SPY・最大ドローダウン

**暦年:** 前年最終営業日終値ベース（`calendarYearReturn`）。

| 年 | plain_15__mcap | SPY | 差 |
|---|---:|---:|---:|
| 2017 | 32.5% | 21.7% | 10.8pt |
| 2018 | 1.2% | -4.6% | 5.7pt |
| 2019 | 38.9% | 31.2% | 7.7pt |
| 2020 | 38.6% | 18.3% | 20.3pt |
| 2021 | 35.4% | 28.7% | 6.7pt |
| 2022 | -32.8% | -18.2% | -14.6pt |
| 2023 | 54.2% | 26.2% | 28.0pt |
| 2024 | 43.2% | 24.9% | 18.3pt |
| 2025 | 22.6% | 17.7% | 4.9pt |
| 2026 | 11.3% | 13.7% | -2.5pt |

### 最大ドローダウン（2016-01-01–2026-10-02）

| | 採用構成 | SPY |
|---|---|---|
| ピーク日 | 2022-01-03 | 2020-02-19 |
| ボトム日 | 2023-01-05 | 2020-03-23 |
| 深さ | -36.1% | -33.7% |
| 回復 | 2023-11-16 | 2020-08-10 |
| 回復営業日数 | 218 | 97 |

**OOS 期間のみの MaxDD:** 採用 **-36.1%**（ピーク 2022-01-03 → ボトム 2023-01-05） vs SPY **-24.5%** — 事前登録合格②は **不合格**。

上表の全期間最大 DD は主に **2022–2023 の株式調整**（ピーク **2022-01-03**、ボトム **2023-01-05**、回復 **2023-11-16**）に由来する。深掘りは **落ち込み分析**。

---


## 落ち込み分析（事実 vs 解釈）

Emma 依頼の DD 深掘り。**事実**はシミュレーション・価格から機械集計、**解釈**は単純アトリビューション（因果の証明ではない）。

### C1. OOS 期間の最大ドローダウン（2021-01-01 以降・深さ -36.1%）


### OOS MaxDD 局面（ピーク→ボトム）

**事実 — ドローダウン形状**

| | 採用構成 | SPY（同じ評価窓） |
|---|---|---|
| ピーク日 | 2022-01-03 | 2022-01-03 |
| ボトム日 | 2023-01-05 | 2022-10-12 |
| 深さ | -36.08% | -24.50% |
| 回復日 | 2023-11-16 | 2023-12-13 |
| ピーク→ボトム（営業日） | 253 | 195 |
| ボトム→回復（営業日） | 218 | 294 |



**事実 — バスケット（直近リバランス日 ≦ ピーク / ボトム）**

| | 日付 | 保有15 |
|---|---|---|
| ピーク付近 | 2022-01-03 | AAPL, MSFT, GOOGL, AMZN, TSLA, FB, NVDA, UNH, JNJ, WMT, HD, PG, DIS, ADBE, NFLX |
| ボトム付近 | 2023-01-03 | AAPL, MSFT, GOOGL, AMZN, UNH, JNJ, WMT, NVDA, TSLA, META, PG, LLY, HD, CVX, ABBV |


**事実 — 寄与（ウェイト×日次リターン、手数料除く）** 2022-01-03 ～ 2023-01-05

| 銘柄 | 寄与 | $（3,200 ベース） | 半導体 | GICSセクター |
|---|---:|---:|---|---|
| TSLA | -8.02pt | $-257 | — | Consumer Discretionary |
| AMZN | -7.38pt | $-236 | — | Consumer Discretionary |
| AAPL | -7.36pt | $-236 | — | Information Technology |
| GOOGL | -5.97pt | $-191 | — | Communication Services |
| MSFT | -4.99pt | $-160 | — | Information Technology |
| FB | -3.77pt | $-121 | — | — |
| NVDA | -2.58pt | $-83 | 半導体 | Information Technology |
| HD | -0.59pt | $-19 | — | Consumer Discretionary |
| ADBE | -0.37pt | $-12 | — | Information Technology |
| META | -0.36pt | $-11 | — | Communication Services |
| DIS | -0.26pt | $-8 | — | Communication Services |
| WMT | -0.15pt | $-5 | — | Consumer Staples |

- 窓のポートリターン: **-36.08%**；同期間 SPY: **-19.30%**（ギャップ **-16.78pt**）
- 半導体サブ業種の寄与合計: **-2.58pt**（マイナス寄与合計に占める比率 **6%**）
- マイナス寄与の集中度（上位1/3/5銘柄シェア）: **19% / 54% / 81%**
- カウンターファクト（マイナス寄与上位銘柄を除いた窓リターン・単純）: 上位1除く **-28.05%**、上位3除く **-13.31%**、上位5除く **-2.35%**

**事実 — セクター寄与（マイナス寄与のみ抜粋）**

- **Consumer Discretionary**: -15.99pt
- **Information Technology**: -15.29pt
- **Communication Services**: -6.58pt
- **不明**: -3.77pt
- **Consumer Staples**: -0.04pt

**解釈（単純アトリビューション・因果証明ではない）:** 本ポートは金融セクターとテーマ株を持たないため、SPY が持つ大型金融・ディフェンシブのウェイトが薄い。同期間でテック／半導体のマイナス寄与が大きい場合、SPY より深い DD や暦年負けが出やすい。逆に SPY 側にあって本ポートに無いセクターが相対的に下支えした場合、ギャップはそちらに帰着し得る。




### 暦年 2022（2021-12-31 ～ 2022-12-30・ポート -32.8% vs SPY -18.2%）

**事実 — ドローダウン形状**

| | 採用構成 | SPY（同じ評価窓） |
|---|---|---|
| ピーク日 | 2022-01-03 | 2022-01-03 |
| ボトム日 | 2022-12-28 | 2022-10-12 |
| 深さ | -35.41% | -24.50% |
| 回復日 | 未回復 | 未回復 |
| ピーク→ボトム（営業日） | 248 | 195 |
| ボトム→回復（営業日） | — | — |



**事実 — バスケット（直近リバランス日 ≦ ピーク / ボトム）**

| | 日付 | 保有15 |
|---|---|---|
| ピーク付近 | 2022-01-03 | AAPL, MSFT, GOOGL, AMZN, TSLA, FB, NVDA, UNH, JNJ, WMT, HD, PG, DIS, ADBE, NFLX |
| ボトム付近 | 2022-10-03 | AAPL, MSFT, GOOGL, AMZN, TSLA, UNH, JNJ, META, WMT, NVDA, LLY, PG, HD, CVX, KO |


**事実 — 寄与（ウェイト×日次リターン、手数料除く）** 2021-12-31 ～ 2022-12-30

| 銘柄 | 寄与 | $（3,200 ベース） | 半導体 | GICSセクター |
|---|---:|---:|---|---|
| AMZN | -7.03pt | $-225 | — | Consumer Discretionary |
| TSLA | -6.65pt | $-213 | — | Consumer Discretionary |
| AAPL | -6.06pt | $-194 | — | Information Technology |
| GOOGL | -5.68pt | $-182 | — | Communication Services |
| FB | -3.73pt | $-119 | — | — |
| MSFT | -3.72pt | $-119 | — | Information Technology |
| NVDA | -2.36pt | $-76 | 半導体 | Information Technology |
| HD | -0.63pt | $-20 | — | Consumer Discretionary |
| META | -0.54pt | $-17 | — | Communication Services |
| ADBE | -0.38pt | $-12 | — | Information Technology |
| DIS | -0.26pt | $-8 | — | Communication Services |
| WMT | -0.19pt | $-6 | — | Consumer Staples |

- 窓のポートリターン: **-32.76%**；同期間 SPY: **-18.18%**（ギャップ **-14.58pt**）
- 半導体サブ業種の寄与合計: **-2.36pt**（マイナス寄与合計に占める比率 **6%**）
- マイナス寄与の集中度（上位1/3/5銘柄シェア）: **19% / 53% / 78%**
- カウンターファクト（マイナス寄与上位銘柄を除いた窓リターン・単純）: 上位1除く **-25.73%**、上位3除く **-13.02%**、上位5除く **-3.61%**

**事実 — セクター寄与（マイナス寄与のみ抜粋）**

- **Consumer Discretionary**: -14.30pt
- **Information Technology**: -12.52pt
- **Communication Services**: -6.48pt
- **不明**: -3.73pt
- **Consumer Staples**: -0.06pt

**解釈（単純アトリビューション・因果証明ではない）:** 本ポートは金融セクターとテーマ株を持たないため、SPY が持つ大型金融・ディフェンシブのウェイトが薄い。同期間でテック／半導体のマイナス寄与が大きい場合、SPY より深い DD や暦年負けが出やすい。逆に SPY 側にあって本ポートに無いセクターが相対的に下支えした場合、ギャップはそちらに帰着し得る。



### C2. ライブ窓 2026-07-30 ～ 2026-10-02 のドローダウン

（下記ライブ窓の USD/JPY 曲線に基づく — §(7) と同一シミュレーション）




### ライブ窓 USD MaxDD

**事実 — ドローダウン形状**

| | 採用構成 | SPY（同じ評価窓） |
|---|---|---|
| ピーク日 | 2026-08-07 | 2026-08-13 |
| ボトム日 | 2026-08-24 | 2026-09-16 |
| 深さ | -3.13% | -3.06% |
| 回復日 | 2026-09-03 | 未回復 |
| ピーク→ボトム（営業日） | 11 | 23 |
| ボトム→回復（営業日） | 8 | — |

**事実:** 期間リターン USD **9.45%**、円建て **5.84%**（USD/JPY 163.30→157.93）。

**事実 — バスケット（直近リバランス日 ≦ ピーク / ボトム）**

| | 日付 | 保有15 |
|---|---|---|
| ピーク付近 | 2026-07-01 | NVDA, GOOGL, AAPL, MSFT, AMZN, AVGO, TSLA, META, MU, LLY, AMD, WMT, JNJ, AMAT, LRCX |
| ボトム付近 | 2026-07-01 | NVDA, GOOGL, AAPL, MSFT, AMZN, AVGO, TSLA, META, MU, LLY, AMD, WMT, JNJ, AMAT, LRCX |


**事実 — 寄与（ウェイト×日次リターン、手数料除く）** 2026-08-07 ～ 2026-08-24

| 銘柄 | 寄与 | $（2,835.273 ベース） | 半導体 | GICSセクター |
|---|---:|---:|---|---|
| NVDA | -1.25pt | $-35 | 半導体 | Information Technology |
| AVGO | -1.07pt | $-30 | 半導体 | Information Technology |
| AMZN | -0.43pt | $-12 | — | Consumer Discretionary |
| MSFT | -0.28pt | $-8 | — | Information Technology |
| META | -0.27pt | $-8 | — | Communication Services |
| GOOGL | -0.24pt | $-7 | — | Communication Services |
| AMD | -0.14pt | $-4 | 半導体 | Information Technology |
| WMT | -0.13pt | $-4 | — | Consumer Staples |
| AAPL | -0.12pt | $-4 | — | Information Technology |

- 窓のポートリターン: **-3.13%**；同期間 SPY: **-1.27%**（ギャップ **-1.87pt**）
- 半導体サブ業種の寄与合計: **-2.34pt**（マイナス寄与合計に占める比率 **59%**）
- マイナス寄与の集中度（上位1/3/5銘柄シェア）: **32% / 70% / 84%**
- カウンターファクト（マイナス寄与上位銘柄を除いた窓リターン・単純）: 上位1除く **-1.89%**、上位3除く **-0.39%**、上位5除く **0.17%**

**事実 — セクター寄与（マイナス寄与のみ抜粋）**

- **Information Technology**: -2.74pt
- **Communication Services**: -0.51pt
- **Consumer Discretionary**: -0.17pt
- **Consumer Staples**: -0.13pt

**解釈（単純アトリビューション・因果証明ではない）:** 本ポートは金融セクターとテーマ株を持たないため、SPY が持つ大型金融・ディフェンシブのウェイトが薄い。同期間でテック／半導体のマイナス寄与が大きい場合、SPY より深い DD や暦年負けが出やすい。逆に SPY 側にあって本ポートに無いセクターが相対的に下支えした場合、ギャップはそちらに帰着し得る。



### ライブ窓 円建て MaxDD（日次 USD 資産×USD/JPY）

**事実 — ドローダウン形状**

| | 採用構成 |
|---|---|
| ピーク日 | 2026-08-13 |
| ボトム日 | 2026-09-09 |
| 深さ | -4.39% |
| 回復日 | 2026-09-21 |
| ピーク→ボトム（営業日） | 18 |
| ボトム→回復（営業日） | 8 |



**事実 — バスケット（直近リバランス日 ≦ ピーク / ボトム）**

| | 日付 | 保有15 |
|---|---|---|
| ピーク付近 | 2026-07-01 | NVDA, GOOGL, AAPL, MSFT, AMZN, AVGO, TSLA, META, MU, LLY, AMD, WMT, JNJ, AMAT, LRCX |
| ボトム付近 | 2026-07-01 | NVDA, GOOGL, AAPL, MSFT, AMZN, AVGO, TSLA, META, MU, LLY, AMD, WMT, JNJ, AMAT, LRCX |


**事実 — 寄与（ウェイト×日次リターン、手数料除く）** 2026-08-13 ～ 2026-09-09

| 銘柄 | 寄与 | $（463,000 ベース） | 半導体 | GICSセクター |
|---|---:|---:|---|---|
| AVGO | -0.83pt | $-3825 | 半導体 | Information Technology |
| GOOGL | -0.61pt | $-2841 | — | Communication Services |
| AMZN | -0.45pt | $-2070 | — | Consumer Discretionary |
| WMT | -0.25pt | $-1160 | — | Consumer Staples |
| LLY | -0.24pt | $-1119 | — | Health Care |
| NVDA | -0.11pt | $-507 | 半導体 | Information Technology |
| MSFT | -0.09pt | $-409 | — | Information Technology |

- 窓のポートリターン: **-0.75%**；同期間 SPY: **-1.99%**（ギャップ **1.24pt**）
- 半導体サブ業種の寄与合計: **-0.46pt**（マイナス寄与合計に占める比率 **18%**）
- マイナス寄与の集中度（上位1/3/5銘柄シェア）: **32% / 73% / 92%**
- カウンターファクト（マイナス寄与上位銘柄を除いた窓リターン・単純）: 上位1除く **0.08%**、上位3除く **1.14%**、上位5除く **1.63%**

**事実 — セクター寄与（マイナス寄与のみ抜粋）**

- **Consumer Staples**: -0.25pt
- **Health Care**: -0.19pt
- **Communication Services**: -0.13pt
- **Consumer Discretionary**: -0.08pt
- **Information Technology**: -0.05pt

**解釈（単純アトリビューション・因果証明ではない）:** 本ポートは金融セクターとテーマ株を持たないため、SPY が持つ大型金融・ディフェンシブのウェイトが薄い。同期間でテック／半導体のマイナス寄与が大きい場合、SPY より深い DD や暦年負けが出やすい。逆に SPY 側にあって本ポートに無いセクターが相対的に下支えした場合、ギャップはそちらに帰着し得る。




---

## (7) ライブ窓シミュレーション（2026-07-30 ～ 2026-10-02）


**窓:** 2026-07-30 終値時点で **¥463,000** を USD へ換算し投資（USD/JPY **163.30** → 2026-10-02 時点 **157.93**）。  
**保有の起点:** 2026-07-01 リバランスの採用15（plain_15__mcap）。**2026-10-02** までに **2026-10-01** リバランスを適用。手数料 **$0.35/注文**（差分リバランス）。

| | USD建て | 円建て（日次 USD/JPY で換算） |
|---|---:|---:|
| 期間リターン | 9.45% | 5.84% |
| 最大DD | -3.13%（ピーク 2026-08-07 → ボトム 2026-08-24） | -4.39%（ピーク 2026-08-13 → ボトム 2026-09-09） |

**ベンチマーク（同じ USD 初期額）**

| 指数 | USD | 円建て |
|---|---:|---:|
| SPY | 4.03% | 0.60% |
| QQQ | — | — |
| SOXX | — | — |

**Emma 実績（参考・計算基準未確認）:** 約 **+10.9%**、最大 DD 約 **-6%**。

**修正前データでの暫定値（独立チェック時点・参考）:** Saka **+6.32%** USD / **+2.82%** 円、DD **-2.80%** USD / **-5.88%** 円；SPY +4.01/+0.59；QQQ +9.76/+6.15；SOXX +16.78/+12.94（USD/JPY 163.30→157.93）。


---

## (A) 選定・フィルタ規則一覧（コード根拠）


本レポートの採用構成は **`plain_15__mcap`**（選定=`plain`・N=15・ウェイト=`mcap`）。以下は **時価総額順位以外**の全フィルタ／変換をコード行番号付きで列挙する（`src/lib/round19-saka.ts` ほか）。

### 1. ユニバース（S&P 500・PIT 構成）

| 規則 | 実装 |
|---|---|
| リバランス日 `d` に **S&P 500 構成銘柄**のみ | `membersOnDate`（`src/lib/sp500-pit.ts:93-100`）— `sp500_ticker_start_end.csv` の `startDate`/`endDate` で PIT 判定（`isSp500MemberOnDate` `sp500-pit.ts:84-90`） |
| ウォッチリスト（`data/watchlist.yaml`）は **不使用** | 事前登録 `docs/ROUND19_PREREG_ja.md`・スタディは PIT S&P のみ |

### 2. テーマ／銘柄除外（eligible 前）

| 規則 | 実装 |
|---|---|
| **ONDS** は常に除外 | `isExcludedTheme` `round19-saka.ts:73-77` |
| **solar / crypto / nuclear / quantum / space** テーマ銘柄を除外 | 同上 + `themeOf`（`src/lib/themes.ts:60-66`） |
| テーマ定義リスト | SOLAR/CRYPTO/NUCLEAR/QUANTUM/SPACE 定数（`themes.ts:8-46`）。**SPCX** は `THEME_KEEP` でテーマ扱いしない（`themes.ts:48,62`）— space テーマだが **S&P 用バックテストでは space 除外リストに SPCX は含めない**（`themeOf` が null） |
| **Financials** セクター除外 | `isFinancialSector` `round19-saka.ts:79-81`（GICS sector === `"Financials"`） |

### 3. 黒字（profitability）— TTM・filed PIT

| 規則 | 実装 |
|---|---|
| 状態 | `profitabilityStatus` `round19-saka.ts:24-29` → `profitable` / `loss` / `unknown` |
| **eligible には `profitable` のみ**（`unknown`・`loss` は除外） | `filterEligibleCandidates` `round19-saka.ts:531-539`（`ctx.profitable`） |
| TTM net income | 直近 **4 四半期**（10-K/20-F/40-F 除く）の `NetIncomeLoss` 等を合算（`ttmNetIncomePitAudit` `round19-saka.ts:908-937`） |
| PIT | 各四半期ファクトは **`filed` 日 ≤ リバランス日`** のみ（`factFiledOnOrBefore` `round19-saka.ts:887-891`） |
| facts 欠損 | `unknown` → **採用プール外**（赤字扱いにしない） |

### 4. 価格・時価総額・データ

| 規則 | 実装 |
|---|---|
| **当日以前の終値が無い銘柄は除外** | `hasPrice` / `filterEligibleCandidates` `round19-saka.ts:537` |
| **別途出来高・流動性フィルタは無し** | 価格存在のみ |
| 時価総額 `mcap`（PIT） | `pit-mcap.ts`：調整後終値 `c` × EDGAR 株数（ファクト `end` 以降の **Yahoo split で forward 補正**、過大株数は 120 日前比で deflate） |
| `mcap ≤ 0` は **plain 選定で上位15に入らない** | `pickHoldings` `round19-saka.ts:555-559`（`.filter((r) => r.m > 0)`） |

### 5. 株クラス重複（同一 CIK）

| 規則 | 実装 |
|---|---|
| eligible 整列後 **CIK ごとに1ティッカー** | `dedupeShareClassesByCik` `pit-share-class.ts:18-37`（`filterEligibleCandidates` `round19-saka.ts:542-543`） |
| 優先ティッカー表 | `PREFERRED_OVER`（例 GOOG→GOOGL）`pit-share-class.ts:2-8`；同 CIK は **mcap 高い方**を残す |

### 6. 採用構成の「選定」(`plain`) — 時価総額順

| 規則 | 実装 |
|---|---|
| eligible の **mcap 降順**で先頭 **15** | `pickHoldings` `plain` 分岐 `round19-saka.ts:555-559` |
| ※ `corrdiverse` / `volprune` は **本採用では未使用**（252日相関 greedy・ρ>0.7 等は `round19-saka.ts:546-554, 291-374`） |

### 7. ウェイト（`mcap`）と半導体 30% キャップ

| 規則 | 実装 |
|---|---|
| まず **mcap 比例** | `targetWeights` `round19-saka.ts:585-593` |
| **単一銘柄 —% 上限**（超過は他銘柄へ再分配） | `applySingleNameCap` `round19-saka.ts:596-597`・アルゴ `407-428` |
| **半導体サブ業種**（GICS Sub-Industry に `"semiconductor"` を含む）のウェイト合計 **≤ 30%** | `isSemiSubIndustry` `round19-saka.ts:68-71`；`applySemiCap` `round19-saka.ts:431-448`（`SAKA_SEMI_CAP = 0.3` `16`）— 超過分は半導体をスケールダウンし、**非半導体に按分**（`442-447`） |

### 8. リバランス・手数料（シミュレーション）

| 規則 | 実装 |
|---|---|
| 四半期初の **最初の営業日** | `rebalanceDates` `round19-saka.ts:601-613` |
| **差分リバランス**（継続保有の微小調整はスキップ） | `simulateSaka` `rebalance: "delta"`；`|Δ$| < $25` **かつ** 相対ドリフト < **20%** ならスキップ（`round19-saka.ts:17-19, 749-750, 839-868`） |
| 手数料 | **$0.35/注文**（本レポート） |
| 初期資金 | `SAKA_INITIAL_CASH = 3200` `round19-saka.ts:11` |

### 9. In-sample 採用（30構成グリッド・本レポート外の選定手順）

| 規則 | 実装 |
|---|---|
| IS 2016-01-01～2020-12-31（`SAKA_IS_END` `9`） | |
| IS **MaxDD が SPY より浅い**構成のみ | `selectSakaConfig` `round19-saka.ts:706-716` |
| 残りから **IS CAGR 最大**、同点は **ターンオーバー低** | 同上 `712-715` |


---

## (B) 保有相関・SPY 相関／β


**対象:** 採用 `plain_15__mcap` の各リバランス日時点の **保有15**（ウェイトは `targetWeights` 適用後）。

**保有間相関（中央値・平均）:** 各銘柄の **252 営業日**対数リターン（`SAKA_CORR_LOOKBACK` `round19-saka.ts:12`）を **日付揃え**（`pearsonOnAlignedSeries` `147-159`）し、15銘柄の **上三角ペア相関の中央値・平均**（`medianPairwiseCorr` / `meanPairwiseCorr`）。最低 **126** 観測（`SAKA_CORR_MIN_OBS` `13`）。

**ポートフォリオ vs SPY:** リバランス日の **固定ウェイト**で日次ポート対数リターン（`Σ w_i r_i`）を構成し、同日 SPY 対数リターンと **Pearson 相関・β（OLS）**。
- **1年:** 直近 **252 営業日**（リバランス日を含む終端ウィンドウ）
- **全期間:** `2016-01-01` 以降の最初の営業日～リバランス日（同じウェイト仮定・バックテスト平均行は各四半期スナップショットの算術平均）

### 直近4リバランス

| リバランス日 | ρ中央値 | ρ平均 | ρ(ポート,SPY) 1y | β vs SPY 1y | ρ(ポート,SPY) 全期間 | β vs SPY 全期間 |
|---|---:|---:|---:|---:|---:|---:|
| 2026-01-02 | 0.324 | 0.284 | 0.930 | 1.313 | — | — |
| 2026-04-01 | 0.311 | 0.282 | 0.950 | 1.221 | 0.899 | 1.259 |
| 2026-07-01 | 0.199 | 0.185 | 0.909 | 1.439 | 0.884 | 1.321 |
| 2026-10-01 | 0.150 | 0.123 | 0.912 | 1.406 | — | — |

### 全リバランス平均（44 四半期）

| | ρ中央値 | ρ平均 | ρ(ポート,SPY) 1y | β vs SPY 1y | ρ(ポート,SPY) 全期間 | β vs SPY 全期間 |
|---|---:|---:|---:|---:|---:|---:|
| 平均 | 0.340 | 0.346 | 0.890 | 1.191 | 0.880 | 1.116 |


---

## (C) 事前登録と 2021+ データの関係（証跡）


### コミット年表（抜粋・JST）

| hash | 日時 (JST) | メッセージ |
|---|---|---|
| `ad777dc` | 2026/10/4 20:57:18 JST | docs(round19): preregister Saka Index study before any runs |
| `6e3ad93` | 2026/10/4 20:59:19 JST | docs(round19): prereg amendment — weight grid, PIT mcap, IS selection (pre-results) |
| `487152e` | 2026/10/4 21:42:23 JST | feat(round19): Saka Index — 30-config grid, PIT SP500, EDGAR mcap, report |
| `05e2d3e` | 2026/10/5 5:06:55 JST | fix(round19): full CIK map, unknown profitability, delta rebalance, corrected v1 audit |
| `e2380b8` | 2026/10/5 5:51:56 JST | feat(pit): dataset rebuild, PIT filed profitability, share-class dedup, audit v2 |
| `09acebc` | 2026/10/5 7:32:51 JST | feat(pit): resolve 745 CIKs, price aliases, coverage push; rerun Corrected v1 |
| `e2a2aec` | 2026/10/5 8:26:41 JST | Fix META shares and XOM CIK; add PIT checks and live-window detail |
| `216dfc6` | 2026/10/5 8:42:38 JST | docs(round19): add criteria, correlation, and prereg evidence to v1 detail report |
| `8d54900` | 2026/10/5 19:36:04 JST | fix(round19): PIT mcap ranking and same-CIK handoffs |

### 事前登録と OOS 結果の時間順

- **`ad777dc` / `6e3ad93`**（2026-10-04 夜 JST）: `docs/ROUND19_PREREG_ja.md` の初版と追補（30構成・IS 採用規則・半導体30%・PIT mcap 等）。**いずれも `487152e`（初回スタディ結果）より前**。
- **`487152e`**: 初回 `round19-saka-study` 実行・`docs/ROUND19_ja.md` 等の **結果コミット**（同一日・登録の約45分後 UTC）。

### 正直な限界（過大評価しない）

1. **IS 採用規則そのもの**（IS DD < SPY → IS CAGR 最大）は事前登録どおりだが、**OOS 表は初回スタディ（`487152e`）以降、リポジトリ内で繰り返し参照・再掲されている**。完全な「OOS を一度も見ずに固定」は、**結果コミット後の読者視点では成立しない**。
2. **Corrected v1 データ修正**（`05e2d3e` filed PIT 黒字、`e2380b8` PIT データセット、`09acebc` CIK/価格拡充、`e2a2aec` META/XOM）は **2021+ のバックテスト数字を見た後**に入った。これは **ルール変更ではなくデータ修正**が主だが、**IS を再計算すると採用 ID が変わる**（例: `plain_15__equal` → `plain_15__mcap_cap5`、`ROUND19_AUDIT_ja.md` / 本レポート）。
3. **差分リバランス**（$25 / 20%）は `05e2d3e` 以降の corrected v1 シミュレーションで使う。事前登録本文は主にフル清算想定；**実装・Corrected v1 は delta**（`round19-corrected-v1-study.ts` の `simOpts`）。
4. **半導体 30% キャップ**は追補 `6e3ad93` で **結果コミット前**に文書化（`applySemiCap` は `487152e` からコードに存在）。
5. **テーマリスト**（quantum 等）は `themes.ts` の watchlist 系コミットと同日の研究フロー。**Saka バックテスト専用の独立 prereg ではない**（ただし `isExcludedTheme` が参照するリストはコードで固定）。
6. **本レポートの採用構成**はデータ修正後の **再選定結果**を記載。OOS 順位・CAGR は **データ版に依存**する。
7. **STOP-SHIP / 確定版データ修正**（`8d54900`）: NVDA/GOOGL/SMCI/ISRG 等の **リバランス近傍スプリット**、Yahoo 参照クロスチェック、リバランス監査 0 失敗。**ルール文字列は IS 期間で固定したつもりでも、OOS を見た後のデータ修正で IS 再計算が走るため「IS だけで完全凍結」とは言えない**（採用 ID は今回 `plain_15__mcap` で維持）。

**結論:** 「2016–2020 のみでルールを決め、2021+ は一度だけ評価」は **手順として事前登録されている**が、**データ修正と再実行により採用構成は初回結果（`plain_15__equal`）と異なる**。OOS を **設計に使った**というより、**公開後にデータを直し IS をやり直した**のが正確。確定版は **データゲート合格後**のスナップショット。


---

## 解釈（全体）

- **plain_15__mcap** は eligible 時価総額上位 15 の **mcap 比例ウェイト**（単一銘柄キャップなし）＋ **半導体サブ業種 30% 上限**。
- Corrected v1 のデータ拡充で eligible が増え、四半期漏斗の「価格なし」は後年ほぼ解消（詳細は `ROUND19_AUDIT_ja.md`）。
- v2（ウォークフォワード主評価）は **DRAFT のみ・未実行**・本レポートの対象外。

*生成: `npx tsx scripts/round19-v1-detail-report.ts`（確定版ゲート: split/audit/Yahoo ref テスト合格後）*
