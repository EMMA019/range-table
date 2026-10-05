# Round 19 v1 mcap + 短期国債 ETF + 金 — 結果

**Prereg:** [`docs/ROUND19_V1_TBILL_GOLD_PREREG_ja.md`](ROUND19_V1_TBILL_GOLD_PREREG_ja.md)
**生成:** `scripts/round19-v1-tbill-gold-sleeve.ts` · **HEAD** `70428a0`
**金 ETF:** Yahoo adjclose (runtime `.cache`) (`GLD`)

## データ取得（T-bill / 金）

| ETF | ソース |
|---|---|
| SHY | Yahoo adjclose (runtime `.cache`) |
| SGOV | Yahoo adjclose (runtime `.cache`) |
| IEF | Yahoo adjclose (runtime `.cache`) |
| 金 | Yahoo adjclose (runtime `.cache`) (`GLD`) |

## Prereg variant grid（読み取り）

| ID | K | T-bill | Mcap % | T-bill % | GLD % | 備考 |
|---|---:|---|---:|---:|---:|---|
| `tbill_K1_SHY20_G5` | 1 | SHY | 75 | 20 | 5 |  |
| `tbill_K1_SHY25_G0` | 1 | SHY | 75 | 25 | 0 |  |
| `tbill_K1_SHY15_G5` | 1 | SHY | 80 | 15 | 5 |  |
| `tbill_K2_SHY20_G5` | 2 | SHY | 75 | 20 | 5 |  |
| `tbill_K2_SHY25_G0` | 2 | SHY | 75 | 25 | 0 |  |
| `tbill_K2_SHY15_G5` | 2 | SHY | 80 | 15 | 5 |  |
| `tbill_K2_SGOV20_G5` | 2 | SGOV | 75 | 20 | 5 |  |
| `ref_IEF20_G5` | 2 | IEF | 75 | 20 | 5 | 参考のみ |

**未計算 variant:** なし

## サマリー（vs ベースライン `plain_15__mcap`）

**Prereg Primary を満たす tbill variant なし** — 下表参照（判定は prereg §6–7、divGold 参照行は採用対象外）。

**SHY vs SGOV:** 代表ペア `tbill_K2_SHY20_G5` と `tbill_K2_SGOV20_G5`（いずれも mcap 75 / T-bill 20 / GLD 5）。 総リターン +454.9% vs +465.1%、元本中央 -4.8% vs -5.3%、材料割れ 75% vs 75%。

**IEF 参考行:** `ref_IEF20_G5` は中期国債（Emma 非優先）の **採用判定外** 参考。Primary 勝者選定から除外。

**divGold 参照（再計算なし）:** `divGold_K2_keep` の数値は [`docs/ROUND19_V1_DIV_GOLD_SLEEVE_RESULTS_ja.md`](ROUND19_V1_DIV_GOLD_SLEEVE_RESULTS_ja.md) から引用（総リターン +558.5%、元本中央 −5.1%、材料割れ 77%、AI 2026 65.7%）。

## Primary 判定（prereg §6–7 · divGold prereg §7 同型）

| 条件 | baseline | 最良 tbill（Primary 内） | divGold_K2_keep（引用） |
|---|---:|---:|---:|
| 材料割れ率 | 81% | — | 77% |
| 元本最深中央 | -8.2% | — | -5.1% |
| 総リターン | +670.7% | — | +558.5% |

## 指標一覧

| ID | 総リターン | CAGR | MaxDD | 元本最深中央 | 元本最深10% | 材料割れ率 | AI平均 | AI 2026 | Semi平均 | Semi 2026 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain_15__mcap | +670.7% | +21.0% | -36.1% | -8.2% | -22.1% | 81% | 73.6% | 86.1% | 8.9% | 30.0% |
| tbill_K1_SHY20_G5 | +409.4% | +16.4% | -27.2% | -5.3% | -17.2% | 77% | 52.5% | 61.7% | 8.0% | 22.5% |
| tbill_K1_SHY25_G0 | +383.8% | +15.8% | -27.2% | -5.8% | -17.3% | 76% | 52.5% | 61.7% | 8.0% | 22.5% |
| tbill_K1_SHY15_G5 | +447.8% | +17.2% | -28.8% | -5.9% | -18.4% | 77% | 56.0% | 65.9% | 8.5% | 24.0% |
| tbill_K2_SHY20_G5 | +454.9% | +17.3% | -28.6% | -4.8% | -17.2% | 75% | 56.4% | 65.7% | 7.0% | 22.5% |
| tbill_K2_SHY25_G0 | +430.2% | +16.8% | -29.0% | -5.1% | -17.4% | 75% | 56.4% | 65.7% | 7.0% | 22.5% |
| tbill_K2_SHY15_G5 | +505.8% | +18.3% | -30.1% | -5.2% | -18.3% | 75% | 60.1% | 70.1% | 7.5% | 24.0% |
| tbill_K2_SGOV20_G5 | +465.1% | +17.5% | -28.2% | -5.3% | -16.9% | 75% | 56.4% | 65.7% | 7.0% | 22.5% |
| ref_IEF20_G5 | +450.7% | +17.2% | -29.6% | -4.9% | -16.9% | 75% | 56.4% | 65.7% | 7.0% | 22.5% |
| divGold_K2_keep（引用） | +558.5% | +19.2% | -26.4% | -5.1% | -18.1% | 77% | 56.7% | 65.7% | 7.0% | 22.5% |
| SPY | +355.3% | +15.2% | -33.7% | — | — | — | — | — | — | — |

## Mega-tech K=1 vs K=2（SHY grid）

| ウェイト | K1 TR | K2 TR | K1 元本中央 | K2 元本中央 | K1 材料割れ | K2 材料割れ | K1 AI 2026 | K2 AI 2026 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| SHY20_G5 | +409.4% | +454.9% | -5.3% | -4.8% | 77% | 75% | 61.7% | 65.7% |
| SHY25_G0 | +383.8% | +430.2% | -5.8% | -5.1% | 76% | 75% | 61.7% | 65.7% |
| SHY15_G5 | +447.8% | +505.8% | -5.9% | -5.2% | 77% | 75% | 65.9% | 70.1% |

## 備考

- Mcap スリーブ: PIT 比例 → `applySemiCap` 30% → prereg の Mcap % を乗算。**semiThin=off 固定。**
- 総リターンは PIT/Yahoo **adjclose 系**（配当込み調整）+ ETF は実行時 `.cache` のみ（git 非コミット）。
- 元本ストレスは prereg どおり月初開始・四半期 PIT ブック固定。
- ベースラインとの差分採否は Primary/Secondary（総リターン ≥ baseline − 2.0%pt 必須）。
