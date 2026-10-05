# Round 19 Corrected v1 — 採用構成の詳細レポート

**対象:** Corrected v1 再実行（事前登録 `6e3ad93`・差分リバランス・PIT データ）  
**採用構成 ID:** `plain_15__mcap`（IS 2016–2020 を `selectSakaConfig` で再計算した直近の選定結果。**STOP-SHIP データ修正後も採用 ID は再び変わる可能性がある** — 本稿は確定版ではない。）  
**初期資金:** $3200　**手数料（主計算）:** $0.35/注文  
**データ:** `data/.cache/pit/`（`docs/DATA_PIT_ja.md`）

### ヘッドライン（採用構成 vs SPY・差分リバランス $0.35/注文）

| 期間 | 採用 CAGR | SPY CAGR | 採用 MaxDD | SPY MaxDD |
|---|---:|---:|---:|---:|
| IS (2016–2020) | 21.69% | 15.42% | -28.17% | -33.72% |
| OOS (2021–2026) | 18.15% | 15.18% | -34.99% | -24.50% |

**OOS 最大ドローダウン（重要）:** 採用構成の OOS MaxDD **-35.0%** は SPY **-24.5%** より**深い（悪化）**。Emma 事前登録の合格基準②「OOS DD < SPY」は **満たさない**。

全期間の最大 DD 局面（採用曲線）: ピーク **2022-01-03** → ボトム **2023-01-05**（深さ -35.0%）→ 回復 **2023-11-20**。

### 事前登録合格基準（OOS・$0.35・`ROUND19_PREREG_ja.md`）

| # | 基準 | 採用 | SPY/参照 | 判定 |
|---|---|---:|---:|---|
| 1 | OOS CAGR ≥ 10% | 18.2% | — | **合格** |
| 2 | OOS MaxDD **が SPY より浅い** | -35.0% | -24.5% | **不合格** |
| 3 | 暦年プラス比率 ≥ 70%（OOS 暦年） | 80% | — | **合格** |

### 採用構成のデータ版別変遷


| データ版 (git) | 採用構成 ID | 備考 |
|---|---|---|
| `e2380b8` | `plain_15__equal` | filed PIT 黒字・初回 corrected v1 PIT データ |
| `216dfc6` | `plain_15__mcap_cap5` | 詳細レポート初版（mcap 順位バグ残存） |
| `fe6c787` | `plain_20__mcap_cap10` | mcapC・ATVI/CERN 修正後 IS 再採用 |
| `cc6ffaa` | `plain_15__mcap` | HOLX 株数・XOM CIK 一貫 |
| `5e4d306` | `plain_15__mcap` | **株価×株数スプリット整合**（Yahoo splits + forward 株数） |


---

## 事実と解釈の区別

- **事実:** シミュレーション・EDGAR・価格キャッシュから機械的に数えた値。
- **解釈:** 因果や「なぜそうなったか」の平易な説明（検証可能な単純分解を含む）。

---

## データ修正（META 株数・XOM CIK）


**(a) META 株数:** `dei:EntityCommonStockSharesOutstanding` 欠損時は `us-gaap` の加重平均株数へフォールバック（`pit-shares.ts`）。2026-10-01 時点株数: **2,538,000,000**。

**(b) XOM CIK:** `data/pit_cik_overrides.json` で **34088**（Exxon Mobil）。黒字判定 2026-10-01: **profitable**。

| チェック | 結果 |
|---|---|
| CIK↔SEC 不一致（全 PIT 履歴銘柄） | **1** |
| GICS CSV CIK≠解決後 CIK（2026-10-01 構成員） | **1**（XOM:2115436→34088） |
| リバランス日・mcap=0（価格あり） | 直近サンプル: [{"date":"2026-07-01","tickers":["ERIE","HONA","STZ"]},{"date":"2026-10-01","tickers":["ERIE","STZ"]}] |

**主要リバランス日の採用15（PIT mcap・Yahoo スプリット整合後）:** 詳細は §(1)。検証: `pit-mcap-top30-validation.test.ts`（NVDA/AVGO/META が 2025-01-02・2026-10-01 で eligible 上位10）。

| 日付 | 採用15（先頭5銘柄） |
|---|---|
| 2024-07-01 | MSFT, AAPL, NVDA, GOOGL, AMZN … |
| 2025-01-02 | AAPL, NVDA, MSFT, AMZN, GOOGL … |
| 2026-10-01 | MSFT, AMZN, META, AVGO, TSLA … |


---

## (1) 四半期ごとの保有履歴（2016–2026）

各リバランス日: 保有銘柄数、追加・除外ティッカー、**入替銘柄数**（追加数＝除外数）、注文内訳は (3) と一致。

| リバランス日 | 保有数 | 追加 | 除外 | 入替数 | スワップ注文 | リウェイト注文 | 手数料$0.35 |
|---|---:|---|---|---:|---:|---:|---:|
| 2016-01-04 | 15 | AAPL, GOOGL, MSFT, AMZN, FB, JNJ, XOM, WMT, PG, ORCL, BA, KO, HD, INTC, PFE | — | 15 | 14 | 0 | $4.90 |
| 2016-04-01 | 15 | VZ, T | BA, PFE | 2 | 2 | 0 | $0.70 |
| 2016-07-01 | 15 | GE, PFE | HD, INTC | 2 | 4 | 1 | $1.75 |
| 2016-10-03 | 15 | INTC, CVX | VZ, T | 2 | 2 | 0 | $0.70 |
| 2017-01-03 | 15 | BA, UNH | KO, PFE | 2 | 4 | 1 | $1.75 |
| 2017-04-03 | 15 | HD, KO | BA, CVX | 2 | 3 | 1 | $1.40 |
| 2017-07-03 | 15 | CMCSA | INTC | 1 | 1 | 2 | $1.05 |
| 2017-10-02 | 15 | INTC, CVX | KO, CMCSA | 2 | 2 | 0 | $0.70 |
| 2018-01-02 | 15 | BA | GE | 1 | 1 | 4 | $1.75 |
| 2018-04-02 | 15 | — | — | 0 | 0 | 0 | $0.00 |
| 2018-07-02 | 15 | NFLX | PG | 1 | 1 | 1 | $0.70 |
| 2018-10-01 | 15 | CSCO, NVDA | NFLX, CVX | 2 | 3 | 2 | $1.75 |
| 2019-01-02 | 15 | PG, PFE, KO | ORCL, CSCO, NVDA | 3 | 5 | 4 | $3.15 |
| 2019-04-01 | 15 | CSCO, ORCL | PFE, KO | 2 | 3 | 1 | $1.40 |
| 2019-07-01 | 15 | — | — | 0 | 0 | 0 | $0.00 |
| 2019-10-01 | 15 | DIS, KO | CSCO, ORCL | 2 | 4 | 1 | $1.75 |
| 2020-01-02 | 15 | — | — | 0 | 0 | 1 | $0.35 |
| 2020-04-01 | 15 | NFLX, VZ, MRK | BA, XOM, KO | 3 | 5 | 0 | $1.75 |
| 2020-07-01 | 15 | ADBE, ORCL | VZ, MRK | 2 | 2 | 1 | $1.05 |
| 2020-10-01 | 15 | CRM, NKE | DIS, ORCL | 2 | 2 | 3 | $1.75 |
| 2021-01-04 | 15 | TSLA | INTC | 1 | 2 | 8 | $3.50 |
| 2021-04-01 | 15 | INTC, KO | NKE, CRM | 2 | 2 | 0 | $0.70 |
| 2021-07-01 | 15 | NKE, CRM, CMCSA | AMZN, GOOGL, KO | 3 | 4 | 12 | $5.60 |
| 2021-10-01 | 15 | NVDA, ISRG, DIS | NKE, INTC, CMCSA | 3 | 4 | 5 | $3.15 |
| 2022-01-03 | 15 | AVGO, TMO | ISRG, CRM | 2 | 3 | 5 | $2.80 |
| 2022-04-01 | 15 | XOM, CVX, ABBV, LLY, KO | DIS, ADBE, NFLX, AVGO, TMO | 5 | 8 | 6 | $4.90 |
| 2022-07-01 | 15 | GOOGL, AMZN, META | FB, CVX, ABBV | 3 | 5 | 12 | $5.95 |
| 2022-10-03 | 15 | CVX | KO | 1 | 1 | 2 | $1.05 |
| 2023-01-03 | 15 | — | — | 0 | 0 | 0 | $0.00 |
| 2023-04-03 | 15 | ABBV | AMZN | 1 | 2 | 6 | $2.80 |
| 2023-07-03 | 15 | AMZN, ORCL, MRK | NVDA, CVX, ABBV | 3 | 6 | 3 | $3.15 |
| 2023-10-02 | 15 | CVX | MRK | 1 | 1 | 0 | $0.35 |
| 2024-01-02 | 15 | COST | CVX | 1 | 1 | 1 | $0.70 |
| 2024-04-01 | 15 | NVDA | COST | 1 | 1 | 14 | $5.25 |
| 2024-07-01 | 15 | COST | HD | 1 | 2 | 6 | $2.80 |
| 2024-10-01 | 15 | AVGO, HD | COST, JNJ | 2 | 3 | 4 | $2.45 |
| 2025-01-02 | 15 | COST | HD | 1 | 0 | 1 | $0.35 |
| 2025-04-01 | 15 | — | — | 0 | 0 | 1 | $0.35 |
| 2025-07-01 | 15 | JNJ | UNH | 1 | 1 | 2 | $1.05 |
| 2025-10-01 | 15 | PLTR, ABBV | NVDA, PG | 2 | 4 | 12 | $5.60 |
| 2026-01-02 | 15 | NFLX | COST | 1 | 1 | 3 | $1.40 |
| 2026-04-01 | 15 | COST, MU | PLTR, ABBV | 2 | 4 | 2 | $2.10 |
| 2026-07-01 | 15 | AMD, AMAT, LRCX, CSCO, CAT | AAPL, GOOGL, COST, ORCL, NFLX | 5 | 8 | 10 | $6.30 |
| 2026-10-01 | 15 | ABBV, PLTR | AMAT, CAT | 2 | 2 | 2 | $1.40 |

### 入替理由（四半期ごと）

#### 2016-01-04（入替 15 銘柄）

**追加:** 
- **+AAPL**: eligible順位 1位→1位（時価総額上位15入り）
- **+GOOGL**: eligible順位 2位→2位（時価総額上位15入り）
- **+MSFT**: eligible順位 3位→3位（時価総額上位15入り）
- **+AMZN**: eligible順位 4位→4位（時価総額上位15入り）
- **+FB**: eligible順位 5位→5位（時価総額上位15入り）
- **+JNJ**: eligible順位 6位→6位（時価総額上位15入り）
- **+XOM**: eligible順位 7位→7位（時価総額上位15入り）
- **+WMT**: eligible順位 8位→8位（時価総額上位15入り）
- **+PG**: eligible順位 9位→9位（時価総額上位15入り）
- **+ORCL**: eligible順位 10位→10位（時価総額上位15入り）
- **+BA**: eligible順位 11位→11位（時価総額上位15入り）
- **+KO**: eligible順位 12位→12位（時価総額上位15入り）
- **+HD**: eligible順位 13位→13位（時価総額上位15入り）
- **+INTC**: eligible順位 14位→14位（時価総額上位15入り）
- **+PFE**: eligible順位 15位→15位（時価総額上位15入り）

**除外:** なし


#### 2016-04-01（入替 2 銘柄）

**追加:** 
- **+VZ**: eligible順位 16位→13位（時価総額上位15入り）
- **+T**: eligible順位 25位→15位（時価総額上位15入り）

**除外:** 
- **−BA**: eligible順位 11位→32位（上位15から落ち）
- **−PFE**: eligible順位 15位→18位（上位15から落ち）

#### 2016-07-01（入替 2 銘柄）

**追加:** 
- **+GE**: 新規eligible化＋eligible順位 not eligible: 赤字（TTM・filed PIT）→6位（上位15入り）
- **+PFE**: eligible順位 18位→14位（時価総額上位15入り）

**除外:** 
- **−HD**: eligible順位 12位→17位（上位15から落ち）
- **−INTC**: eligible順位 14位→18位（上位15から落ち）

#### 2016-10-03（入替 2 銘柄）

**追加:** 
- **+INTC**: eligible順位 18位→12位（時価総額上位15入り）
- **+CVX**: eligible順位 16位→15位（時価総額上位15入り）

**除外:** 
- **−VZ**: eligible順位 13位→20位（上位15から落ち）
- **−T**: eligible順位 15位→16位（上位15から落ち）

#### 2017-01-03（入替 2 銘柄）

**追加:** 
- **+BA**: eligible順位 31位→11位（時価総額上位15入り）
- **+UNH**: eligible順位 23位→14位（時価総額上位15入り）

**除外:** 
- **−KO**: eligible順位 13位→17位（上位15から落ち）
- **−PFE**: eligible順位 14位→21位（上位15から落ち）

#### 2017-04-03（入替 2 銘柄）

**追加:** 
- **+HD**: eligible順位 20位→14位（時価総額上位15入り）
- **+KO**: eligible順位 17位→15位（時価総額上位15入り）

**除外:** 
- **−BA**: eligible順位 11位→25位（上位15から落ち）
- **−CVX**: 赤字（TTM・filed PIT）

#### 2017-07-03（入替 1 銘柄）

**追加:** 
- **+CMCSA**: eligible順位 16位→15位（時価総額上位15入り）

**除外:** 
- **−INTC**: eligible順位 13位→17位（上位15から落ち）

#### 2017-10-02（入替 2 銘柄）

**追加:** 
- **+INTC**: eligible順位 17位→14位（時価総額上位15入り）
- **+CVX**: eligible順位 16位→15位（時価総額上位15入り）

**除外:** 
- **−KO**: eligible順位 14位→17位（上位15から落ち）
- **−CMCSA**: eligible順位 15位→19位（上位15から落ち）

#### 2018-01-02（入替 1 銘柄）

**追加:** 
- **+BA**: eligible順位 16位→7位（時価総額上位15入り）

**除外:** 
- **−GE**: eligible順位 8位→16位（上位15から落ち）

#### 2018-04-02（入替 0 銘柄）

**追加:** なし


**除外:** なし


#### 2018-07-02（入替 1 銘柄）

**追加:** 
- **+NFLX**: eligible順位 21位→13位（時価総額上位15入り）

**除外:** 
- **−PG**: eligible順位 14位→16位（上位15から落ち）

#### 2018-10-01（入替 2 銘柄）

**追加:** 
- **+CSCO**: 新規eligible化＋eligible順位 not eligible: 赤字（TTM・filed PIT）→14位（上位15入り）
- **+NVDA**: eligible順位 17位→15位（時価総額上位15入り）

**除外:** 
- **−NFLX**: eligible順位 13位→19位（上位15から落ち）
- **−CVX**: eligible順位 15位→18位（上位15から落ち）

#### 2019-01-02（入替 3 銘柄）

**追加:** 
- **+PG**: eligible順位 17位→12位（時価総額上位15入り）
- **+PFE**: eligible順位 16位→13位（時価総額上位15入り）
- **+KO**: eligible順位 20位→15位（時価総額上位15入り）

**除外:** 
- **−ORCL**: eligible順位 13位→18位（上位15から落ち）
- **−CSCO**: eligible順位 14位→17位（上位15から落ち）
- **−NVDA**: eligible順位 15位→41位（上位15から落ち）

#### 2019-04-01（入替 2 銘柄）

**追加:** 
- **+CSCO**: eligible順位 17位→13位（時価総額上位15入り）
- **+ORCL**: eligible順位 18位→15位（時価総額上位15入り）

**除外:** 
- **−PFE**: eligible順位 13位→18位（上位15から落ち）
- **−KO**: eligible順位 15位→21位（上位15から落ち）

#### 2019-07-01（入替 0 銘柄）

**追加:** なし


**除外:** なし


#### 2019-10-01（入替 2 銘柄）

**追加:** 
- **+DIS**: 新規eligible化＋eligible順位 not eligible: 黒字不明（facts欠損等）→12位（上位15入り）
- **+KO**: eligible順位 16位→15位（時価総額上位15入り）

**除外:** 
- **−CSCO**: eligible順位 14位→20位（上位15から落ち）
- **−ORCL**: eligible順位 15位→18位（上位15から落ち）

#### 2020-01-02（入替 0 銘柄）

**追加:** なし


**除外:** なし


#### 2020-04-01（入替 3 銘柄）

**追加:** 
- **+NFLX**: eligible順位 30位→13位（時価総額上位15入り）
- **+VZ**: eligible順位 18位→14位（時価総額上位15入り）
- **+MRK**: eligible順位 16位→15位（時価総額上位15入り）

**除外:** 
- **−BA**: 赤字（TTM・filed PIT）
- **−XOM**: eligible順位 13位→27位（上位15から落ち）
- **−KO**: eligible順位 15位→16位（上位15から落ち）

#### 2020-07-01（入替 2 銘柄）

**追加:** 
- **+ADBE**: eligible順位 19位→13位（時価総額上位15入り）
- **+ORCL**: eligible順位 18位→15位（時価総額上位15入り）

**除外:** 
- **−VZ**: eligible順位 14位→19位（上位15から落ち）
- **−MRK**: eligible順位 15位→18位（上位15から落ち）

#### 2020-10-01（入替 2 銘柄）

**追加:** 
- **+CRM**: 新規eligible化＋eligible順位 not eligible: 赤字（TTM・filed PIT）→13位（上位15入り）
- **+NKE**: eligible順位 24位→15位（時価総額上位15入り）

**除外:** 
- **−DIS**: 赤字（TTM・filed PIT）
- **−ORCL**: eligible順位 15位→18位（上位15から落ち）

#### 2021-01-04（入替 1 銘柄）

**追加:** 
- **+TSLA**: 新規eligible化＋eligible順位 not eligible: S&P構成外→6位（上位15入り）

**除外:** 
- **−INTC**: eligible順位 14位→16位（上位15から落ち）

#### 2021-04-01（入替 2 銘柄）

**追加:** 
- **+INTC**: eligible順位 16位→12位（時価総額上位15入り）
- **+KO**: eligible順位 17位→15位（時価総額上位15入り）

**除外:** 
- **−NKE**: eligible順位 14位→21位（上位15から落ち）
- **−CRM**: eligible順位 15位→19位（上位15から落ち）

#### 2021-07-01（入替 3 銘柄）

**追加:** 
- **+NKE**: eligible順位 21位→11位（時価総額上位15入り）
- **+CRM**: eligible順位 19位→13位（時価総額上位15入り）
- **+CMCSA**: eligible順位 16位→15位（時価総額上位15入り）

**除外:** 
- **−AMZN**: eligible順位 3位→68位（上位15から落ち）
- **−GOOGL**: eligible順位 4位→72位（上位15から落ち）
- **−KO**: eligible順位 15位→16位（上位15から落ち）

#### 2021-10-01（入替 3 銘柄）

**追加:** 
- **+NVDA**: eligible順位 306位→5位（時価総額上位15入り）
- **+ISRG**: eligible順位 54位→7位（時価総額上位15入り）
- **+DIS**: 新規eligible化＋eligible順位 not eligible: 赤字（TTM・filed PIT）→12位（上位15入り）

**除外:** 
- **−NKE**: eligible順位 11位→19位（上位15から落ち）
- **−INTC**: eligible順位 14位→24位（上位15から落ち）
- **−CMCSA**: eligible順位 15位→16位（上位15から落ち）

#### 2022-01-03（入替 2 銘柄）

**追加:** 
- **+AVGO**: eligible順位 30位→14位（時価総額上位15入り）
- **+TMO**: eligible順位 18位→15位（時価総額上位15入り）

**除外:** 
- **−ISRG**: eligible順位 7位→52位（上位15から落ち）
- **−CRM**: eligible順位 15位→19位（上位15から落ち）

#### 2022-04-01（入替 5 銘柄）

**追加:** 
- **+XOM**: 新規eligible化＋eligible順位 not eligible: 赤字（TTM・filed PIT）→10位（上位15入り）
- **+CVX**: eligible順位 34位→12位（時価総額上位15入り）
- **+ABBV**: eligible順位 31位→13位（時価総額上位15入り）
- **+LLY**: eligible順位 23位→14位（時価総額上位15入り）
- **+KO**: eligible順位 24位→15位（時価総額上位15入り）

**除外:** 
- **−DIS**: eligible順位 11位→18位（上位15から落ち）
- **−ADBE**: eligible順位 12位→24位（上位15から落ち）
- **−NFLX**: eligible順位 13位→36位（上位15から落ち）
- **−AVGO**: eligible順位 14位→17位（上位15から落ち）
- **−TMO**: eligible順位 15位→20位（上位15から落ち）

#### 2022-07-01（入替 3 銘柄）

**追加:** 
- **+GOOGL**: eligible順位 72位→3位（時価総額上位15入り）
- **+AMZN**: eligible順位 78位→4位（時価総額上位15入り）
- **+META**: 新規eligible化＋eligible順位 not eligible: S&P構成外→8位（上位15入り）

**除外:** 
- **−FB**: S&P 500構成から除外
- **−CVX**: eligible順位 12位→17位（上位15から落ち）
- **−ABBV**: eligible順位 13位→16位（上位15から落ち）

#### 2022-10-03（入替 1 銘柄）

**追加:** 
- **+CVX**: eligible順位 17位→15位（時価総額上位15入り）

**除外:** 
- **−KO**: eligible順位 15位→16位（上位15から落ち）

#### 2023-01-03（入替 0 銘柄）

**追加:** なし


**除外:** なし


#### 2023-04-03（入替 1 銘柄）

**追加:** 
- **+ABBV**: eligible順位 16位→15位（時価総額上位15入り）

**除外:** 
- **−AMZN**: 赤字（TTM・filed PIT）

#### 2023-07-03（入替 3 銘柄）

**追加:** 
- **+AMZN**: 新規eligible化＋eligible順位 not eligible: 赤字（TTM・filed PIT）→4位（上位15入り）
- **+ORCL**: eligible順位 19位→13位（時価総額上位15入り）
- **+MRK**: eligible順位 16位→15位（時価総額上位15入り）

**除外:** 
- **−NVDA**: eligible順位 4位→65位（上位15から落ち）
- **−CVX**: eligible順位 13位→16位（上位15から落ち）
- **−ABBV**: eligible順位 15位→21位（上位15から落ち）

#### 2023-10-02（入替 1 銘柄）

**追加:** 
- **+CVX**: eligible順位 16位→13位（時価総額上位15入り）

**除外:** 
- **−MRK**: eligible順位 15位→17位（上位15から落ち）

#### 2024-01-02（入替 1 銘柄）

**追加:** 
- **+COST**: eligible順位 18位→14位（時価総額上位15入り）

**除外:** 
- **−CVX**: eligible順位 13位→18位（上位15から落ち）

#### 2024-04-01（入替 1 銘柄）

**追加:** 
- **+NVDA**: eligible順位 57位→3位（時価総額上位15入り）

**除外:** 
- **−COST**: eligible順位 14位→17位（上位15から落ち）

#### 2024-07-01（入替 1 銘柄）

**追加:** 
- **+COST**: eligible順位 17位→14位（時価総額上位15入り）

**除外:** 
- **−HD**: eligible順位 14位→16位（上位15から落ち）

#### 2024-10-01（入替 2 銘柄）

**追加:** 
- **+AVGO**: eligible順位 98位→9位（時価総額上位15入り）
- **+HD**: eligible順位 16位→15位（時価総額上位15入り）

**除外:** 
- **−COST**: eligible順位 14位→16位（上位15から落ち）
- **−JNJ**: eligible順位 15位→17位（上位15から落ち）

#### 2025-01-02（入替 1 銘柄）

**追加:** 
- **+COST**: eligible順位 16位→14位（時価総額上位15入り）

**除外:** 
- **−HD**: eligible順位 15位→16位（上位15から落ち）

#### 2025-04-01（入替 0 銘柄）

**追加:** なし


**除外:** なし


#### 2025-07-01（入替 1 銘柄）

**追加:** 
- **+JNJ**: eligible順位 16位→15位（時価総額上位15入り）

**除外:** 
- **−UNH**: eligible順位 12位→20位（上位15から落ち）

#### 2025-10-01（入替 2 銘柄）

**追加:** 
- **+PLTR**: eligible順位 18位→13位（時価総額上位15入り）
- **+ABBV**: eligible順位 17位→14位（時価総額上位15入り）

**除外:** 
- **−NVDA**: 時価総額算出不可
- **−PG**: eligible順位 14位→17位（上位15から落ち）

#### 2026-01-02（入替 1 銘柄）

**追加:** 
- **+NFLX**: eligible順位 166位→15位（時価総額上位15入り）

**除外:** 
- **−COST**: eligible順位 15位→16位（上位15から落ち）

#### 2026-04-01（入替 2 銘柄）

**追加:** 
- **+COST**: eligible順位 16位→12位（時価総額上位15入り）
- **+MU**: eligible順位 18位→14位（時価総額上位15入り）

**除外:** 
- **−PLTR**: eligible順位 13位→18位（上位15から落ち）
- **−ABBV**: eligible順位 14位→17位（上位15から落ち）

#### 2026-07-01（入替 5 銘柄）

**追加:** 
- **+AMD**: eligible順位 19位→8位（時価総額上位15入り）
- **+AMAT**: eligible順位 27位→12位（時価総額上位15入り）
- **+LRCX**: eligible順位 28位→13位（時価総額上位15入り）
- **+CSCO**: eligible順位 24位→14位（時価総額上位15入り）
- **+CAT**: eligible順位 20位→15位（時価総額上位15入り）

**除外:** 
- **−AAPL**: 時価総額算出不可
- **−GOOGL**: 時価総額算出不可
- **−COST**: eligible順位 12位→18位（上位15から落ち）
- **−ORCL**: eligible順位 13位→17位（上位15から落ち）
- **−NFLX**: eligible順位 15位→26位（上位15から落ち）

#### 2026-10-01（入替 2 銘柄）

**追加:** 
- **+ABBV**: eligible順位 16位→12位（時価総額上位15入り）
- **+PLTR**: eligible順位 28位→13位（時価総額上位15入り）

**除外:** 
- **−AMAT**: eligible順位 12位→16位（上位15から落ち）
- **−CAT**: eligible順位 15位→20位（上位15から落ち）


<details>
<summary>全リバランス日の保有15（クリックで展開）</summary>

| 日付 | 保有ティッカー |
|---|---|
| 2016-01-04 | AAPL, GOOGL, MSFT, AMZN, FB, JNJ, XOM, WMT, PG, ORCL, BA, KO, HD, INTC, PFE |
| 2016-04-01 | AAPL, GOOGL, MSFT, FB, AMZN, JNJ, XOM, WMT, PG, ORCL, KO, HD, VZ, INTC, T |
| 2016-07-01 | AAPL, GOOGL, MSFT, AMZN, FB, GE, JNJ, XOM, WMT, PG, ORCL, KO, VZ, PFE, T |
| 2016-10-03 | AAPL, GOOGL, MSFT, AMZN, FB, GE, JNJ, XOM, WMT, PG, ORCL, INTC, KO, PFE, CVX |
| 2017-01-03 | AAPL, GOOGL, MSFT, AMZN, FB, GE, XOM, JNJ, WMT, PG, BA, ORCL, CVX, UNH, INTC |
| 2017-04-03 | AAPL, GOOGL, MSFT, AMZN, FB, JNJ, GE, XOM, WMT, PG, ORCL, UNH, INTC, HD, KO |
| 2017-07-03 | AAPL, GOOGL, MSFT, AMZN, FB, JNJ, XOM, GE, WMT, ORCL, PG, UNH, HD, KO, CMCSA |
| 2017-10-02 | AAPL, GOOGL, MSFT, FB, AMZN, JNJ, XOM, GE, WMT, ORCL, PG, UNH, HD, INTC, CVX |
| 2018-01-02 | AAPL, GOOGL, MSFT, AMZN, FB, JNJ, BA, WMT, XOM, UNH, INTC, ORCL, PG, HD, CVX |
| 2018-04-02 | AAPL, GOOGL, AMZN, MSFT, FB, JNJ, WMT, XOM, UNH, INTC, BA, ORCL, HD, PG, CVX |
| 2018-07-02 | AAPL, AMZN, GOOGL, MSFT, FB, JNJ, XOM, UNH, WMT, INTC, BA, HD, NFLX, ORCL, CVX |
| 2018-10-01 | AAPL, AMZN, MSFT, GOOGL, FB, JNJ, XOM, WMT, UNH, BA, INTC, HD, ORCL, CSCO, NVDA |
| 2019-01-02 | AMZN, MSFT, GOOGL, AAPL, FB, BA, JNJ, WMT, UNH, XOM, INTC, PG, PFE, HD, KO |
| 2019-04-01 | AMZN, MSFT, AAPL, GOOGL, FB, JNJ, WMT, XOM, INTC, UNH, BA, PG, CSCO, HD, ORCL |
| 2019-07-01 | MSFT, AMZN, AAPL, GOOGL, FB, JNJ, WMT, XOM, PG, UNH, BA, INTC, HD, CSCO, ORCL |
| 2019-10-01 | MSFT, AAPL, AMZN, GOOGL, FB, WMT, JNJ, PG, XOM, HD, BA, DIS, INTC, UNH, KO |
| 2020-01-02 | AAPL, MSFT, AMZN, GOOGL, FB, BA, JNJ, WMT, DIS, UNH, PG, INTC, XOM, HD, KO |
| 2020-04-01 | MSFT, AAPL, AMZN, GOOGL, FB, WMT, JNJ, PG, UNH, INTC, HD, DIS, NFLX, VZ, MRK |
| 2020-07-01 | MSFT, AAPL, AMZN, GOOGL, FB, WMT, JNJ, PG, UNH, HD, INTC, NFLX, ADBE, DIS, ORCL |
| 2020-10-01 | AAPL, AMZN, MSFT, GOOGL, FB, WMT, JNJ, PG, UNH, HD, ADBE, NFLX, CRM, INTC, NKE |
| 2021-01-04 | AAPL, MSFT, AMZN, GOOGL, FB, TSLA, WMT, JNJ, PG, UNH, HD, ADBE, NFLX, NKE, CRM |
| 2021-04-01 | AAPL, MSFT, AMZN, GOOGL, FB, TSLA, JNJ, WMT, UNH, HD, PG, INTC, NFLX, ADBE, KO |
| 2021-07-01 | AAPL, MSFT, FB, TSLA, JNJ, WMT, UNH, HD, PG, ADBE, NKE, NFLX, CRM, INTC, CMCSA |
| 2021-10-01 | AAPL, MSFT, FB, TSLA, NVDA, JNJ, ISRG, WMT, UNH, HD, PG, DIS, ADBE, NFLX, CRM |
| 2022-01-03 | AAPL, MSFT, TSLA, FB, NVDA, UNH, JNJ, HD, WMT, PG, DIS, ADBE, NFLX, AVGO, TMO |
| 2022-04-01 | AAPL, MSFT, TSLA, NVDA, FB, UNH, JNJ, WMT, PG, XOM, HD, CVX, ABBV, LLY, KO |
| 2022-07-01 | AAPL, MSFT, GOOGL, AMZN, TSLA, UNH, JNJ, META, NVDA, XOM, PG, WMT, LLY, HD, KO |
| 2022-10-03 | AAPL, MSFT, GOOGL, AMZN, TSLA, UNH, JNJ, META, XOM, WMT, NVDA, PG, LLY, HD, CVX |
| 2023-01-03 | AAPL, MSFT, GOOGL, AMZN, UNH, JNJ, XOM, WMT, NVDA, TSLA, PG, META, LLY, CVX, HD |
| 2023-04-03 | AAPL, MSFT, GOOGL, NVDA, TSLA, META, UNH, XOM, JNJ, WMT, PG, LLY, CVX, HD, ABBV |
| 2023-07-03 | AAPL, MSFT, GOOGL, AMZN, TSLA, META, UNH, WMT, LLY, XOM, JNJ, PG, ORCL, HD, MRK |
| 2023-10-02 | AAPL, MSFT, GOOGL, AMZN, TSLA, META, LLY, UNH, XOM, WMT, JNJ, PG, CVX, HD, ORCL |
| 2024-01-02 | AAPL, MSFT, GOOGL, AMZN, META, TSLA, LLY, UNH, WMT, JNJ, XOM, PG, HD, COST, ORCL |
| 2024-04-01 | MSFT, AAPL, NVDA, GOOGL, AMZN, META, LLY, TSLA, WMT, XOM, UNH, JNJ, PG, HD, ORCL |
| 2024-07-01 | MSFT, AAPL, NVDA, GOOGL, AMZN, META, LLY, TSLA, WMT, XOM, UNH, ORCL, PG, COST, JNJ |
| 2024-10-01 | AAPL, MSFT, NVDA, GOOGL, AMZN, META, TSLA, LLY, AVGO, WMT, UNH, XOM, ORCL, PG, HD |
| 2025-01-02 | AAPL, NVDA, MSFT, AMZN, GOOGL, META, TSLA, AVGO, WMT, LLY, ORCL, XOM, UNH, COST, PG |
| 2025-04-01 | AAPL, MSFT, NVDA, AMZN, GOOGL, META, TSLA, AVGO, LLY, WMT, XOM, UNH, COST, ORCL, PG |
| 2025-07-01 | NVDA, MSFT, AAPL, AMZN, GOOGL, META, AVGO, TSLA, WMT, LLY, ORCL, XOM, COST, PG, JNJ |
| 2025-10-01 | MSFT, AAPL, GOOGL, AMZN, META, AVGO, TSLA, ORCL, WMT, LLY, XOM, JNJ, PLTR, ABBV, COST |
| 2026-01-02 | AAPL, GOOGL, MSFT, AMZN, AVGO, TSLA, META, LLY, WMT, ORCL, XOM, JNJ, PLTR, ABBV, NFLX |
| 2026-04-01 | AAPL, GOOGL, MSFT, AMZN, AVGO, META, TSLA, WMT, LLY, XOM, JNJ, COST, ORCL, MU, NFLX |
| 2026-07-01 | MSFT, AMZN, AVGO, TSLA, META, MU, LLY, AMD, WMT, JNJ, XOM, AMAT, LRCX, CSCO, CAT |
| 2026-10-01 | MSFT, AMZN, META, AVGO, TSLA, MU, LLY, AMD, WMT, XOM, JNJ, ABBV, PLTR, CSCO, LRCX |

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
| 2016-Q3 | 5 | 4 | 1 | $1.75 | $7.35 | $5.00 | $21.00 |
| 2016-Q4 | 2 | 2 | 0 | $0.70 | $8.05 | $2.00 | $23.00 |
| 2017-Q1 | 5 | 4 | 1 | $1.75 | $9.80 | $5.00 | $28.00 |
| 2017-Q2 | 4 | 3 | 1 | $1.40 | $11.20 | $4.00 | $32.00 |
| 2017-Q3 | 3 | 1 | 2 | $1.05 | $12.25 | $3.00 | $35.00 |
| 2017-Q4 | 2 | 2 | 0 | $0.70 | $12.95 | $2.00 | $37.00 |
| 2018-Q1 | 5 | 1 | 4 | $1.75 | $14.70 | $5.00 | $42.00 |
| 2018-Q2 | 0 | 0 | 0 | $0.00 | $14.70 | $0.00 | $42.00 |
| 2018-Q3 | 2 | 1 | 1 | $0.70 | $15.40 | $2.00 | $44.00 |
| 2018-Q4 | 5 | 3 | 2 | $1.75 | $17.15 | $5.00 | $49.00 |
| 2019-Q1 | 9 | 5 | 4 | $3.15 | $20.30 | $9.00 | $58.00 |
| 2019-Q2 | 4 | 3 | 1 | $1.40 | $21.70 | $4.00 | $62.00 |
| 2019-Q3 | 0 | 0 | 0 | $0.00 | $21.70 | $0.00 | $62.00 |
| 2019-Q4 | 5 | 4 | 1 | $1.75 | $23.45 | $5.00 | $67.00 |
| 2020-Q1 | 1 | 0 | 1 | $0.35 | $23.80 | $1.00 | $68.00 |
| 2020-Q2 | 5 | 5 | 0 | $1.75 | $25.55 | $5.00 | $73.00 |
| 2020-Q3 | 3 | 2 | 1 | $1.05 | $26.60 | $3.00 | $76.00 |
| 2020-Q4 | 5 | 2 | 3 | $1.75 | $28.35 | $5.00 | $81.00 |
| 2021-Q1 | 10 | 2 | 8 | $3.50 | $31.85 | $10.00 | $91.00 |
| 2021-Q2 | 2 | 2 | 0 | $0.70 | $32.55 | $2.00 | $93.00 |
| 2021-Q3 | 16 | 4 | 12 | $5.60 | $38.15 | $16.00 | $109.00 |
| 2021-Q4 | 9 | 4 | 5 | $3.15 | $41.30 | $9.00 | $118.00 |
| 2022-Q1 | 8 | 3 | 5 | $2.80 | $44.10 | $8.00 | $126.00 |
| 2022-Q2 | 14 | 8 | 6 | $4.90 | $49.00 | $14.00 | $140.00 |
| 2022-Q3 | 17 | 5 | 12 | $5.95 | $54.95 | $17.00 | $157.00 |
| 2022-Q4 | 3 | 1 | 2 | $1.05 | $56.00 | $3.00 | $160.00 |
| 2023-Q1 | 0 | 0 | 0 | $0.00 | $56.00 | $0.00 | $160.00 |
| 2023-Q2 | 8 | 2 | 6 | $2.80 | $58.80 | $8.00 | $168.00 |
| 2023-Q3 | 9 | 6 | 3 | $3.15 | $61.95 | $9.00 | $177.00 |
| 2023-Q4 | 1 | 1 | 0 | $0.35 | $62.30 | $1.00 | $178.00 |
| 2024-Q1 | 2 | 1 | 1 | $0.70 | $63.00 | $2.00 | $180.00 |
| 2024-Q2 | 15 | 1 | 14 | $5.25 | $68.25 | $15.00 | $195.00 |
| 2024-Q3 | 8 | 2 | 6 | $2.80 | $71.05 | $8.00 | $203.00 |
| 2024-Q4 | 7 | 3 | 4 | $2.45 | $73.50 | $7.00 | $210.00 |
| 2025-Q1 | 1 | 0 | 1 | $0.35 | $73.85 | $1.00 | $211.00 |
| 2025-Q2 | 1 | 0 | 1 | $0.35 | $74.20 | $1.00 | $212.00 |
| 2025-Q3 | 3 | 1 | 2 | $1.05 | $75.25 | $3.00 | $215.00 |
| 2025-Q4 | 16 | 4 | 12 | $5.60 | $80.85 | $16.00 | $231.00 |
| 2026-Q1 | 4 | 1 | 3 | $1.40 | $82.25 | $4.00 | $235.00 |
| 2026-Q2 | 6 | 4 | 2 | $2.10 | $84.35 | $6.00 | $241.00 |
| 2026-Q3 | 18 | 8 | 10 | $6.30 | $90.65 | $18.00 | $259.00 |
| 2026-Q4 | 4 | 2 | 2 | $1.40 | $92.05 | $4.00 | $263.00 |

**定義:** **スワップ系**＝そのリバランスで「前回は保有15に無かった銘柄」への新規買い、または「今回の15から外れた銘柄」の売却に伴う注文。**リウェイト系**＝継続保有銘柄のウェイト調整注文。

---

## (4) 寄与分析（2025-07-01 ～ 2026-10-02）

**方法:** 各営業日、前日終値ベースのポートフォリオウェイト × 銘柄日次リターンを積み上げ（リバランス日は目標ウェイトにリセット・手数料は本節では控除しない簡易版）。


| 銘柄 | 寄与（%ポイント） | 寄与（$・$3,200ベース） | 半導体 |
|---|---:|---:|---|
| GOOGL | +9.94pt | +$318 | — |
| AAPL | +5.36pt | +$172 | — |
| NVDA | +3.51pt | +$112 | 半導体 |
| MU | +3.31pt | +$106 | 半導体 |
| MSFT | +2.67pt | +$85 | — |
| AMZN | +2.15pt | +$69 | — |
| AVGO | +2.14pt | +$68 | 半導体 |
| LLY | +1.29pt | +$41 | — |
| XOM | +1.22pt | +$39 | — |
| AMD | +0.85pt | +$27 | 半導体 |
| JNJ | +0.78pt | +$25 | — |
| META | +0.64pt | +$21 | — |
| TSLA | +0.29pt | +$9 | — |
| WMT | +0.23pt | +$7 | — |
| PG | -0.07pt | $-2 | — |
| CSCO | -0.08pt | $-2 | — |
| ABBV | -0.17pt | $-5 | — |
| LRCX | -0.32pt | $-10 | 半導体 |
| COST | -0.34pt | $-11 | — |
| PLTR | -0.38pt | $-12 | — |

- 期間ポートリターン: **34.37%**（単純リプレイ・差分リバランス近似）
- 同期間 SPY: **26.30%** → ギャップ **8.07pt**
- 半導体サブ業種の寄与合計: **8.92pt**（全寄与の **28%**）
- 上位1/3/5銘柄の寄与シェア: **32% / 60% / 79%**
- 上位1銘柄を除いた場合の期間リターン（寄与差し引き）: **24.44%**
- 上位3銘柄を除いた場合: **15.56%**

**解釈（ギャップの単純分解）:** 本構成は金融セクターとテーマ株を持たないため SPY より大型金融・一部超大型のウェイトが薄い。期間中は半導体・大型テックの寄与がポート側のドライバーとなり、除外セクターが SPY にあって本ポートに無い分がギャップの主因となり得る（厳密な要因分析ではない）。


![寄与（上位銘柄）](round19_v1_contribution.png)

---

## (5) 最終リバランス（2026-10-01）で持っていない銘柄

### S&P 構成員の時価総額上位40のうち、保有15外

**eligibleだが上位15外**
  - AMAT（S&P時価総額順 20位・約420B USD）
  - ORCL（S&P時価総額順 21位・約417B USD）
  - CVX（S&P時価総額順 22位・約409B USD）
  - COST（S&P時価総額順 23位・約406B USD）
  - CAT（S&P時価総額順 24位・約380B USD）
  - KO（S&P時価総額順 26位・約370B USD）
  - MRK（S&P時価総額順 27位・約355B USD）
  - DELL（S&P時価総額順 28位・約347B USD）
  - PG（S&P時価総額順 29位・約335B USD）
  - UNH（S&P時価総額順 30位・約328B USD）
  - PANW（S&P時価総額順 31位・約324B USD）
  - GE（S&P時価総額順 32位・約324B USD）
  - PM（S&P時価総額順 34位・約292B USD）
  - NFLX（S&P時価総額順 35位・約283B USD）
  - HD（S&P時価総額順 36位・約282B USD）
  - GEV（S&P時価総額順 38位・約263B USD）
  - SNDK（S&P時価総額順 39位・約262B USD）
  - KLAC（S&P時価総額順 40位・約262B USD）

**赤字（TTM・filed PIT）**
  - INTC（S&P時価総額順 14位・約605B USD）
  - CRWD（S&P時価総額順 37位・約272B USD）

**金融セクター除外**
  - JPM（S&P時価総額順 9位・約886B USD）
  - V（S&P時価総額順 12位・約675B USD）
  - MA（S&P時価総額順 15位・約488B USD）
  - BAC（S&P時価総額順 25位・約376B USD）
  - MS（S&P時価総額順 33位・約295B USD）

### eligible プールの16～25位（惜しくも15入りしなかった銘柄）

| eligible順位 | ティッカー | 時価総額（約・B USD） |
|---:|---|---:|
| 16 | AMAT | 420 |
| 17 | ORCL | 417 |
| 18 | CVX | 409 |
| 19 | COST | 406 |
| 20 | CAT | 380 |
| 21 | KO | 370 |
| 22 | MRK | 355 |
| 23 | DELL | 347 |
| 24 | PG | 335 |
| 25 | UNH | 328 |

---

## (6) 暦年リターン vs SPY・最大ドローダウン

**暦年:** 前年最終営業日終値ベース（`calendarYearReturn`）。

| 年 | plain_15__mcap | SPY | 差 |
|---|---:|---:|---:|
| 2017 | 30.7% | 21.7% | 9.0pt |
| 2018 | -1.1% | -4.6% | 3.5pt |
| 2019 | 38.0% | 31.2% | 6.7pt |
| 2020 | 36.2% | 18.3% | 17.8pt |
| 2021 | 36.0% | 28.7% | 7.2pt |
| 2022 | -31.6% | -18.2% | -13.4pt |
| 2023 | 51.4% | 26.2% | 25.2pt |
| 2024 | 32.7% | 24.9% | 7.8pt |
| 2025 | 23.3% | 17.7% | 5.5pt |
| 2026 | 11.3% | 13.7% | -2.5pt |

### 最大ドローダウン（2016-01-01–2026-10-02）

| | 採用構成 | SPY |
|---|---|---|
| ピーク日 | 2022-01-03 | 2020-02-19 |
| ボトム日 | 2023-01-05 | 2020-03-23 |
| 深さ | -35.0% | -33.7% |
| 回復 | 2023-11-20 | 2020-08-10 |
| 回復営業日数 | 220 | 97 |

**OOS 期間のみの MaxDD:** 採用 **-35.0%**（ピーク 2022-01-03 → ボトム 2023-01-05） vs SPY **-24.5%** — 事前登録合格②は **不合格**。

上表の全期間最大 DD は主に **2022–2023 の株式調整**（ピーク **2022-01-03**、ボトム **2023-01-05**、回復 **2023-11-20**）に由来する。

---

## (7) ライブ窓シミュレーション（2026-07-30 ～ 2026-10-02）


**窓:** 2026-07-30 終値時点で **¥463,000** を USD へ換算し投資（USD/JPY **163.30** → 2026-10-02 時点 **157.93**）。  
**保有の起点:** 2026-07-01 リバランスの採用15（plain_15__mcap）。**2026-10-02** までに **2026-10-01** リバランスを適用。手数料 **$0.35/注文**（差分リバランス）。

| | USD建て | 円建て（日次 USD/JPY で換算） |
|---|---:|---:|
| 期間リターン | 9.84% | 6.23% |
| 最大DD | -3.49%（ピーク 2026-08-10 → ボトム 2026-08-20） | -5.37%（ピーク 2026-08-10 → ボトム 2026-09-08） |

**ベンチマーク（同じ USD 初期額）**

| 指数 | USD | 円建て |
|---|---:|---:|
| SPY | 4.03% | 0.60% |
| QQQ | 9.77% | 6.16% |
| SOXX | 16.80% | 12.96% |

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
| 2026-01-02 | 0.255 | 0.257 | 0.938 | 1.184 | — | — |
| 2026-04-01 | 0.191 | 0.238 | 0.947 | 1.136 | 0.904 | 1.152 |
| 2026-07-01 | 0.121 | 0.138 | 0.882 | 1.480 | 0.896 | 1.249 |
| 2026-10-01 | 0.041 | 0.082 | 0.873 | 1.426 | — | — |

### 全リバランス平均（44 四半期）

| | ρ中央値 | ρ平均 | ρ(ポート,SPY) 1y | β vs SPY 1y | ρ(ポート,SPY) 全期間 | β vs SPY 全期間 |
|---|---:|---:|---:|---:|---:|---:|
| 平均 | 0.315 | 0.328 | 0.894 | 1.165 | 0.889 | 1.103 |


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
| `5e4d306` | 2026/10/5 13:48:41 JST | fix(pit-mcap): reject pre-split mcapC for upcoming splits (SMCI) |

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
7. **STOP-SHIP 修正**（`216dfc6` 以降、`5e4d306` 付近）: PIT mcap（`mcapC`）、ATVI/CERN エイリアス、GOOGL レガシー facts、**HOLX `CommonStockSharesIssued` 300B 誤株数**（`pit-shares.ts`）、**XOM CIK override を `buildCtx` 全体に適用**、MaxDD ピーク日、USD/JPY など。**本レポートは再生成版であり、採用構成 ID はまた変わる可能性がある**。

**結論:** 「2016–2020 のみでルールを決め、2021+ は一度だけ評価」は **手順として事前登録されている**が、**データ修正と再実行により採用構成は初回結果（`plain_15__equal`）と異なる**。OOS を **設計に使った**というより、**公開後にデータを直し IS をやり直した**のが正確。


---

## 解釈（全体）

- **plain_15__mcap** は mega-cap 寄りだが **5%キャップ** により単一超大株依存を抑える設計。
- Corrected v1 のデータ拡充で eligible が増え、四半期漏斗の「価格なし」は後年ほぼ解消（詳細は `ROUND19_AUDIT_ja.md`）。
- v2（ウォークフォワード主評価）は **DRAFT のみ**・本レポートの対象外。

*生成: `npx tsx scripts/round19-v1-detail-report.ts`*
