# Round 19 v2 事前登録 — Saka Index（セクター予算付き選定）

**登録日:** 2026-10-04（**本ファイルのコミット以降**にバックテスト・成果物を生成する）  
**前提:** Round 19 v1 監査（`docs/ROUND19_AUDIT_ja.md`）の Step 0（PIT 全銘柄 CIK・EDGAR カバレッジ）完了後に実行。  
**サイト非掲載。**

---

## Step 0（実装ゲート・結果前）

- `sp500.csv` クォート対応パース + SEC 全ティッカー CIK マップ（`sec_cik.json` watchlist 限定フォールバック **不使用**）。
- カバレッジレポート: 修正前後の四半期 **eligible** 件数。最終リバランスで eligible がテーマ・金融除外後の **45% 未満**なら **停止**（無料データでは続行不可と報告）。

---

## 固定パラメータ（v1 踏襲）

| 項目 | 値 |
|---|---|
| ユニバース | PIT S&P 500（`fja05680/sp500`）、**watchlist.yaml 不使用** |
| 除外 | 赤字（TTM）、金融、quantum/space（SPCX 除く）/crypto/solar/nuclear、ONDS |
| 期間 IS | 2016-01-01 ～ 2020-12-31 |
| 期間 OOS | 2021-01-01 ～ 2026-10-02 |
| 口座 | $3,200、四半期リバランス、小数株 |
| 手数料 | $0.35 ベース / $1.00 ストレス |
| 価格 | Yahoo adjclose（`totalReturn: true`） |
| 時価総額 | EDGAR PIT 株数 × 当日終値 |
| 相関 | 252 日、ペア ρ>0.6 は **フラグのみ**（強制除外なし）、採用構成で超過ペア数を報告 |

---

## 構成（18 セル）

**設計** × **ウェイト** × **N**

| 設計 ID | 内容 |
|---|---|
| `emma_quota` | セクター予算 **先決定**: semis+tech（IT ＋ 半導体サブ業）ウェイト **15–30%**；残りは GICS セクター別に eligible 時点 mcap 比例でスロット、**各セクター最大 25%** ウェイト。セクター内選定: (a) 既選との相関最小 (b) SPY 対 6–12M 相対モメンタム (c) mcap |
| `sector_neutral` | eligible のセクター mcap ウェイトに合わせる（semis+tech を 15–30% にクリップ）。セクター内: 相対モメンタムまたは mcap（実装で `strength` 優先） |
| `core_satellite` | **70%** mcap 比例＋単銘柄 cap10 のコア（eligible mcap 上位 N_core）＋ **30%** セクター内 strength サテライト |

| ウェイト | 規則 |
|---|---|
| `equal` | 等ウェイト |
| `mcap_cap10` | mcap 比例、単銘柄上限 10% |
| `invvol` | 60 日逆ボラ |

| N | 15 または 20 |

ID 例: `emma_quota_15__mcap_cap10`

---

## 採用規則（IS のみ・1 構成）

1. IS 最大 DD **< SPY**（同期間）  
2. 残りから **IS CAGR 最大**  
3. 同点 **ターンオーバー最小**

採用構成を固定して OOS を **1 回**評価。

---

## 合格（OOS・$0.35）

- CAGR ≥ **10%**
- 最大 DD **< SPY**
- 暦年プラス率 ≥ **70%**（2016–2026 YTD）

---

## 成果物

- `src/lib/round19v2-saka.ts`, `scripts/round19v2-saka-study.ts`
- `docs/ROUND19V2_STEP0_ja.md`（カバレッジ before/after）
- `docs/ROUND19V2_ja.md`（**事実** / **解釈**）
- `docs/round19v2_equity.png`（1 枚）
- キャッシュ `data/.cache/round19v2/`

---

*実行前コミット必須。*
