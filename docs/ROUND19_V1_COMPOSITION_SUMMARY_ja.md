# Round 19 v1 構成比較 — 合成サマリー（修正後・無料データ）

**対象:** post-fix ブランチ（採用 **`plain_15__mcap`**）· 全期間指標は既存 RESULTS / DETAIL の表から**引用のみ**（再計算なし）。  
**ライブ窓:** [`ROUND19_LIVE_WINDOW_2026-07-30_ja.md`](ROUND19_LIVE_WINDOW_2026-07-30_ja.md)（2026-07-30→10-02 · FX **163.30→157.93** · $0.35 差分）。  
**サイト非掲載 · main マージなし。**

## 比較表（1枚）

| ID | 総リターン / CAGR | 元本最深中央 | MaxDD | 材料割れ | AI 2026 | 手数料 | 2026-10-01 保有要約 | ライブ窓 USD/JPY/DD |
|---|---|---|---:|---:|---:|---|---|---|
| **plain_15__mcap**（採用） | +670.7% / +21.0% | −8.2% | −36.1% | 81% | 86.1% | 累計 **$85.05**（DETAIL §3 · $0.35/注文） | mcap **15**（mega 制限なし）— 例 NVDA, AAPL, GOOGL, MSFT, AMZN, META… → [`WEIGHTS_2026-10-01`](ROUND19_V1_WEIGHTS_2026-10-01.md) | **+9.68%** / **+6.07%** / **−3.08%** / **−4.36%** |
| **divGold_K1**（keep=thin） | +493.3% / +18.0% | −5.6% | −26.2% | 78% | 61.7% | 戦略 CAGR に $0.35 込み | mcap11 **GOOGL** + div4 + GLD5 → [`HOLDINGS_2026-10-01`](ROUND19_V1_DIV_GOLD_HOLDINGS_2026-10-01_ja.md) | +6.14% / +2.65% / −2.30% / −4.29% |
| **divGold_K2**（keep=thin） | +558.5% / +19.2% | −5.1% | −26.4% | 77% | 65.7% | 同上 | mcap11 **GOOGL+MSFT** + div4 + GLD5 → 同上 | +6.88% / +3.36% / −1.69% / −4.29% |
| **tbill_K2_SHY20_G5** | +454.9% / +17.3% | −4.8% | −28.6% | 75% | 65.7% | 同上 | mcap **75%**（K2 mega）+ **SHY 20%** + **GLD 5%**（mcap11 は divGold K2 と同型）→ [`TBILL RESULTS`](ROUND19_V1_TBILL_GOLD_RESULTS_ja.md) | +6.37% / +2.87% / −2.29% / −4.63% |
| **SPY** B&H | +355.3% / +15.2% | — | −33.7% | — | — | 手数料なし | 100% SPY | +4.03% / +0.60% / −3.06% / −5.60% |

**全期間の期間・定義:** 2016 起点〜最新（`div-gold` / `tbill` / DETAIL と同型シミュ · 差分 $0.35）。**元本割れ**＝月初 rolling・四半期 PIT ブック固定の**最深元本割れ中央値**（[`PRINCIPAL_STRESS`](ROUND19_V1_PRINCIPAL_STRESS_ja.md) / RESULTS 同型）。**AI 2026**＝年次表 2026-10-01 スナップショット（plain は [`ANNUAL_HOLDINGS`](ROUND19_V1_ANNUAL_HOLDINGS_ja.md) **86.1%**；スリーブ系は DIV/TBILL RESULTS 列 **AI 2026**）。

## 判定・読み取り（短く）

- **Primary（divGold / tbill prereg §7）:** 材料割れ↓または元本中央↑**かつ** 総リターン ≥ `plain_15__mcap` **−2.0%pt** → **divGold 全 variant・tbill 全 variant とも不成立**（元本は浅いが TR 不足）。出典: [`DIV_GOLD RESULTS`](ROUND19_V1_DIV_GOLD_SLEEVE_RESULTS_ja.md)、[`TBILL RESULTS`](ROUND19_V1_TBILL_GOLD_RESULTS_ja.md)。
- **採用:** 修正後も **`plain_15__mcap`**（DETAIL 確定版 · PR #49）。
- **ライブ窓:** 採用は detail §7 と同程度の USD/TR；防御スリーブ（divGold / tbill）は USD/JPY リターン・USD MaxDD で plain より穏やか、**全期間 TR は plain 上**。
- **SPY:** 全期間・窓とも TR/CAGR は plain 下；窓 JPY **+0.60%** は DETAIL §7 と整合。

## 引用元

| 内容 | ドキュメント |
|---|---|
| 採用・MaxDD・手数料累計 | [`ROUND19_V1_DETAIL_ja.md`](ROUND19_V1_DETAIL_ja.md) |
| divGold 指標 | [`ROUND19_V1_DIV_GOLD_SLEEVE_RESULTS_ja.md`](ROUND19_V1_DIV_GOLD_SLEEVE_RESULTS_ja.md) |
| tbill 指標 | [`ROUND19_V1_TBILL_GOLD_RESULTS_ja.md`](ROUND19_V1_TBILL_GOLD_RESULTS_ja.md) |
| divGold 2026-10-01 ウェイト | [`ROUND19_V1_DIV_GOLD_HOLDINGS_2026-10-01_ja.md`](ROUND19_V1_DIV_GOLD_HOLDINGS_2026-10-01_ja.md) |
| plain AI / 年次 | [`ROUND19_V1_ANNUAL_HOLDINGS_ja.md`](ROUND19_V1_ANNUAL_HOLDINGS_ja.md) |
| ライブ窓 | [`ROUND19_LIVE_WINDOW_2026-07-30_ja.md`](ROUND19_LIVE_WINDOW_2026-07-30_ja.md) |

**HEAD（合成 doc）:** `0819b18`（数値は上記固定引用 · 再計算なし）。
