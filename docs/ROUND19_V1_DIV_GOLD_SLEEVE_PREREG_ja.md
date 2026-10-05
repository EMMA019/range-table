# Round 19 v1 構成実験：mcap 75% + 高配当 20% + 金 5%

**状態:** 事前登録（prereg）。**本ファイルコミット時点ではバックテスト数値を一切見ていない。**
**ベースライン:** 修正後採用 `plain_15__mcap`（PR #49 / `cursor/mcap-leak-audit-1425`）。
**生成予定:** `scripts/round19-v1-div-gold-sleeve.ts` → `docs/ROUND19_V1_DIV_GOLD_SLEEVE_RESULTS_ja.md`
**サイト非掲載。** main マージ・サイトデプロイなし。v2 探索なし。`src/lib/paper.ts` 非接触。

---

## 1. 研究目的（仮説）

| ID | 仮説 |
|---|---|
| H1 | ブックの **75% mcap + 20% 高配当大型 + 5% 金（GLD）** にすると、修正後 `plain_15__mcap` より **元本割れの深さ／水中時間**が改善する、または同等の元本耐性を保ちつつ **総リターン（配当込み）** が SPY を上回りやすい。 |
| H2 | **GOOGL / MSFT / META** を合計 **1 名**に抑える variant は、**2 名** variant より **AI ティルト %** と mega-tech 集中を下げ、元本指標を悪化させない（または改善する）。 |
| H3 | **NVDA / AVGO / AMD / MU** のペア相関が高い四半期では、半導体サブ業種バジェット内で **間引き（thinning）** すると、半導体 % の振れを抑え、元本指標または MaxDD を改善しうる。 |
| H4 | 高配当スリーブは価格リターンだけの mcap 100% より、**配当込み総リターン**と **元本割れ**のトレードオフが有利側に寄る。 |

---

## 2. ブック配分（固定）

| スリーブ | ブックウェイト | 銘柄数 N | スリーブ内ウェイト |
|---|---:|---:|---|
| **Mcap** | **75%** | **11** | PIT 時価比例（`plain_15__mcap` と同 spirit）→ スリーブ内で正規化 → **`applySemiCap`（30%）をスリーブ内ウェイトに適用**（現行 v1 と同じ半導体サブ業種定義）→ ブック全体に ×0.75 |
| **高配当大型** | **20%** | **4** | スリーブ内 **均等**（各 5% ブック） |
| **金 ETF** | **5%** | **1** | **GLD** 固定 5%（後述のデータ欠損時のみ IAU 等へフォールバックし結果 doc に明記） |

合計保有 **16 銘柄**（11+4+1）。ベースラインは N=15 の単一 mcap バスケット。

---

## 3. ユニバースと除外（Emma 定常ルール）

Mcap・高配当スリーブ共通の eligible は、現行 `filterEligibleCandidates` と同じ:

- S&P PIT 構成銘柄（当該リバランス日）
- **テーマ除外:** quantum / space（**SPCX のみ例外なし**—SPCX は S&P 構成に通常無し）/ crypto / solar / nuclear（`isExcludedTheme` / `themes.ts`）
- **金融:** GICS Sector = Financials 除外
- **価格 PIT あり**（`hasPrice`）
- **TTM 黒字**（`profitabilityStatus === profitable`）。**2023-04 AMZN 赤字除外**は既存データパスそのまま（ルール変更なし）
- 同一 CIK 優先株クラス dedupe（`cikOf` + mcap）

**Mcap スリーブ追加制約**

1. **AAPL** は mcap 順位に関わらず採用可（GOOGL/MSFT/META  cap とは別枠）。
2. **Mega-tech cap:** 集合 **{GOOGL, MSFT, META}**（FB は META 連続扱いで META に統合）から、採用数上限 **K ∈ {1, 2}**（2 variant）。上限超過時は **PIT mcap 降順で先に入ったものを残し、後続をスキップ**して次点 mcap を採用。
3. **半導体間引き（semiThin）:** 候補確定後、**{NVDA, AVGO, AMD, MU} のうち mcap スリーブに入っている銘柄**について、リバランス日時点の **252 営業日**対数リターン（`SAKA_CORR_LOOKBACK`）でペア相関行列を計算。
   - **高相関:** 4 銘柄中 **3 ペア以上**が ρ ≥ **0.65**、または **平均ペア ρ ≥ 0.70**。
   - **thin 実行時:** 上記 4 つのうち **PIT mcap が最小の銘柄から 1 つずつ除外**し、高相関条件が解消するか **4 つ中 2 つ以下**になるまで繰り返す（最大 2 銘柄削除）。空いた枠は **eligible mcap 順位の次点**で埋める（mega-tech cap・semi cap 再適用）。
   - **semiThin=off:** 間引きなし（相関は結果 doc に報告のみ）。

**高配当スリーブ**

- 対象: 上記 eligible のうち **PIT mcap ≥ 300 億 USD**（大型）。
- **Mcap スリーブ 11 銘柄と重複不可**（同 ticker は mcap 側優先）。
- 順位: リバランス日の **trailing 12 ヶ月キャッシュ配当利回り** =（過去 365 日カレンダーに ex-date が落ちる Yahoo `dividends` イベントの合計 / 株）÷ 当日 PIT 価格（`mcapCloseOnOrBefore`）。データ欠損は利回り 0 扱いで順位下位。
- 上位 **4** 銘柄を採用。

**金**

- 第一選択 **GLD**（SPDR Gold Shares）。PIT キャッシュに無い場合は実行時 Yahoo adjclose（`fetchDailyBars` totalReturn）を **ローカル `.cache` のみ**に取得（git 非コミット）。
- フォールバック: GLD 取得不能かつ **IAU** 取得可 → IAU を 5% にし結果 doc で明記。両方不可なら **金 5% は未計算**（他スリーブ比率は prereg どおり固定せず、実装 doc に「blocked」と記載）。

---

## 4. リバランス・シミュレーション

- 日付: `rebalanceDates`（2016-01-01 ～ 2026-10-02、四半期初 SPY セッション）。
- 取引: 修正後 v1 と同じ **差分リバランス**（`simulateSaka` delta、`SAKA_REBAL_MIN_TRADE_USD` / `SAKA_REBAL_REL_DRIFT`、手数料 $0.35/注文）。
- 同一 CIK リネーム: `buildSameCikHandoffResolver` + `applySameCikHandoffTransfers`。
- 初期元本: `SAKA_INITIAL_CASH`（$3,200）。
- **価格リターン（配当込み）:** PIT 価格系列の `c`（データセット構築時 Yahoo **adjclose** 系）+ GLD/欠損銘柄は実行時 adjclose。Mcap **選定**は従来どおり PIT mcap（名目優先 `pitMarketCapAtDate`）。

---

## 5. 比較 variant（結果探索は prereg 後のみ）

| ID | Mega-tech K (GOOGL/MSFT/META) | Semi thin |
|---|---|---|
| `divGold_K1_thin` | 1 | on |
| `divGold_K1_keep` | 1 | off |
| `divGold_K2_thin` | 2 | on |
| `divGold_K2_keep` | 2 | off |

**ベースライン:** `plain_15__mcap`（100% mcap N=15、半導体 30% cap、mega-tech 制限なし）。

---

## 6. 評価指標（優先順）

全 variant + ベースライン + **SPY**（同日開始・手数料なし buy-hold、adjclose 系）。

1. **元本割れ（Emma 主軸）** — `round19-v1-principal-stress.ts` と同型:
   - 各 **月初 SPY セッション**開始、当該日以前最後の四半期 PIT でブック固定、2026-10-02 まで。
   - **最深元本割れ**（min NAV/元本−1）の **中央値・10% 分位**。
   - **材料割れ**（最深 < −1%）の割合。
   - **水中取引日**中央値（参考）。
2. **総リターン（配当込み）** — 2016 最初のリバランス整列 ～ `SAKA_END` の **累積リターン**（adjclose 系）。
3. **AI ティルト %** — [`ROUND19_V1_ANNUAL_HOLDINGS_ja.md`](ROUND19_V1_ANNUAL_HOLDINGS_ja.md) と同一定義（半導体 ∪ 明示 AI リスト）。**2026 年次スナップショット日（2026-10-01）** と **全期間平均（各四半期リバランス後ウェイトの算術平均）**。
4. **半導体 %** — 同上（`isSemiSubIndustry` 合計）。
5. **参考:** CAGR / 古典 MaxDD（`metricsFromCurve`）— 報告するが **採否判定には使わない**。

---

## 7. 勝者判定（事前規定）

**Primary（必須）:** variant がベースラインより

- 材料割れ率 **低下**、または最深中央値 **改善（浅い）** のどちらかを満たす、**かつ**
- 全期間総リターンが **ベースライン − 2.0%pt 以上劣化しない**。

**Secondary:** Primary を満たす候補が複数なら

1. 総リターン（配当込み）最大  
2. 2026 スナップショット AI ティルト % が低い（同点なら semi % 低い）  
3. Mega-tech K=1 を K=2 より優先（Emma 集中度回避）

**悪化:** 最深 10% 分位が **0.5%pt 以上深い** かつ 総リターン改善 **< 1%pt** → 「ベースラインより悪化」。

**SPY 比:** 別枠で記載（採否には SPY 単独勝ちを要求しない）。

---

## 8. 報告物（prereg 後）

- `docs/ROUND19_V1_DIV_GOLD_SLEEVE_RESULTS_ja.md`（スマホ可表格）
- セクション: ベースライン vs 4 variant vs SPY、**NVDA/AVGO/AMD/MU 相関行列**（2024–2026 代表リバランス + thin 採用例）、**mega-tech K=1 vs K=2** 比較、年次 AI/semi 推移要約
- データギャップは **not computed** と明記（数値の捏造禁止）

---

## 9. 非目標

- 追加の防御スリーブ（債券・現金ルール・含み益再配分等）— **本 prereg の 5% 金以外は入れない**。
- グリッド拡大・DD 目的のルール探索。
- mcap リーク在庫 35 件の追加修正。

---

*事前登録のみ。結果数値は別コミット。*
