# Round 19 Corrected v1 — 採用構成の詳細レポート

**対象:** Corrected v1 再実行（事前登録 `6e3ad93`・差分リバランス・PIT データ）  
**採用構成 ID:** `plain_15__mcap`（IS 2016–2020 を `selectSakaConfig` で再計算した直近の選定結果。**STOP-SHIP データ修正後も採用 ID は再び変わる可能性がある** — 本稿は確定版ではない。）  
**初期資金:** $3200　**手数料（主計算）:** $0.35/注文  
**データ:** `data/.cache/pit/`（`docs/DATA_PIT_ja.md`）

### ヘッドライン（採用構成 vs SPY・差分リバランス $0.35/注文）

| 期間 | 採用 CAGR | SPY CAGR | 採用 MaxDD | SPY MaxDD |
|---|---:|---:|---:|---:|
| IS (2016–2020) | 20.62% | 15.42% | -27.74% | -33.72% |
| OOS (2021–2026) | 17.93% | 15.18% | -34.60% | -24.50% |

**OOS 最大ドローダウン（重要）:** 採用構成の OOS MaxDD **-34.6%** は SPY **-24.5%** より**深い（悪化）**。Emma 事前登録の合格基準②「OOS DD < SPY」は **満たさない**。

全期間の最大 DD 局面（採用曲線）: ピーク **2022-01-03** → ボトム **2023-01-05**（深さ -34.6%）→ 回復 **2023-11-14**。

### 事前登録合格基準（OOS・$0.35・`ROUND19_PREREG_ja.md`）

| # | 基準 | 採用 | SPY/参照 | 判定 |
|---|---|---:|---:|---|
| 1 | OOS CAGR ≥ 10% | 17.9% | — | **合格** |
| 2 | OOS MaxDD **が SPY より浅い** | -34.6% | -24.5% | **不合格** |
| 3 | 暦年プラス比率 ≥ 70%（OOS 暦年） | 90% | — | **合格** |

### 採用構成のデータ版別変遷


| データ版 (git) | 採用構成 ID | 備考 |
|---|---|---|
| `e2380b8` | `plain_15__equal` | filed PIT 黒字・初回 corrected v1 PIT データ |
| `216dfc6` | `plain_15__mcap_cap5` | 詳細レポート初版（mcap 順位バグ残存） |
| `fe6c787` | `plain_20__mcap_cap10` | mcapC・ATVI/CERN 修正後 IS 再採用 |
| `cc6ffaa` | `plain_15__mcap` | HOLX 株数・XOM CIK 一貫・本稿 |


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
| リバランス日・mcap=0（価格あり） | 直近サンプル: [{"date":"2026-07-01","tickers":["HONA","STZ"]},{"date":"2026-10-01","tickers":["STZ"]}] |

**2026-07-01 / 2026-10-01 バスケット（株数フォールバック＋XOM 修正前後）**

- **2026-07-01:** 入替: +META / -NVDA
- **2026-10-01:** 入替: +META / -PLTR


---

## (1) 四半期ごとの保有履歴（2016–2026）

各リバランス日: 保有銘柄数、追加・除外ティッカー、**入替銘柄数**（追加数＝除外数）、注文内訳は (3) と一致。

| リバランス日 | 保有数 | 追加 | 除外 | 入替数 | スワップ注文 | リウェイト注文 | 手数料$0.35 |
|---|---:|---|---|---:|---:|---:|---:|
| 2016-01-04 | 15 | AAPL, GOOGL, MSFT, XOM, AMZN, FB, JNJ, PG, PFE, WMT, T, VZ, KO, HD, CVX | — | 15 | 14 | 0 | $4.90 |
| 2016-04-01 | 15 | ORCL | HD | 1 | 1 | 1 | $0.70 |
| 2016-07-01 | 15 | GE | ORCL | 1 | 0 | 0 | $0.00 |
| 2016-10-03 | 15 | — | — | 0 | 0 | 1 | $0.35 |
| 2017-01-03 | 15 | — | — | 0 | 0 | 0 | $0.00 |
| 2017-04-03 | 15 | ORCL | CVX | 1 | 1 | 1 | $0.70 |
| 2017-07-03 | 15 | CVX | VZ | 1 | 1 | 1 | $0.70 |
| 2017-10-02 | 15 | VZ | KO | 1 | 1 | 1 | $0.70 |
| 2018-01-02 | 15 | BA, INTC, HD | PFE, GE, ORCL | 3 | 6 | 5 | $3.85 |
| 2018-04-02 | 15 | UNH, PFE | BA, PG | 2 | 4 | 2 | $2.10 |
| 2018-07-02 | 15 | — | — | 0 | 0 | 1 | $0.35 |
| 2018-10-01 | 15 | CSCO, BA | INTC, T | 2 | 4 | 2 | $2.10 |
| 2019-01-02 | 15 | PG, INTC | HD, CSCO | 2 | 3 | 1 | $1.40 |
| 2019-04-01 | 15 | CSCO | BA | 1 | 1 | 1 | $0.70 |
| 2019-07-01 | 15 | T, HD | INTC, UNH | 2 | 3 | 3 | $2.10 |
| 2019-10-01 | 15 | KO, INTC | PFE, CSCO | 2 | 3 | 1 | $1.40 |
| 2020-01-02 | 15 | BA, UNH, DIS | HD, KO, CVX | 3 | 6 | 2 | $2.80 |
| 2020-04-01 | 15 | HD, MRK, KO | BA, XOM, DIS | 3 | 5 | 2 | $2.45 |
| 2020-07-01 | 15 | NVDA, NFLX | MRK, KO | 2 | 2 | 2 | $1.40 |
| 2020-10-01 | 15 | ADBE, CRM | INTC, T | 2 | 3 | 2 | $1.75 |
| 2021-01-04 | 15 | TSLA | CRM | 1 | 0 | 8 | $2.80 |
| 2021-04-01 | 15 | INTC, CMCSA | ADBE, NFLX | 2 | 3 | 1 | $1.40 |
| 2021-07-01 | 15 | ADBE, NKE | INTC, VZ | 2 | 3 | 2 | $1.75 |
| 2021-10-01 | 15 | ISRG, DIS | CMCSA, NKE | 2 | 2 | 4 | $2.10 |
| 2022-01-03 | 15 | PFE, AVGO | ISRG, ADBE | 2 | 3 | 3 | $2.10 |
| 2022-04-01 | 15 | XOM, CVX | DIS, AVGO | 2 | 2 | 2 | $1.40 |
| 2022-07-01 | 15 | META, LLY | FB, CVX | 2 | 3 | 12 | $5.25 |
| 2022-10-03 | 15 | CVX | PFE | 1 | 2 | 12 | $4.90 |
| 2023-01-03 | 15 | — | — | 0 | 0 | 0 | $0.00 |
| 2023-04-03 | 15 | ABBV | AMZN | 1 | 2 | 6 | $2.80 |
| 2023-07-03 | 15 | AMZN, AVGO, ORCL | CVX, HD, ABBV | 3 | 5 | 7 | $4.20 |
| 2023-10-02 | 15 | CVX | ORCL | 1 | 0 | 0 | $0.00 |
| 2024-01-02 | 15 | HD | CVX | 1 | 0 | 3 | $1.05 |
| 2024-04-01 | 15 | — | — | 0 | 0 | 2 | $0.70 |
| 2024-07-01 | 15 | SMCI, ORCL, COST | NVDA, JNJ, HD | 3 | 4 | 12 | $5.60 |
| 2024-10-01 | 15 | LRCX, HD | SMCI, COST | 2 | 2 | 10 | $4.20 |
| 2025-01-02 | 15 | COST | LRCX | 1 | 2 | 8 | $3.50 |
| 2025-04-01 | 15 | NFLX | HD | 1 | 1 | 0 | $0.35 |
| 2025-07-01 | 15 | NVDA | UNH | 1 | 1 | 4 | $1.75 |
| 2025-10-01 | 15 | JNJ, PLTR | COST, PG | 2 | 3 | 6 | $3.15 |
| 2026-01-02 | 15 | ABBV | NFLX | 1 | 2 | 4 | $2.10 |
| 2026-04-01 | 15 | BKNG, COST | ABBV, PLTR | 2 | 2 | 13 | $5.25 |
| 2026-07-01 | 15 | MU, AMD, AMAT, LRCX | BKNG, COST, NVDA, ORCL | 4 | 7 | 9 | $5.60 |
| 2026-10-01 | 15 | NVDA, ABBV | AMAT, LRCX | 2 | 3 | 4 | $2.45 |

### 入替理由（四半期ごと）

#### 2016-01-04（入替 15 銘柄）

**追加:** 
- **+AAPL**: eligible順位 1位→1位（時価総額上位15入り）
- **+GOOGL**: eligible順位 2位→2位（時価総額上位15入り）
- **+MSFT**: eligible順位 3位→3位（時価総額上位15入り）
- **+XOM**: eligible順位 4位→4位（時価総額上位15入り）
- **+AMZN**: eligible順位 5位→5位（時価総額上位15入り）
- **+FB**: eligible順位 6位→6位（時価総額上位15入り）
- **+JNJ**: eligible順位 7位→7位（時価総額上位15入り）
- **+PG**: eligible順位 8位→8位（時価総額上位15入り）
- **+PFE**: eligible順位 9位→9位（時価総額上位15入り）
- **+WMT**: eligible順位 10位→10位（時価総額上位15入り）
- **+T**: eligible順位 11位→11位（時価総額上位15入り）
- **+VZ**: eligible順位 12位→12位（時価総額上位15入り）
- **+KO**: eligible順位 13位→13位（時価総額上位15入り）
- **+HD**: eligible順位 15位→14位（時価総額上位15入り）
- **+CVX**: eligible順位 14位→15位（時価総額上位15入り）

**除外:** なし


#### 2016-04-01（入替 1 銘柄）

**追加:** 
- **+ORCL**: eligible順位 17位→15位（時価総額上位15入り）

**除外:** 
- **−HD**: eligible順位 14位→16位（上位15から落ち）

#### 2016-07-01（入替 1 銘柄）

**追加:** 
- **+GE**: 新規eligible化＋eligible順位 8位（上位15入り）

**除外:** 
- **−ORCL**: eligible順位 15位→16位（上位15から落ち）

#### 2016-10-03（入替 0 銘柄）

**追加:** なし


**除外:** なし


#### 2017-01-03（入替 0 銘柄）

**追加:** なし


**除外:** なし


#### 2017-04-03（入替 1 銘柄）

**追加:** 
- **+ORCL**: eligible順位 21位→14位（時価総額上位15入り）

**除外:** 
- **−CVX**: 赤字（TTM・filed PIT）

#### 2017-07-03（入替 1 銘柄）

**追加:** 
- **+CVX**: 新規eligible化＋eligible順位 14位（上位15入り）

**除外:** 
- **−VZ**: eligible順位 13位→17位（上位15から落ち）

#### 2017-10-02（入替 1 銘柄）

**追加:** 
- **+VZ**: eligible順位 17位→15位（時価総額上位15入り）

**除外:** 
- **−KO**: eligible順位 15位→17位（上位15から落ち）

#### 2018-01-02（入替 3 銘柄）

**追加:** 
- **+BA**: eligible順位 25位→8位（時価総額上位15入り）
- **+INTC**: eligible順位 19位→13位（時価総額上位15入り）
- **+HD**: eligible順位 16位→14位（時価総額上位15入り）

**除外:** 
- **−PFE**: eligible順位 12位→16位（上位15から落ち）
- **−GE**: eligible順位 13位→25位（上位15から落ち）
- **−ORCL**: eligible順位 14位→20位（上位15から落ち）

#### 2018-04-02（入替 2 銘柄）

**追加:** 
- **+UNH**: eligible順位 17位→12位（時価総額上位15入り）
- **+PFE**: eligible順位 16位→13位（時価総額上位15入り）

**除外:** 
- **−BA**: eligible順位 8位→17位（上位15から落ち）
- **−PG**: eligible順位 12位→16位（上位15から落ち）

#### 2018-07-02（入替 0 銘柄）

**追加:** なし


**除外:** なし


#### 2018-10-01（入替 2 銘柄）

**追加:** 
- **+CSCO**: 新規eligible化＋eligible順位 13位（上位15入り）
- **+BA**: eligible順位 17位→14位（時価総額上位15入り）

**除外:** 
- **−INTC**: eligible順位 11位→17位（上位15から落ち）
- **−T**: eligible順位 15位→16位（上位15から落ち）

#### 2019-01-02（入替 2 銘柄）

**追加:** 
- **+PG**: eligible順位 18位→13位（時価総額上位15入り）
- **+INTC**: eligible順位 17位→14位（時価総額上位15入り）

**除外:** 
- **−HD**: eligible順位 12位→19位（上位15から落ち）
- **−CSCO**: eligible順位 13位→20位（上位15から落ち）

#### 2019-04-01（入替 1 銘柄）

**追加:** 
- **+CSCO**: eligible順位 20位→12位（時価総額上位15入り）

**除外:** 
- **−BA**: eligible順位 7位→17位（上位15から落ち）

#### 2019-07-01（入替 2 銘柄）

**追加:** 
- **+T**: eligible順位 16位→11位（時価総額上位15入り）
- **+HD**: eligible順位 18位→15位（時価総額上位15入り）

**除外:** 
- **−INTC**: eligible順位 11位→19位（上位15から落ち）
- **−UNH**: eligible順位 15位→16位（上位15から落ち）

#### 2019-10-01（入替 2 銘柄）

**追加:** 
- **+KO**: eligible順位 17位→13位（時価総額上位15入り）
- **+INTC**: eligible順位 19位→14位（時価総額上位15入り）

**除外:** 
- **−PFE**: eligible順位 10位→22位（上位15から落ち）
- **−CSCO**: eligible順位 14位→20位（上位15から落ち）

#### 2020-01-02（入替 3 銘柄）

**追加:** 
- **+BA**: eligible順位 18位→8位（時価総額上位15入り）
- **+UNH**: eligible順位 19位→12位（時価総額上位15入り）
- **+DIS**: eligible順位 17位→13位（時価総額上位15入り）

**除外:** 
- **−HD**: eligible順位 11位→16位（上位15から落ち）
- **−KO**: eligible順位 13位→18位（上位15から落ち）
- **−CVX**: eligible順位 15位→19位（上位15から落ち）

#### 2020-04-01（入替 3 銘柄）

**追加:** 
- **+HD**: eligible順位 16位→13位（時価総額上位15入り）
- **+MRK**: eligible順位 17位→14位（時価総額上位15入り）
- **+KO**: eligible順位 18位→15位（時価総額上位15入り）

**除外:** 
- **−BA**: 赤字（TTM・filed PIT）
- **−XOM**: eligible順位 10位→21位（上位15から落ち）
- **−DIS**: eligible順位 13位→17位（上位15から落ち）

#### 2020-07-01（入替 2 銘柄）

**追加:** 
- **+NVDA**: eligible順位 23位→12位（時価総額上位15入り）
- **+NFLX**: eligible順位 20位→15位（時価総額上位15入り）

**除外:** 
- **−MRK**: eligible順位 14位→18位（上位15から落ち）
- **−KO**: eligible順位 15位→20位（上位15から落ち）

#### 2020-10-01（入替 2 銘柄）

**追加:** 
- **+ADBE**: eligible順位 16位→13位（時価総額上位15入り）
- **+CRM**: 新規eligible化＋eligible順位 15位（上位15入り）

**除外:** 
- **−INTC**: eligible順位 11位→16位（上位15から落ち）
- **−T**: eligible順位 14位→20位（上位15から落ち）

#### 2021-01-04（入替 1 銘柄）

**追加:** 
- **+TSLA**: 新規eligible化＋eligible順位 6位（上位15入り）

**除外:** 
- **−CRM**: eligible順位 15位→23位（上位15から落ち）

#### 2021-04-01（入替 2 銘柄）

**追加:** 
- **+INTC**: eligible順位 22位→13位（時価総額上位15入り）
- **+CMCSA**: eligible順位 16位→14位（時価総額上位15入り）

**除外:** 
- **−ADBE**: eligible順位 14位→17位（上位15から落ち）
- **−NFLX**: eligible順位 15位→16位（上位15から落ち）

#### 2021-07-01（入替 2 銘柄）

**追加:** 
- **+ADBE**: eligible順位 17位→13位（時価総額上位15入り）
- **+NKE**: eligible順位 22位→15位（時価総額上位15入り）

**除外:** 
- **−INTC**: eligible順位 13位→19位（上位15から落ち）
- **−VZ**: eligible順位 15位→17位（上位15から落ち）

#### 2021-10-01（入替 2 銘柄）

**追加:** 
- **+ISRG**: eligible順位 61位→11位（時価総額上位15入り）
- **+DIS**: 新規eligible化＋eligible順位 14位（上位15入り）

**除外:** 
- **−CMCSA**: eligible順位 14位→18位（上位15から落ち）
- **−NKE**: eligible順位 15位→21位（上位15から落ち）

#### 2022-01-03（入替 2 銘柄）

**追加:** 
- **+PFE**: eligible順位 20位→13位（時価総額上位15入り）
- **+AVGO**: eligible順位 34位→15位（時価総額上位15入り）

**除外:** 
- **−ISRG**: eligible順位 11位→58位（上位15から落ち）
- **−ADBE**: eligible順位 15位→16位（上位15から落ち）

#### 2022-04-01（入替 2 銘柄）

**追加:** 
- **+XOM**: 新規eligible化＋eligible順位 12位（上位15入り）
- **+CVX**: eligible順位 32位→13位（時価総額上位15入り）

**除外:** 
- **−DIS**: eligible順位 14位→21位（上位15から落ち）
- **−AVGO**: eligible順位 15位→19位（上位15から落ち）

#### 2022-07-01（入替 2 銘柄）

**追加:** 
- **+META**: 新規eligible化＋eligible順位 8位（上位15入り）
- **+LLY**: eligible順位 18位→14位（時価総額上位15入り）

**除外:** 
- **−FB**: S&P 500構成から除外
- **−CVX**: eligible順位 13位→16位（上位15から落ち）

#### 2022-10-03（入替 1 銘柄）

**追加:** 
- **+CVX**: eligible順位 16位→13位（時価総額上位15入り）

**除外:** 
- **−PFE**: eligible順位 13位→16位（上位15から落ち）

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
- **+AMZN**: 新規eligible化＋eligible順位 4位（上位15入り）
- **+AVGO**: eligible順位 18位→13位（時価総額上位15入り）
- **+ORCL**: eligible順位 19位→15位（時価総額上位15入り）

**除外:** 
- **−CVX**: eligible順位 12位→17位（上位15から落ち）
- **−HD**: eligible順位 14位→16位（上位15から落ち）
- **−ABBV**: eligible順位 15位→23位（上位15から落ち）

#### 2023-10-02（入替 1 銘柄）

**追加:** 
- **+CVX**: eligible順位 17位→15位（時価総額上位15入り）

**除外:** 
- **−ORCL**: eligible順位 15位→17位（上位15から落ち）

#### 2024-01-02（入替 1 銘柄）

**追加:** 
- **+HD**: eligible順位 16位→15位（時価総額上位15入り）

**除外:** 
- **−CVX**: eligible順位 15位→20位（上位15から落ち）

#### 2024-04-01（入替 0 銘柄）

**追加:** なし


**除外:** なし


#### 2024-07-01（入替 3 銘柄）

**追加:** 
- **+SMCI**: eligible順位 124位→11位（時価総額上位15入り）
- **+ORCL**: eligible順位 16位→13位（時価総額上位15入り）
- **+COST**: eligible順位 18位→15位（時価総額上位15入り）

**除外:** 
- **−NVDA**: eligible順位 3位→19位（上位15から落ち）
- **−JNJ**: eligible順位 13位→16位（上位15から落ち）
- **−HD**: eligible順位 15位→17位（上位15から落ち）

#### 2024-10-01（入替 2 銘柄）

**追加:** 
- **+LRCX**: eligible順位 53位→6位（時価総額上位15入り）
- **+HD**: eligible順位 17位→15位（時価総額上位15入り）

**除外:** 
- **−SMCI**: eligible順位 11位→269位（上位15から落ち）
- **−COST**: eligible順位 15位→17位（上位15から落ち）

#### 2025-01-02（入替 1 銘柄）

**追加:** 
- **+COST**: eligible順位 17位→13位（時価総額上位15入り）

**除外:** 
- **−LRCX**: eligible順位 6位→79位（上位15から落ち）

#### 2025-04-01（入替 1 銘柄）

**追加:** 
- **+NFLX**: eligible順位 16位→15位（時価総額上位15入り）

**除外:** 
- **−HD**: eligible順位 15位→18位（上位15から落ち）

#### 2025-07-01（入替 1 銘柄）

**追加:** 
- **+NVDA**: eligible順位 22位→15位（時価総額上位15入り）

**除外:** 
- **−UNH**: eligible順位 11位→21位（上位15から落ち）

#### 2025-10-01（入替 2 銘柄）

**追加:** 
- **+JNJ**: eligible順位 16位→14位（時価総額上位15入り）
- **+PLTR**: eligible順位 19位→15位（時価総額上位15入り）

**除外:** 
- **−COST**: eligible順位 13位→17位（上位15から落ち）
- **−PG**: eligible順位 14位→19位（上位15から落ち）

#### 2026-01-02（入替 1 銘柄）

**追加:** 
- **+ABBV**: eligible順位 16位→14位（時価総額上位15入り）

**除外:** 
- **−NFLX**: eligible順位 11位→16位（上位15から落ち）

#### 2026-04-01（入替 2 銘柄）

**追加:** 
- **+BKNG**: eligible順位 48位→3位（時価総額上位15入り）
- **+COST**: eligible順位 17位→13位（時価総額上位15入り）

**除外:** 
- **−ABBV**: eligible順位 14位→19位（上位15から落ち）
- **−PLTR**: eligible順位 15位→20位（上位15から落ち）

#### 2026-07-01（入替 4 銘柄）

**追加:** 
- **+MU**: eligible順位 16位→8位（時価総額上位15入り）
- **+AMD**: eligible順位 21位→10位（時価総額上位15入り）
- **+AMAT**: eligible順位 29位→14位（時価総額上位15入り）
- **+LRCX**: eligible順位 30位→15位（時価総額上位15入り）

**除外:** 
- **−BKNG**: eligible順位 3位→68位（上位15から落ち）
- **−COST**: eligible順位 13位→21位（上位15から落ち）
- **−NVDA**: eligible順位 14位→16位（上位15から落ち）
- **−ORCL**: eligible順位 15位→20位（上位15から落ち）

#### 2026-10-01（入替 2 銘柄）

**追加:** 
- **+NVDA**: eligible順位 16位→14位（時価総額上位15入り）
- **+ABBV**: eligible順位 19位→15位（時価総額上位15入り）

**除外:** 
- **−AMAT**: eligible順位 14位→19位（上位15から落ち）
- **−LRCX**: eligible順位 15位→18位（上位15から落ち）


<details>
<summary>全リバランス日の保有15（クリックで展開）</summary>

| 日付 | 保有ティッカー |
|---|---|
| 2016-01-04 | AAPL, GOOGL, MSFT, XOM, AMZN, FB, JNJ, PG, PFE, WMT, T, VZ, KO, HD, CVX |
| 2016-04-01 | AAPL, GOOGL, MSFT, XOM, FB, JNJ, AMZN, T, PG, VZ, WMT, KO, PFE, CVX, ORCL |
| 2016-07-01 | AAPL, GOOGL, MSFT, XOM, AMZN, JNJ, FB, GE, T, VZ, PG, WMT, PFE, CVX, KO |
| 2016-10-03 | AAPL, GOOGL, MSFT, AMZN, FB, XOM, JNJ, GE, T, PG, WMT, VZ, PFE, CVX, KO |
| 2017-01-03 | AAPL, GOOGL, MSFT, XOM, AMZN, FB, JNJ, GE, T, VZ, CVX, PG, WMT, PFE, KO |
| 2017-04-03 | AAPL, GOOGL, MSFT, AMZN, FB, XOM, JNJ, GE, T, PG, WMT, PFE, VZ, ORCL, KO |
| 2017-07-03 | AAPL, GOOGL, MSFT, AMZN, FB, JNJ, XOM, GE, T, PG, WMT, ORCL, PFE, CVX, KO |
| 2017-10-02 | AAPL, GOOGL, MSFT, FB, AMZN, JNJ, XOM, T, WMT, PG, CVX, PFE, GE, ORCL, VZ |
| 2018-01-02 | AAPL, GOOGL, MSFT, AMZN, FB, JNJ, XOM, BA, WMT, CVX, T, PG, INTC, HD, VZ |
| 2018-04-02 | AAPL, GOOGL, MSFT, AMZN, FB, JNJ, XOM, WMT, INTC, T, CVX, UNH, PFE, HD, VZ |
| 2018-07-02 | AAPL, AMZN, GOOGL, MSFT, FB, XOM, JNJ, WMT, CVX, UNH, INTC, HD, PFE, VZ, T |
| 2018-10-01 | AAPL, AMZN, MSFT, GOOGL, FB, JNJ, XOM, WMT, PFE, UNH, CVX, HD, CSCO, BA, VZ |
| 2019-01-02 | MSFT, AMZN, AAPL, GOOGL, FB, JNJ, BA, XOM, WMT, PFE, UNH, VZ, PG, INTC, CVX |
| 2019-04-01 | MSFT, AMZN, AAPL, GOOGL, FB, JNJ, XOM, WMT, PG, VZ, INTC, CSCO, PFE, CVX, UNH |
| 2019-07-01 | MSFT, AMZN, AAPL, GOOGL, FB, JNJ, XOM, WMT, PG, PFE, T, CVX, VZ, CSCO, HD |
| 2019-10-01 | MSFT, AAPL, AMZN, GOOGL, FB, JNJ, WMT, PG, XOM, T, HD, VZ, KO, INTC, CVX |
| 2020-01-02 | AAPL, MSFT, AMZN, GOOGL, FB, JNJ, WMT, BA, PG, XOM, T, UNH, DIS, INTC, VZ |
| 2020-04-01 | MSFT, AAPL, AMZN, GOOGL, FB, JNJ, WMT, PG, UNH, INTC, VZ, T, HD, MRK, KO |
| 2020-07-01 | AAPL, MSFT, AMZN, GOOGL, FB, JNJ, WMT, PG, UNH, HD, INTC, NVDA, VZ, T, NFLX |
| 2020-10-01 | AAPL, AMZN, MSFT, GOOGL, FB, WMT, JNJ, PG, NVDA, HD, UNH, VZ, ADBE, NFLX, CRM |
| 2021-01-04 | AAPL, MSFT, AMZN, GOOGL, FB, TSLA, WMT, JNJ, PG, UNH, NVDA, HD, VZ, ADBE, NFLX |
| 2021-04-01 | AAPL, MSFT, AMZN, GOOGL, FB, TSLA, JNJ, WMT, UNH, NVDA, HD, PG, INTC, CMCSA, VZ |
| 2021-07-01 | AAPL, MSFT, AMZN, GOOGL, FB, TSLA, NVDA, JNJ, WMT, UNH, HD, PG, ADBE, CMCSA, NKE |
| 2021-10-01 | AAPL, MSFT, GOOGL, AMZN, FB, TSLA, NVDA, JNJ, WMT, UNH, ISRG, HD, PG, DIS, ADBE |
| 2022-01-03 | AAPL, MSFT, GOOGL, AMZN, TSLA, FB, NVDA, UNH, JNJ, HD, WMT, PG, PFE, DIS, AVGO |
| 2022-04-01 | AAPL, MSFT, GOOGL, AMZN, TSLA, NVDA, FB, UNH, JNJ, WMT, PG, XOM, CVX, HD, PFE |
| 2022-07-01 | GOOGL, AAPL, MSFT, AMZN, TSLA, UNH, JNJ, META, XOM, NVDA, PG, WMT, PFE, LLY, HD |
| 2022-10-03 | AAPL, MSFT, GOOGL, AMZN, TSLA, UNH, JNJ, XOM, META, WMT, NVDA, PG, CVX, HD, LLY |
| 2023-01-03 | AAPL, MSFT, GOOGL, AMZN, UNH, JNJ, XOM, WMT, PG, NVDA, TSLA, CVX, META, LLY, HD |
| 2023-04-03 | AAPL, MSFT, GOOGL, NVDA, TSLA, META, XOM, UNH, JNJ, WMT, PG, CVX, LLY, HD, ABBV |
| 2023-07-03 | AAPL, MSFT, GOOGL, AMZN, NVDA, TSLA, META, UNH, XOM, WMT, JNJ, LLY, AVGO, PG, ORCL |
| 2023-10-02 | AAPL, MSFT, GOOGL, AMZN, NVDA, TSLA, META, LLY, UNH, XOM, WMT, JNJ, AVGO, PG, CVX |
| 2024-01-02 | AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA, LLY, AVGO, UNH, WMT, XOM, JNJ, PG, HD |
| 2024-04-01 | MSFT, AAPL, NVDA, GOOGL, AMZN, META, LLY, AVGO, TSLA, WMT, XOM, UNH, JNJ, PG, HD |
| 2024-07-01 | MSFT, AAPL, GOOGL, AMZN, META, LLY, AVGO, TSLA, WMT, XOM, SMCI, UNH, ORCL, PG, COST |
| 2024-10-01 | AAPL, MSFT, GOOGL, AMZN, META, LRCX, TSLA, LLY, AVGO, WMT, UNH, XOM, ORCL, PG, HD |
| 2025-01-02 | AAPL, MSFT, AMZN, GOOGL, META, TSLA, AVGO, WMT, LLY, XOM, ORCL, UNH, COST, PG, HD |
| 2025-04-01 | AAPL, MSFT, AMZN, GOOGL, META, TSLA, AVGO, LLY, WMT, XOM, UNH, COST, PG, ORCL, NFLX |
| 2025-07-01 | MSFT, AAPL, AMZN, GOOGL, META, AVGO, TSLA, WMT, LLY, ORCL, NFLX, XOM, COST, PG, NVDA |
| 2025-10-01 | MSFT, AAPL, GOOGL, AMZN, META, AVGO, TSLA, ORCL, WMT, LLY, NFLX, XOM, NVDA, JNJ, PLTR |
| 2026-01-02 | AAPL, GOOGL, MSFT, AMZN, AVGO, TSLA, META, LLY, WMT, ORCL, XOM, JNJ, NVDA, ABBV, PLTR |
| 2026-04-01 | AAPL, GOOGL, BKNG, MSFT, AMZN, AVGO, META, TSLA, WMT, LLY, XOM, JNJ, COST, NVDA, ORCL |
| 2026-07-01 | GOOGL, AAPL, MSFT, AMZN, AVGO, TSLA, META, MU, LLY, AMD, WMT, JNJ, XOM, AMAT, LRCX |
| 2026-10-01 | AAPL, GOOGL, MSFT, AMZN, META, AVGO, TSLA, MU, LLY, AMD, WMT, XOM, JNJ, NVDA, ABBV |

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
| 2016-Q2 | 2 | 1 | 1 | $0.70 | $5.60 | $2.00 | $16.00 |
| 2016-Q3 | 0 | 0 | 0 | $0.00 | $5.60 | $0.00 | $16.00 |
| 2016-Q4 | 1 | 0 | 1 | $0.35 | $5.95 | $1.00 | $17.00 |
| 2017-Q1 | 0 | 0 | 0 | $0.00 | $5.95 | $0.00 | $17.00 |
| 2017-Q2 | 2 | 1 | 1 | $0.70 | $6.65 | $2.00 | $19.00 |
| 2017-Q3 | 2 | 1 | 1 | $0.70 | $7.35 | $2.00 | $21.00 |
| 2017-Q4 | 2 | 1 | 1 | $0.70 | $8.05 | $2.00 | $23.00 |
| 2018-Q1 | 11 | 6 | 5 | $3.85 | $11.90 | $11.00 | $34.00 |
| 2018-Q2 | 6 | 4 | 2 | $2.10 | $14.00 | $6.00 | $40.00 |
| 2018-Q3 | 1 | 0 | 1 | $0.35 | $14.35 | $1.00 | $41.00 |
| 2018-Q4 | 6 | 4 | 2 | $2.10 | $16.45 | $6.00 | $47.00 |
| 2019-Q1 | 4 | 3 | 1 | $1.40 | $17.85 | $4.00 | $51.00 |
| 2019-Q2 | 2 | 1 | 1 | $0.70 | $18.55 | $2.00 | $53.00 |
| 2019-Q3 | 6 | 3 | 3 | $2.10 | $20.65 | $6.00 | $59.00 |
| 2019-Q4 | 4 | 3 | 1 | $1.40 | $22.05 | $4.00 | $63.00 |
| 2020-Q1 | 8 | 6 | 2 | $2.80 | $24.85 | $8.00 | $71.00 |
| 2020-Q2 | 7 | 5 | 2 | $2.45 | $27.30 | $7.00 | $78.00 |
| 2020-Q3 | 4 | 2 | 2 | $1.40 | $28.70 | $4.00 | $82.00 |
| 2020-Q4 | 5 | 3 | 2 | $1.75 | $30.45 | $5.00 | $87.00 |
| 2021-Q1 | 8 | 0 | 8 | $2.80 | $33.25 | $8.00 | $95.00 |
| 2021-Q2 | 4 | 3 | 1 | $1.40 | $34.65 | $4.00 | $99.00 |
| 2021-Q3 | 5 | 3 | 2 | $1.75 | $36.40 | $5.00 | $104.00 |
| 2021-Q4 | 6 | 2 | 4 | $2.10 | $38.50 | $6.00 | $110.00 |
| 2022-Q1 | 6 | 3 | 3 | $2.10 | $40.60 | $6.00 | $116.00 |
| 2022-Q2 | 4 | 2 | 2 | $1.40 | $42.00 | $4.00 | $120.00 |
| 2022-Q3 | 15 | 3 | 12 | $5.25 | $47.25 | $15.00 | $135.00 |
| 2022-Q4 | 14 | 2 | 12 | $4.90 | $52.15 | $14.00 | $149.00 |
| 2023-Q1 | 0 | 0 | 0 | $0.00 | $52.15 | $0.00 | $149.00 |
| 2023-Q2 | 8 | 2 | 6 | $2.80 | $54.95 | $8.00 | $157.00 |
| 2023-Q3 | 12 | 5 | 7 | $4.20 | $59.15 | $12.00 | $169.00 |
| 2023-Q4 | 0 | 0 | 0 | $0.00 | $59.15 | $0.00 | $169.00 |
| 2024-Q1 | 3 | 0 | 3 | $1.05 | $60.20 | $3.00 | $172.00 |
| 2024-Q2 | 2 | 0 | 2 | $0.70 | $60.90 | $2.00 | $174.00 |
| 2024-Q3 | 16 | 4 | 12 | $5.60 | $66.50 | $16.00 | $190.00 |
| 2024-Q4 | 12 | 2 | 10 | $4.20 | $70.70 | $12.00 | $202.00 |
| 2025-Q1 | 10 | 2 | 8 | $3.50 | $74.20 | $10.00 | $212.00 |
| 2025-Q2 | 1 | 1 | 0 | $0.35 | $74.55 | $1.00 | $213.00 |
| 2025-Q3 | 5 | 1 | 4 | $1.75 | $76.30 | $5.00 | $218.00 |
| 2025-Q4 | 9 | 3 | 6 | $3.15 | $79.45 | $9.00 | $227.00 |
| 2026-Q1 | 6 | 2 | 4 | $2.10 | $81.55 | $6.00 | $233.00 |
| 2026-Q2 | 15 | 2 | 13 | $5.25 | $86.80 | $15.00 | $248.00 |
| 2026-Q3 | 16 | 7 | 9 | $5.60 | $92.40 | $16.00 | $264.00 |
| 2026-Q4 | 7 | 3 | 4 | $2.45 | $94.85 | $7.00 | $271.00 |

**定義:** **スワップ系**＝そのリバランスで「前回は保有15に無かった銘柄」への新規買い、または「今回の15から外れた銘柄」の売却に伴う注文。**リウェイト系**＝継続保有銘柄のウェイト調整注文。

---

## (4) 寄与分析（2025-07-01 ～ 2026-10-02）

**方法:** 各営業日、前日終値ベースのポートフォリオウェイト × 銘柄日次リターンを積み上げ（リバランス日は目標ウェイトにリセット・手数料は本節では控除しない簡易版）。


| 銘柄 | 寄与（%ポイント） | 寄与（$・$3,200ベース） | 半導体 |
|---|---:|---:|---|
| GOOGL | +9.37pt | +$300 | — |
| AAPL | +7.86pt | +$251 | — |
| AVGO | +2.25pt | +$72 | 半導体 |
| AMZN | +1.64pt | +$52 | — |
| LLY | +1.31pt | +$42 | — |
| XOM | +1.07pt | +$34 | — |
| TSLA | +1.01pt | +$32 | — |
| MSFT | +0.84pt | +$27 | — |
| JNJ | +0.77pt | +$25 | — |
| AMD | +0.57pt | +$18 | 半導体 |
| WMT | +0.36pt | +$12 | — |
| MU | +0.16pt | +$5 | 半導体 |
| NVDA | +0.13pt | +$4 | 半導体 |
| META | +0.12pt | +$4 | — |
| PG | -0.08pt | $-3 | — |
| ABBV | -0.09pt | $-3 | — |
| COST | -0.25pt | $-8 | — |
| LRCX | -0.26pt | $-8 | 半導体 |
| AMAT | -0.39pt | $-12 | 半導体 |
| NFLX | -0.73pt | $-23 | — |

- 期間ポートリターン: **26.03%**（単純リプレイ・差分リバランス近似）
- 同期間 SPY: **26.30%** → ギャップ **-0.27pt**
- 半導体サブ業種の寄与合計: **2.47pt**（全寄与の **10%**）
- 上位1/3/5銘柄の寄与シェア: **38% / 78% / 90%**
- 上位1銘柄を除いた場合の期間リターン（寄与差し引き）: **16.67%**
- 上位3銘柄を除いた場合: **6.55%**

**解釈（ギャップの単純分解）:** 本構成は金融セクターとテーマ株を持たないため SPY より大型金融・一部超大型のウェイトが薄い。期間中は半導体・大型テックの寄与がポート側のドライバーとなり、除外セクターが SPY にあって本ポートに無い分がギャップの主因となり得る（厳密な要因分析ではない）。


![寄与（上位銘柄）](round19_v1_contribution.png)

---

## (5) 最終リバランス（2026-10-01）で持っていない銘柄

### S&P 構成員の時価総額上位40のうち、保有15外

**eligibleだが上位15外**
  - PLTR（S&P時価総額順 20位・約457B USD）
  - CSCO（S&P時価総額順 21位・約429B USD）
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
  - PM（S&P時価総額順 37位・約293B USD）
  - NFLX（S&P時価総額順 38位・約283B USD）
  - HD（S&P時価総額順 39位・約282B USD）

**株クラス重複で除外**
  - GOOG（S&P時価総額順 3位・約4096B USD）

**赤字（TTM・filed PIT）**
  - INTC（S&P時価総額順 16位・約605B USD）
  - CRWD（S&P時価総額順 40位・約272B USD）

**金融セクター除外**
  - JPM（S&P時価総額順 12位・約886B USD）
  - MA（S&P時価総額順 18位・約488B USD）
  - BAC（S&P時価総額順 28位・約376B USD）
  - MS（S&P時価総額順 36位・約295B USD）

### eligible プールの16～25位（惜しくも15入りしなかった銘柄）

| eligible順位 | ティッカー | 時価総額（約・B USD） |
|---:|---|---:|
| 16 | PLTR | 457 |
| 17 | CSCO | 429 |
| 18 | LRCX | 426 |
| 19 | AMAT | 420 |
| 20 | ORCL | 417 |
| 21 | CVX | 409 |
| 22 | COST | 406 |
| 23 | CAT | 380 |
| 24 | KO | 370 |
| 25 | MRK | 355 |

---

## (6) 暦年リターン vs SPY・最大ドローダウン

**暦年:** 前年最終営業日終値ベース（`calendarYearReturn`）。

| 年 | plain_15__mcap | SPY | 差 |
|---|---:|---:|---:|
| 2017 | 24.0% | 21.7% | 2.3pt |
| 2018 | 0.6% | -4.6% | 5.2pt |
| 2019 | 34.2% | 31.2% | 2.9pt |
| 2020 | 33.7% | 18.3% | 15.3pt |
| 2021 | 34.6% | 28.7% | 5.8pt |
| 2022 | -31.3% | -18.2% | -13.1pt |
| 2023 | 52.9% | 26.2% | 26.7pt |
| 2024 | 42.4% | 24.9% | 17.6pt |
| 2025 | 18.5% | 17.7% | 0.8pt |
| 2026 | 6.3% | 13.7% | -7.4pt |

### 最大ドローダウン（2016-01-01–2026-10-02）

| | 採用構成 | SPY |
|---|---|---|
| ピーク日 | 2022-01-03 | 2020-02-19 |
| ボトム日 | 2023-01-05 | 2020-03-23 |
| 深さ | -34.6% | -33.7% |
| 回復 | 2023-11-14 | 2020-08-10 |
| 回復営業日数 | 216 | 97 |

**OOS 期間のみの MaxDD:** 採用 **-34.6%**（ピーク 2022-01-03 → ボトム 2023-01-05） vs SPY **-24.5%** — 事前登録合格②は **不合格**。

上表の全期間最大 DD は主に **2022–2023 の株式調整**（ピーク **2022-01-03**、ボトム **2023-01-05**、回復 **2023-11-14**）に由来する。

---

## (7) ライブ窓シミュレーション（2026-07-30 ～ 2026-10-02）


**窓:** 2026-07-30 終値時点で **¥463,000** を USD へ換算し投資（USD/JPY **163.30** → 2026-10-02 時点 **157.93**）。  
**保有の起点:** 2026-07-01 リバランスの採用15（plain_15__mcap）。**2026-10-02** までに **2026-10-01** リバランスを適用。手数料 **$0.35/注文**（差分リバランス）。

| | USD建て | 円建て（日次 USD/JPY で換算） |
|---|---:|---:|
| 期間リターン | 7.63% | 4.09% |
| 最大DD | -3.08%（ピーク 2026-08-04 → ボトム 2026-08-20） | -4.97%（ピーク 2026-08-10 → ボトム 2026-09-09） |

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
| 時価総額 `mcap = 終値 × 株数`（PIT） | 株数 `pit-shares.ts` / `sharesOutstandingAsOf`；詳細レポートの `buildCtx` で stale 株数繰越 |
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
| 2026-01-02 | 0.267 | 0.273 | 0.939 | 1.203 | — | — |
| 2026-04-01 | 0.193 | 0.257 | 0.945 | 1.109 | 0.917 | 1.152 |
| 2026-07-01 | 0.112 | 0.130 | 0.899 | 1.353 | 0.904 | 1.233 |
| 2026-10-01 | 0.091 | 0.085 | 0.896 | 1.260 | 0.905 | 1.212 |

### 全リバランス平均（44 四半期）

| | ρ中央値 | ρ平均 | ρ(ポート,SPY) 1y | β vs SPY 1y | ρ(ポート,SPY) 全期間 | β vs SPY 全期間 |
|---|---:|---:|---:|---:|---:|---:|
| 平均 | 0.311 | 0.327 | 0.900 | 1.128 | 0.893 | 1.076 |


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
| `cc6ffaa` | 2026/10/5 11:02:00 JST | fix(round19): HOLX shares tag, CIK overrides in buildCtx, report N=20 labels |

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
7. **STOP-SHIP 修正**（`216dfc6` 以降、`cc6ffaa` 付近）: PIT mcap（`mcapC`）、ATVI/CERN エイリアス、GOOGL レガシー facts、**HOLX `CommonStockSharesIssued` 300B 誤株数**（`pit-shares.ts`）、**XOM CIK override を `buildCtx` 全体に適用**、MaxDD ピーク日、USD/JPY など。**本レポートは再生成版であり、採用構成 ID はまた変わる可能性がある**。

**結論:** 「2016–2020 のみでルールを決め、2021+ は一度だけ評価」は **手順として事前登録されている**が、**データ修正と再実行により採用構成は初回結果（`plain_15__equal`）と異なる**。OOS を **設計に使った**というより、**公開後にデータを直し IS をやり直した**のが正確。


---

## 解釈（全体）

- **plain_15__mcap** は mega-cap 寄りだが **5%キャップ** により単一超大株依存を抑える設計。
- Corrected v1 のデータ拡充で eligible が増え、四半期漏斗の「価格なし」は後年ほぼ解消（詳細は `ROUND19_AUDIT_ja.md`）。
- v2（ウォークフォワード主評価）は **DRAFT のみ**・本レポートの対象外。

*生成: `npx tsx scripts/round19-v1-detail-report.ts`*
