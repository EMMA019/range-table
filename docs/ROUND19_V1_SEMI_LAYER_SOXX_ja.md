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

## （以下、スクリプト実行後に数値セクションが追記される）

*Placeholder — 次コミットで相関行列・候補リスト・再シミュレーション表を挿入。*
