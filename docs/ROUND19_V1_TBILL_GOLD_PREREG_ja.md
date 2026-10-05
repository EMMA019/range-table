# Round 19 v1 構成実験：mcap 75% + 短期国債 ETF + 金（0–5%）

**状態:** 事前登録（prereg）。**本ファイルコミット時点ではバックテスト数値なし。**
**ベースライン:** 修正後 `plain_15__mcap`。
**参照（比較のみ・採用候補外）:** 既存 `divGold_K1/K2`（75/20/5 高配当+金）、**IEF**（中期国債・参考ブック）。
**生成予定:** `scripts/round19-v1-tbill-gold-sleeve.ts` → `docs/ROUND19_V1_TBILL_GOLD_RESULTS_ja.md`
**サイト非掲載。** main マージ・デプロイなし。`src/lib/paper.ts` 非接触。

---

## 1. 背景（Emma 更新）

高配当 20% + 金 5% の **divGold** より、**短期米国債 ETF** を防御スリーブにした構成を優先して試す。採否ルールは **既存 DIV_GOLD prereg §7 と同一**（Primary: 材料割れ改善または元本中央改善 **かつ** 総リターン ≥ baseline − 2%pt）。

---

## 2. ブック配分

| スリーブ | ウェイト | 内容 |
|---|---:|---|
| **Mcap** | **75%** | 11 銘柄。PIT mcap 比例 → スリーブ内 `applySemiCap` 30% → ×0.75 |
| **短期国債 ETF** | **15% または 20%** | **SHY**（1–3y Treasury）を第一候補。**SGOV**（0–3m Treasury）を第二候補（データ取得可否で doc に明記） |
| **金** | **0% または 5%** | **GLD**（取得不能時 IAU、doc 明記） |

残りウェイトは mcap に按分しない — **mcap + tbill + gold = 100%**。Gold 5% のとき tbill **20%**（mcap **75%**）。Gold 0% のとき tbill **25%**（mcap **75%**）。T-bill **15%** + gold **5%** の組は mcap **80%**（合計 100%・doc に明記）。

---

## 3. Variant grid（結果探索前に固定）

| ID | Mega K | T-bill ETF | Mcap % | T-bill % | GLD % |
|---|---|---|---:|---:|---:|
| `tbill_K1_SHY20_G5` | 1 | SHY | 75 | 20 | 5 |
| `tbill_K1_SHY25_G0` | 1 | SHY | 75 | 25 | 0 |
| `tbill_K1_SHY15_G5` | 1 | SHY | 80 | 15 | 5 |
| `tbill_K2_SHY20_G5` | 2 | SHY | 75 | 20 | 5 |
| `tbill_K2_SHY25_G0` | 2 | SHY | 75 | 25 | 0 |
| `tbill_K2_SHY15_G5` | 2 | SHY | 80 | 15 | 5 |

**SGOV:** 代表 1 本 `tbill_K2_SGOV20_G5`（mcap 75 / SGOV 20 / GLD 5）。

**参考（採用判定外）**

- `ref_IEF20_G5`: mcap 75% + **IEF 20%** + GLD 5% + mega K=2（中期国債・Emma 非優先）

**Mcap ルール（divGold と同 spirit）**

- eligible は `filterEligibleCandidates`（テーマ・金融・黒字・2023-04 AMZN 等は既存パス）
- **GOOGL / MSFT / META** 上限 **K ∈ {1, 2}**
- **semiThin=off**

---

## 4. データ

- 株・mcap: PIT キャッシュ + 現行 `pit-mcap` / eligible
- **SHY / SGOV / IEF / GLD:** PIT に無ければ Yahoo adjclose（`fetchDailyBars` totalReturn）を **実行時 `.cache` のみ**（git 非コミット）
- 総リターン: adjclose 系（配当込み調整）

---

## 5. 指標

1. 元本割れ（月初 rolling、principal stress 同型）
2. 総リターン 2016 整列 ～ `SAKA_END`
3. AI ティルト % / 半導体 %（年次 holdings 定義、2026-10-01 スナップショット + 四半期平均）
4. SPY 同型 buy-hold
5. **参考:** divGold_K2_keep 数値は既存 RESULTS から引用（再計算は tbill 実行と同時でも可）

---

## 6. 採否（DIV_GOLD prereg §7 と同じ・緩和なし）

**Primary:** 材料割れ率低下 **または** 元本最深中央改善、**かつ** 総リターン ≥ baseline − 2.0%pt。

**Secondary:** Primary 複数 → TR 最大 → 2026 AI 低 → K=1 優先。

---

*事前登録のみ。数値は別コミット。*
