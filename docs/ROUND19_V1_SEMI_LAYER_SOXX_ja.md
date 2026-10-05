# Round 19 v1 半導体レイヤー分散 & SOXX 相関スクリーン

**状態:** 事前登録 **追補のみ**（本追補コミット時点では **新規バックテスト数値なし**）。  
**親 prereg:** [`ROUND19_V1_DIV_GOLD_SLEEVE_PREREG_ja.md`](ROUND19_V1_DIV_GOLD_SLEEVE_PREREG_ja.md)（75/20/5・採否 §7 は **変更しない**）。  
**既存結果（維持）:** [`ROUND19_V1_DIV_GOLD_SLEEVE_RESULTS_ja.md`](ROUND19_V1_DIV_GOLD_SLEEVE_RESULTS_ja.md) の divGold_K1/K2 は **削除・上書きしない**。  
**生成予定:** `scripts/round19-v1-semi-layer-soxx.ts`  
**サイト非掲載。**

---

## 事前登録追補（2026-10-05）

### 目的

- **A)** mcap スリーブ内の半導体を **レイヤー混在**（装置 / 材料 / チップ系）させ、**NVDA・AVGO・AMD・MU の四点集中**より **ペア相関の低い組合せ**を優先する。
- **B)** 中〜大型の流動 semi について **SOXX との 252 日相関**を計測し、mega 名より **SOXX 相関が薄い候補**をリスト化する（**MU が採用候補・ブックに含まれる場合は SNDK を候補から除外**）。

### 追加 variant（75/20/5 は親 prereg どおり）

| ID | Mcap 選定の追加ルール | Mega-tech K | 親の quad semiThin |
|---|---|---:|---|
| `divGold_K2_layerMix` | mcap 11: 親 prereg と同じ K=2。**半導体サブ業種**について **{NVDA, AVGO, AMD, MU} は最大 2 名**。**eligible な semi 装置**（GICS sub-industry に `equipment`、代表 LRCX/KLAC/AMAT）が **0 名なら**、mcap スリーブ内の **最小 mcap の semi 1 名を装置に置換**（mega-tech cap 維持）。スリーブ内 `applySemiCap` 30% は不変。 | 2 | **off** |
| `divGold_K2_soxxLow` | まず K=2 で mcap 11 を構築。**半導体枠（最大 3 名）**は eligible semi のうち **SOXX 252d 相関の絶対値が小さい順**に採用（mcap≥200億 USD）。**MU 採用時は SNDK 除外**。非 semi は mcap 降順で埋める。 | 2 | off |

高配当 20%・GLD 5%・除外ルール・シミュレーション定義は **親 prereg §2–4 のまま**。

### 採否

**§7 Primary/Secondary を緩めない。** 新 variant も baseline `plain_15__mcap` および記載の divGold_K1/K2 と **同じ指標表**で比較するのみ。

---

## （以下、スクリプト実行結果）

**生成:** `scripts/round19-v1-semi-layer-soxx.ts` · **HEAD** `5a7f176`
**親 prereg:** [`docs/ROUND19_V1_DIV_GOLD_SLEEVE_PREREG_ja.md`](ROUND19_V1_DIV_GOLD_SLEEVE_PREREG_ja.md) · **本追補:** [`docs/ROUND19_V1_SEMI_LAYER_SOXX_ja.md`](ROUND19_V1_SEMI_LAYER_SOXX_ja.md)
**金 ETF:** Yahoo adjclose (runtime) (`GLD`)
**SOXX:** Yahoo adjclose (runtime) (`SOXX`)

## サマリー（vs baseline `plain_15__mcap`）

**Primary を満たす追試 variant なし** — 元本中央は divGold 系どおり baseline より浅いが、総リターンが baseline −2%pt 以内を満たさない、または材料割れ改善なし。

## Primary 判定（親 prereg §7、緩和なし）

| 条件 | baseline | divGold_K2_keep | divGold_K2_layerMix | divGold_K2_soxxLow |
|---|---:|---:|---:|---:|
| 材料割れ率 | 81% | 77% | 78% | 78% |
| 元本最深中央 | -8.2% | -5.1% | -4.9% | -4.9% |
| 総リターン | +670.7% | +558.5% | +513.4% | +477.4% |

## 指標一覧

| ID | 総リターン | CAGR | MaxDD | 元本最深中央 | 元本最深10% | 材料割れ率 | AI平均 | AI 2026 | Semi平均 | Semi 2026 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plain_15__mcap | +670.7% | +21.0% | -36.1% | -8.2% | -22.1% | 81% | 73.6% | 86.1% | 8.9% | 30.0% |
| divGold_K2_keep | +558.5% | +19.2% | -26.4% | -5.1% | -18.1% | 77% | 56.7% | 65.7% | 7.0% | 22.5% |
| divGold_K2_layerMix | +513.4% | +18.4% | -26.7% | -4.9% | -17.6% | 78% | 55.2% | 64.8% | 4.7% | 22.5% |
| divGold_K2_soxxLow | +477.4% | +17.7% | -27.6% | -4.9% | -18.9% | 78% | 59.4% | 63.4% | 4.9% | 18.0% |

### 2026-10-01 mcap スリーブ（K=2）

| variant | 銘柄 |
|---|---|
| `divGold_K2_keep` | NVDA, AAPL, GOOGL, MSFT, AMZN, AVGO, TSLA, MU, LLY, AMD, WMT |
| `divGold_K2_layerMix` | NVDA, AAPL, GOOGL, MSFT, AMZN, AVGO, TSLA, LLY, WMT, MU, CSCO |
| `divGold_K2_soxxLow` | AAPL, GOOGL, MSFT, AMZN, TSLA, LLY, WMT, JNJ, QCOM, NVDA, TXN |

## SOXX 相関スクリーン（eligible semi、mcap 20–500B USD）

quad 四銘柄の |ρ(SOXX)| **最大値**より小さい |ρ| の候補に ★ を付与。**MU が mcap スリーブに含まれる場合は SNDK を候補から除外**（下表はスクリーン時点の eligible のみ）。

| ticker | layer | mcapB | ρSOXX | note |
|---|---|---:|---:|---|
| QCOM | semi | 191.2 | 0.57 | ★ |
| TXN | semi | 256.9 | 0.66 | ★ |
| NXPI | semi | 60.4 | 0.66 | ★ |
| ON | semi | 31.2 | 0.72 | ★ |
| MCHP | semi | 42.6 | 0.72 | ★ |
| ADI | semi | 196.1 | 0.75 | ★ |
| MRVL | semi | 235.1 | 0.76 | ★ |
| TER | equip | 65.0 | 0.80 | ★ |
| MPWR | semi | 66.9 | 0.83 | — |
| KLAC | equip | 261.7 | 0.85 | — |
| AMAT | equip | 420.1 | 0.87 | — |
| LRCX | equip | 425.6 | 0.89 | — |
| Q | equip | 26.9 | — | — |

quad |ρ(SOXX)| max = **0.82**（NVDA 0.59, AVGO 0.67, AMD 0.78, MU 0.82）。

## 半導体ペア相関 + SOXX 列

### 2026-10-01（252d log-return Pearson）

|  | NVDA | AVGO | AMD | MU | LRCX | KLAC | AMAT | SOXX |
| ---|---:|---:|---:|---:|---:|---:|---:|---: |
| NVDA | 1.00 | 0.53 | 0.47 | 0.46 | 0.50 | 0.50 | 0.46 | 0.59 |
| AVGO | 0.53 | 1.00 | 0.48 | 0.51 | 0.57 | 0.50 | 0.54 | 0.67 |
| AMD | 0.47 | 0.48 | 1.00 | 0.60 | 0.66 | 0.61 | 0.61 | 0.78 |
| MU | 0.46 | 0.51 | 0.60 | 1.00 | 0.78 | 0.67 | 0.73 | 0.82 |
| LRCX | 0.50 | 0.57 | 0.66 | 0.78 | 1.00 | 0.87 | 0.91 | 0.89 |
| KLAC | 0.50 | 0.50 | 0.61 | 0.67 | 0.87 | 1.00 | 0.87 | 0.85 |
| AMAT | 0.46 | 0.54 | 0.61 | 0.73 | 0.91 | 0.87 | 1.00 | 0.87 |

## 備考

- 252 日 log-return Pearson；観測不足は「—」。
- シミュレーション・元本ストレス定義は div-gold スクリプトと同一（75/20/5、四半期 PIT）。
- 既存 divGold_K1/K2 結果ファイルは **上書きしない**（本スクリプトは追試ドキュメントのみ更新）。
