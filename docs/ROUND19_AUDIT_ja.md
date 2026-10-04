# Round 19 ユニバース監査（事実のみ）

生成: `npx tsx scripts/round19-universe-audit.ts`（既存 `data/.cache/round19` を読む。フルスタディは再実行していない）

**注意（EDGAR）:** ローカル `facts/*.json` は **134** 件のみ。`profitable()` は facts 無しを **赤字扱い**（`round19-saka-study.ts` ctx）。よって eligible は「PIT∩除外∩価格∩**facts 取得成功銘柄**∩TTM 黒字」に実質限定される（ウォッチリスト由来ではない）。

## (1) PIT ユニバース

| 項目 | 値 |
|---|---|
| 期間 | 2016-01-01 ～ 2026-10-02 |
| **ユニーク銘柄数**（期間内に 1 日でも S&P 構成だったティッカー） | **745** |
| 使用ファイル | `https://raw.githubusercontent.com/fja05680/sp500/master/sp500_ticker_start_end.csv`（ローカル: `data/.cache/round19/sp500_ticker_start_end.csv`） |
| ローカル SHA-256（先頭 12 桁） | `b2f4fe2f2e4d` |
| ローカル更新日 | 2026-10-04 |
| 備考 | upstream コミットは未ピン留め。初回取得は `loadSp500PitFiles` が raw URL からダウンロード |

## (2) 四半期リバランス日ごとの候補漏斗

列: PIT 構成数 → 除外（テーマ・金融）→ 除外（TTM 赤字 / EDGAR 欠損）→ 除外（当日価格なし）→ 除外（相関用 126 日リターン不足）→ 除外（eligible だが mcap≤0）→ **eligible**（`filterEligibleCandidates`）→ corrdiverse 用プール（`buildCorrInputs` 銘柄数）

代表行（全 44 回中: 初回・4 回に 1 回・最終）:

| 日付 | PIT | −テーマ/金融 | −赤字/EDGAR | −価格 | −lookback | −mcap | eligible | corr pool |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 2016-01-04 | 504 | 49 | 387 | 0 | 1 | 0 | 68 | 67 |
| 2017-01-03 | 506 | 52 | 384 | 0 | 0 | 0 | 70 | 70 |
| 2018-01-02 | 505 | 53 | 380 | 0 | 0 | 0 | 72 | 72 |
| 2019-01-02 | 506 | 55 | 370 | 0 | 0 | 0 | 81 | 81 |
| 2020-01-02 | 505 | 58 | 360 | 0 | 0 | 0 | 87 | 87 |
| 2021-01-04 | 505 | 58 | 368 | 0 | 0 | 0 | 79 | 79 |
| 2022-01-03 | 505 | 62 | 355 | 0 | 0 | 0 | 88 | 88 |
| 2023-01-03 | 503 | 66 | 342 | 0 | 0 | 1 | 95 | 95 |
| 2024-01-02 | 503 | 66 | 341 | 0 | 0 | 2 | 96 | 96 |
| 2025-01-02 | 503 | 70 | 328 | 0 | 1 | 2 | 105 | 104 |
| 2026-01-02 | 503 | 74 | 324 | 0 | 0 | 2 | 105 | 105 |
| 2026-10-01 | 503 | 76 | 314 | 0 | 0 | 2 | 113 | 113 |

### 最終リバランス **2026-10-01**（詳細）

| 段階 | 銘柄数 |
|---|---:|
| PIT 構成 | 503 |
| テーマ・金融除外後 | 427 |
| 黒字（TTM）後 | 113 |
| 当日価格あり後 | 113 |
| 126 日+ lookback 後 | 113 |
| **eligible** | **113** |
| eligible かつ mcap>0（plain 用） | 111 |
| corrdiverse プール | 113 |

**PIT 全員の mcap 算出可能数（価格×株数、eligible 外含む）:** 132 — ROUND19_ja の「132 件」と一致する指標（内訳: 価格なし 0、facts なし 369、株数なし 2）。

**最終日: 黒字だが価格なしで落ちた銘柄（0）:** （なし）

## (3) ウォッチリスト汚染のコード追跡

### `scripts/round19-saka-study.ts` および Round 19 専用 import

| ファイル | watchlist 参照 |
|---|---|
| `scripts/round19-saka-study.ts` | **直接なし**（`loadWatchlist` / `watchlist.yaml` 未 import） |
| `scripts/round19-saka-study.ts:10,85` | `cikForTicker` を import — `loadFacts` で GICS CIK が無いときのフォールバック |
| `src/lib/round19-saka.ts` | **なし** — `./themes`（固定配列）、`./corr`、`./types` のみ |
| `src/lib/sp500-pit.ts:33-44` | **なし**（ただし GICS CSV の単純 `split(",")` で **CIK 列が壊れて常に null**） |
| `src/lib/edgar-companyfacts.ts:30-43` | `data/sec_cik.json` を読む — ファイル注記どおり **watchlist 銘柄のみ**（`scripts/build-sec-cik.ts`） |
| `data/watchlist.yaml` | スタディ本体は未読。監査 (4) と `sec_cik.json` 経由で間接的に関連 |

### 価格キャッシュ

- パス: `data/.cache/round19/{SYMBOL}.json`（`scripts/round19-saka-study.ts:45,66-76`）
- 取得対象: `uniqueTickersInRange(intervals, SAKA_START, SAKA_END)`（`round19-saka-study.ts:136`）— **PIT 期間の全ユニーク銘柄**（本監査: 784 銘柄リクエスト、615 銘柄に非空バー）
- キャッシュ JSON ファイル数: **618**（ウォッチリスト専用ディレクトリではない）
- `scripts/cache-bars.ts` / `data/.cache/bt/` は **本スタディ未使用**

### テーマ除外と watchlist

`isExcludedTheme`（`round19-saka.ts`）は `themeOf`（`themes.ts` の **固定配列** QUANTUM/SPACE/CRYPTO 等）を使用。`themes.ts` は watchlist を読まない（コメントに watchlist 由来の **銘柄名** の記述のみ）。

### サイレント欠損の有無

- `loadBars` 失敗時は **空配列**（`round19-saka-study.ts:77-78`）→ `barsBy` に未登録 → `hasPrice` が false → **eligible から除外**（ウォッチリストとは無関係）。
- 最終リバランスで PIT 構成 503 のうち **バー未ロード 0**（空 JSON が 0 — 取得失敗の痕跡）。
- **ウォッチリスト外だから価格が無い**という経路はコード上 **存在しない**。逆に、キャッシュは PIT ユニーク銘柄向けに広く取られている。

### 132 mcap の理由

最終日 PIT **503** 名のうち **132** 名のみ「終値×EDGAR 株数」が正（= レポートの 132）。残り **371** は構成員だが (1) Yahoo 価格なし 0、(2) companyfacts 未取得 369、(3) 株数タグ欠損 2。eligible（113）は黒字・価格ありに更に限定。

**結論（watchlist）:** `watchlist.yaml` / `loadWatchlist` を Round 19 実行経路が参照する **証拠はない**。

**結論（サイレント欠損）:** ウォッチリストではなく **EDGAR companyfacts の未取得が `profitable() === false` になり、eligible が ~70–113 程度に圧縮**される（最終日: テーマ・金融後 427 → 黒字後 113。facts 未取得 369 名は mcap でも落ちる）。フル再実行時の **修正案:** facts 未取得を黒字判定から分離して件数をレポートする、または全 PIT 銘柄の facts 取得完了をゲートにする（本監査ではスタディ未再実行）。

ピックが watchlist 名に似るのは、eligible が **大型・よくカバーされる銘柄**に偏り、かつ watchlist 186 と S&P の交集合が大きいため（下表）。

## (4) 採用・参考ホールディングと watchlist（186）

ウォッチリスト銘柄数（`data/watchlist.yaml`）: **187**

| グループ | 銘柄 | watchlist 内 |
|---|---|---|
| 採用 15 | MO, VRSK, CVX, TMUS, T, TYL, PM, FANG, NOW, VLO, DGX, WMT, NFLX, AMT, ADSK | **15/15** — MO, VRSK, CVX, TMUS, T, TYL, PM, FANG, NOW, VLO, DGX, WMT, NFLX, AMT, ADSK |
| 参考 20 の追加分 | CPRT, TJX, WELL, CHTR, EIX | **5/5** — CPRT, TJX, WELL, CHTR, EIX |

eligible ユニバースに占める watchlist 比率（各リバランス）:

| 日付 | eligible | watchlist 交集合 | 比率 |
|---|---:|---:|---:|
| 2016-01-04 | 68 | 68 | 100.0% |
| 2016-04-01 | 68 | 68 | 100.0% |
| 2016-07-01 | 68 | 68 | 100.0% |
| 2016-10-03 | 70 | 70 | 100.0% |
| 2017-01-03 | 70 | 70 | 100.0% |
| 2017-04-03 | 68 | 68 | 100.0% |
| 2017-07-03 | 71 | 71 | 100.0% |
| 2017-10-02 | 72 | 72 | 100.0% |
| 2018-01-02 | 72 | 72 | 100.0% |
| 2018-04-02 | 75 | 75 | 100.0% |
| 2018-07-02 | 77 | 77 | 100.0% |
| 2018-10-01 | 79 | 79 | 100.0% |
| 2019-01-02 | 81 | 81 | 100.0% |
| 2019-04-01 | 82 | 82 | 100.0% |
| 2019-07-01 | 84 | 84 | 100.0% |
| 2019-10-01 | 85 | 85 | 100.0% |
| 2020-01-02 | 87 | 87 | 100.0% |
| 2020-04-01 | 86 | 86 | 100.0% |
| 2020-07-01 | 81 | 81 | 100.0% |
| 2020-10-01 | 80 | 80 | 100.0% |
| 2021-01-04 | 79 | 79 | 100.0% |
| 2021-04-01 | 78 | 78 | 100.0% |
| 2021-07-01 | 81 | 81 | 100.0% |
| 2021-10-01 | 88 | 88 | 100.0% |
| 2022-01-03 | 88 | 88 | 100.0% |
| 2022-04-01 | 90 | 90 | 100.0% |
| 2022-07-01 | 94 | 94 | 100.0% |
| 2022-10-03 | 95 | 95 | 100.0% |
| 2023-01-03 | 95 | 95 | 100.0% |
| 2023-04-03 | 94 | 94 | 100.0% |
| 2023-07-03 | 96 | 96 | 100.0% |
| 2023-10-02 | 95 | 95 | 100.0% |
| 2024-01-02 | 96 | 96 | 100.0% |
| 2024-04-01 | 97 | 97 | 100.0% |
| 2024-07-01 | 100 | 100 | 100.0% |
| 2024-10-01 | 103 | 103 | 100.0% |
| 2025-01-02 | 105 | 105 | 100.0% |
| 2025-04-01 | 106 | 106 | 100.0% |
| 2025-07-01 | 105 | 105 | 100.0% |
| 2025-10-01 | 106 | 106 | 100.0% |
| 2026-01-02 | 105 | 105 | 100.0% |
| 2026-04-01 | 110 | 110 | 100.0% |
| 2026-07-01 | 111 | 111 | 100.0% |
| 2026-10-01 | 113 | 113 | 100.0% |



## (5) ターンオーバー実態（採用構成 vs 比較）

*半導体* = GICS Sub-Industry に `semiconductor` を含む（`isSemiSubIndustry`、`round19-saka.ts`）。2023–2024 の列は四半期ごとに明示。

**リバランスは実行されている:** `simulateSaka` が `rebalanceDates` の各日で `filterEligibleCandidates` → `pickHoldings` → 全売買（`round19-saka.ts:517,541-552`）。本表はスタディと同じ `pickHoldings` / `targetWeights` をキャッシュ上で再計算（`scripts/round19-turnover-audit.ts`）。

**ホールディングが四半期で一切変わらないか:** いいえ（corrdiverse **0** / 43 四半期、plain **2** / 43）。相関 lookback が固定でも eligible プールと greedy 選定で入替が発生。

### corrdiverse_15__equal（IS 採用）

四半期ごとにホールディングが完全同一だった回数（前四半期比 added=removed=0）: **0** / 43

| リバランス日 | ホールディング（ティッカー） | 入替 +/− | GICS セクターウェイト（構成ウェイト） | 半導体* |
|---|---|---|---|---|
| 2016-01-04 | NEM,PWR,CMG,QCOM,WELL,NFLX,EIX,MU,DRI,NTAP,STX,VRSK,MOS,ISRG,KLAC | +15/−0 | Information Technology:33%; Materials:13%; Industrials:13%; Consumer Discretionary:13%; Real Estate:7%; Communication Services:7%; Utilities:7%; Health Care:7% | QCOM,MU,KLAC |
| 2016-04-01 | NEM,CMG,PWR,EIX,NFLX,WMT,MOS,WELL,DRI,ISRG,AMZN,MU,KLAC,AKAM,QCOM | +3/−3 | Information Technology:27%; Consumer Discretionary:20%; Materials:13%; Industrials:7%; Utilities:7%; Communication Services:7%; Consumer Staples:7%; Real Estate:7%; Health Care:7% | MU,KLAC,QCOM |
| 2016-07-01 | NEM,CMG,EIX,PWR,WMT,WELL,NFLX,DRI,MOS,STX,MO,KLAC,AMZN,EW,ISRG | +3/−3 | Consumer Discretionary:20%; Materials:13%; Consumer Staples:13%; Information Technology:13%; Health Care:13%; Utilities:7%; Industrials:7%; Real Estate:7%; Communication Services:7% | KLAC |
| 2016-10-03 | NEM,CMG,DHR,EIX,WMT,PWR,NRG,DRI,MOS,WELL,KLAC,NFLX,MO,STX,AMZN | +2/−2 | Consumer Discretionary:20%; Materials:13%; Utilities:13%; Consumer Staples:13%; Information Technology:13%; Health Care:7%; Industrials:7%; Real Estate:7%; Communication Services:7% | KLAC |
| 2017-01-03 | NEM,CMG,DHR,EIX,WMT,MO,MOS,NFLX,DRI,WELL,EW,T,NVDA,CHTR,AMZN | +4/−4 | Consumer Discretionary:20%; Communication Services:20%; Materials:13%; Health Care:13%; Consumer Staples:13%; Utilities:7%; Real Estate:7%; Information Technology:7% | NVDA |
| 2017-04-03 | DHR,CMG,EIX,WELL,DRI,CHTR,WMT,MO,NVDA,EW,MOS,NFLX,VZ,NKE,UNH | +3/−3 | Health Care:20%; Consumer Discretionary:20%; Communication Services:20%; Consumer Staples:13%; Utilities:7%; Real Estate:7%; Information Technology:7%; Materials:7% | NVDA |
| 2017-07-03 | DHR,CMG,NEM,AKAM,DRI,WMT,ADM,MOS,OXY,EW,NKE,MRK,AMGN,WELL,NVDA | +6/−6 | Health Care:27%; Consumer Discretionary:20%; Materials:13%; Information Technology:13%; Consumer Staples:13%; Energy:7%; Real Estate:7% | NVDA |
| 2017-10-02 | NEM,CMG,DRI,ADM,WMT,OXY,AKAM,MOS,NKE,WELL,VZ,MRK,CVX,ETR,AMT | +4/−4 | Consumer Discretionary:20%; Materials:13%; Consumer Staples:13%; Energy:13%; Real Estate:13%; Information Technology:7%; Communication Services:7%; Health Care:7%; Utilities:7% | — |
| 2018-01-02 | NEM,DRI,ETR,AMT,EIX,TJX,NKE,CHTR,WMT,CVX,WELL,VZ,CMG,OXY,T | +4/−4 | Consumer Discretionary:27%; Communication Services:20%; Utilities:13%; Real Estate:13%; Energy:13%; Materials:7%; Consumer Staples:7% | — |
| 2018-04-02 | EIX,NEM,ETR,CMG,WELL,TJX,CHTR,AMT,GE,EQIX,PM,MRK,DVN,DRI,BKNG | +6/−6 | Consumer Discretionary:27%; Real Estate:20%; Utilities:13%; Materials:7%; Communication Services:7%; Industrials:7%; Consumer Staples:7%; Health Care:7%; Energy:7% | — |
| 2018-07-02 | EIX,ETR,WELL,NEM,CHTR,DRI,CMG,GE,PM,EQIX,AMT,TJX,T,WMT,SBUX | +3/−3 | Consumer Discretionary:27%; Real Estate:20%; Utilities:13%; Communication Services:13%; Consumer Staples:13%; Materials:7%; Industrials:7% | — |
| 2018-10-01 | EIX,ETR,CMG,WELL,PM,DRI,CHTR,T,EQIX,TJX,MO,AMT,NEM,WMT,MRK | +2/−2 | Consumer Discretionary:20%; Real Estate:20%; Consumer Staples:20%; Utilities:13%; Communication Services:13%; Materials:7%; Health Care:7% | — |
| 2019-01-02 | NEM,ETR,EIX,PM,WELL,MO,CMG,VZ,AMT,EQIX,DRI,T,WMT,F,KHC | +3/−3 | Consumer Staples:27%; Real Estate:20%; Consumer Discretionary:20%; Utilities:13%; Communication Services:13%; Materials:7% | — |
| 2019-04-01 | NEM,ETR,EIX,KHC,VZ,WELL,PM,MO,CMG,AMT,DRI,EQIX,T,WMT,NRG | +1/−1 | Consumer Staples:27%; Utilities:20%; Real Estate:20%; Communication Services:13%; Consumer Discretionary:13%; Materials:7% | — |
| 2019-07-01 | NEM,ETR,VZ,KHC,WELL,EIX,MO,PM,AMT,CMG,QCOM,DGX,EQIX,F,DRI | +3/−3 | Consumer Staples:20%; Real Estate:20%; Consumer Discretionary:20%; Utilities:13%; Materials:7%; Communication Services:7%; Information Technology:7%; Health Care:7% | QCOM |
| 2019-10-01 | NEM,ETR,KHC,WELL,EIX,VZ,PM,MO,IFF,EQIX,CMG,QCOM,CI,DGX,NRG | +3/−3 | Utilities:20%; Consumer Staples:20%; Materials:13%; Real Estate:13%; Health Care:13%; Communication Services:7%; Consumer Discretionary:7%; Information Technology:7% | QCOM |
| 2020-01-02 | NEM,WELL,AMT,KHC,ETR,EIX,VZ,IFF,EQIX,CMG,PM,UNH,MO,WMT,DRI | +4/−4 | Consumer Staples:27%; Real Estate:20%; Materials:13%; Utilities:13%; Consumer Discretionary:13%; Communication Services:7%; Health Care:7% | — |
| 2020-04-01 | NEM,FANG,NFLX,AKAM,WMT,TTWO,ANET,CMG,IFF,NTAP,RCL,VZ,KHC,MO,MRK | +8/−8 | Communication Services:20%; Information Technology:20%; Consumer Staples:20%; Materials:13%; Consumer Discretionary:13%; Energy:7%; Health Care:7% | — |
| 2020-07-01 | NEM,NFLX,TTWO,AKAM,WMT,CMG,EOG,ANET,IFF,FTNT,NTAP,AMZN,KHC,TYL,MO | +4/−4 | Information Technology:33%; Consumer Staples:20%; Materials:13%; Communication Services:13%; Consumer Discretionary:13%; Energy:7% | — |
| 2020-10-01 | NEM,NFLX,AKAM,TTWO,WMT,AMZN,CMG,EOG,ANET,TYL,FTNT,DGX,AMD,MO,F | +3/−3 | Information Technology:33%; Consumer Discretionary:20%; Communication Services:13%; Consumer Staples:13%; Materials:7%; Energy:7%; Health Care:7% | AMD |
| 2021-01-04 | NEM,NFLX,TTWO,AKAM,WMT,AMZN,EOG,CMG,TYL,DGX,FTNT,AMD,WELL,GE,MO | +2/−2 | Information Technology:27%; Communication Services:13%; Consumer Staples:13%; Consumer Discretionary:13%; Materials:7%; Energy:7%; Health Care:7%; Real Estate:7%; Industrials:7% | AMD |
| 2021-04-01 | NEM,NFLX,TTWO,WMT,AKAM,GE,DGX,TSLA,CHTR,STX,MO,AMGN,TYL,EQIX,FTNT | +5/−5 | Information Technology:27%; Communication Services:20%; Consumer Staples:13%; Health Care:13%; Materials:7%; Industrials:7%; Consumer Discretionary:7%; Real Estate:7% | — |
| 2021-07-01 | DGX,T,GE,VZ,STX,F,MMM,EOG,MOS,EIX,CI,ORCL,DIS,NFLX,MRK | +11/−11 | Communication Services:27%; Health Care:20%; Industrials:13%; Information Technology:13%; Consumer Discretionary:7%; Energy:7%; Materials:7%; Utilities:7% | — |
| 2021-10-01 | DGX,EQIX,T,MRK,VZ,TTWO,NFLX,MMM,ETR,CHTR,NEM,AKAM,ORCL,KHC,CI | +7/−7 | Communication Services:33%; Health Care:20%; Information Technology:13%; Real Estate:7%; Industrials:7%; Utilities:7%; Materials:7%; Consumer Staples:7% | — |
| 2022-01-03 | DGX,MRK,EQIX,VZ,NEM,KHC,T,ORCL,EIX,ETR,TTWO,NRG,CHTR,MMM,AKAM | +2/−2 | Communication Services:27%; Utilities:20%; Health Care:13%; Information Technology:13%; Real Estate:7%; Materials:7%; Consumer Staples:7%; Industrials:7% | — |
| 2022-04-01 | NEM,MRK,KHC,DGX,VZ,CVX,MO,ETR,TTWO,WMT,PM,EIX,ADM,EQIX,AMGN | +6/−6 | Consumer Staples:33%; Health Care:20%; Communication Services:13%; Utilities:13%; Materials:7%; Energy:7%; Real Estate:7% | — |
| 2022-07-01 | NEM,MRK,WMT,MO,PM,KHC,VZ,ETR,AMGN,DGX,T,CHTR,TTWO,OXY,VLO | +4/−4 | Consumer Staples:27%; Communication Services:27%; Health Care:20%; Energy:13%; Materials:7%; Utilities:7% | — |
| 2022-10-03 | NEM,MRK,KHC,MO,WMT,PM,VZ,OXY,VLO,MOS,T,AMGN,ETR,DGX,CHTR | +1/−1 | Consumer Staples:27%; Health Care:20%; Communication Services:20%; Materials:13%; Energy:13%; Utilities:7% | — |
| 2023-01-03 | KHC,NEM,MRK,MO,WMT,AMGN,VZ,OXY,VLO,PM,MOS,T,ADM,ETR,CI | +2/−2 | Consumer Staples:33%; Health Care:20%; Materials:13%; Communication Services:13%; Energy:13%; Utilities:7% | **なし** |
| 2023-04-03 | MRK,KHC,AMGN,MO,NEM,VZ,WMT,CI,VLO,T,PM,MOS,NFLX,OXY,ADM | +1/−1 | Consumer Staples:33%; Health Care:20%; Communication Services:20%; Materials:13%; Energy:13% | **なし** |
| 2023-07-03 | MRK,KHC,CI,AMGN,NEM,UNH,VZ,T,EW,TMUS,VLO,MO,TSLA,OXY,WMT | +4/−4 | Health Care:33%; Consumer Staples:20%; Communication Services:20%; Energy:13%; Materials:7%; Consumer Discretionary:7% | **なし** |
| 2023-10-02 | MRK,KHC,UNH,AMGN,CI,VZ,TMUS,T,EW,MO,NEM,RTX,DGX,VLO,TSLA | +2/−2 | Health Care:40%; Communication Services:20%; Consumer Staples:13%; Materials:7%; Industrials:7%; Energy:7%; Consumer Discretionary:7% | **なし** |
| 2024-01-02 | UNH,MRK,T,TMUS,CI,KHC,NEM,DGX,WMT,AMGN,RTX,MO,FTNT,CMG,VLO | +3/−3 | Health Care:33%; Consumer Staples:20%; Communication Services:13%; Materials:7%; Industrials:7%; Information Technology:7%; Consumer Discretionary:7%; Energy:7% | **なし** |
| 2024-04-01 | UNH,KHC,MRK,T,TMUS,DGX,RTX,WMT,CMG,VRSK,CI,ADM,AMGN,NEM,MDT | +3/−3 | Health Care:40%; Consumer Staples:20%; Communication Services:13%; Industrials:13%; Consumer Discretionary:7%; Materials:7% | **なし** |
| 2024-07-01 | UNH,T,KHC,CI,RTX,WMT,MRK,ADM,DGX,NKE,VRSK,FTNT,VST,MPC,DIS | +5/−5 | Health Care:27%; Consumer Staples:20%; Communication Services:13%; Industrials:13%; Consumer Discretionary:7%; Information Technology:7%; Utilities:7%; Energy:7% | **なし** |
| 2024-10-01 | UNH,T,MRK,VRSK,KHC,WMT,FTNT,CI,RTX,AMT,MO,DGX,ADM,TMUS,PM | +4/−4 | Consumer Staples:33%; Health Care:27%; Communication Services:13%; Industrials:13%; Information Technology:7%; Real Estate:7% | **なし** |
| 2025-01-02 | T,AMT,PM,UNH,ETR,CI,MRK,MO,VRSK,KHC,ADM,TMUS,FTNT,WMT,RTX | +1/−1 | Consumer Staples:33%; Health Care:20%; Communication Services:13%; Industrials:13%; Real Estate:7%; Utilities:7%; Information Technology:7% | — |
| 2025-04-01 | MRK,MO,AMT,VZ,PM,CI,KHC,ADM,VRSK,EIX,UNH,ETR,TMUS,MDT,DGX | +4/−4 | Health Care:33%; Consumer Staples:27%; Communication Services:13%; Utilities:13%; Real Estate:7%; Industrials:7% | — |
| 2025-07-01 | AMT,MO,UNH,CI,PM,VZ,MRK,EW,TMUS,VRSK,DGX,ETR,NEM,WELL,EIX | +3/−3 | Health Care:33%; Real Estate:13%; Consumer Staples:13%; Communication Services:13%; Utilities:13%; Industrials:7%; Materials:7% | — |
| 2025-10-01 | MO,AMT,UNH,PM,CI,VZ,TMUS,DGX,NEM,MRK,ADM,VRSK,WELL,ETR,AMGN | +2/−2 | Health Care:33%; Consumer Staples:20%; Real Estate:13%; Communication Services:13%; Materials:7%; Industrials:7%; Utilities:7% | — |
| 2026-01-02 | MO,AMT,PM,UNH,CI,T,TMUS,VRSK,DGX,MRK,ADM,NEM,WELL,AMGN,EIX | +2/−2 | Health Care:33%; Consumer Staples:20%; Real Estate:13%; Communication Services:13%; Industrials:7%; Materials:7%; Utilities:7% | — |
| 2026-04-01 | MO,AMT,T,PM,UNH,TMUS,VRSK,CI,DGX,TYL,NEM,WELL,NFLX,CHTR,TJX | +4/−4 | Communication Services:27%; Health Care:20%; Consumer Staples:13%; Real Estate:13%; Industrials:7%; Information Technology:7%; Materials:7%; Consumer Discretionary:7% | — |
| 2026-07-01 | TMUS,VRSK,MO,T,CVX,TYL,PM,WMT,DGX,NOW,OXY,NFLX,AMT,VLO,WELL | +5/−5 | Communication Services:20%; Consumer Staples:20%; Energy:20%; Information Technology:13%; Real Estate:13%; Industrials:7%; Health Care:7% | — |
| 2026-10-01 | MO,VRSK,CVX,TMUS,T,TYL,PM,FANG,NOW,VLO,DGX,WMT,NFLX,AMT,ADSK | +2/−2 | Consumer Staples:20%; Energy:20%; Communication Services:20%; Information Technology:20%; Industrials:7%; Health Care:7%; Real Estate:7% | — |

### plain_20__mcap（OOS 年率上位の比較）

四半期ごとにホールディングが完全同一だった回数（前四半期比 added=removed=0）: **2** / 43

| リバランス日 | ホールディング（ティッカー） | 入替 +/− | GICS セクターウェイト（構成ウェイト） | 半導体* |
|---|---|---|---|---|
| 2016-01-04 | MSFT,CVX,AAPL,MRK,ORCL,BA,INTC,VZ,PM,CSCO,UNH,AMGN,MDT,T,TXN,SBUX,COP,HON,QCOM,MO | +20/−0 | Information Technology:45%; Health Care:18%; Energy:9%; Communication Services:9%; Industrials:9%; Consumer Staples:7%; Consumer Discretionary:3% | INTC,TXN,QCOM |
| 2016-04-01 | MSFT,ORCL,AAPL,MRK,PM,VZ,INTC,BA,CVX,CSCO,UNH,T,MO,AMGN,MDT,TXN,SBUX,HON,MMM,WMT | +2/−2 | Information Technology:42%; Health Care:18%; Consumer Staples:12%; Industrials:11%; Communication Services:10%; Energy:5%; Consumer Discretionary:3% | INTC,TXN |
| 2016-07-01 | MSFT,ORCL,MRK,VZ,PM,CVX,INTC,BA,AAPL,UNH,CSCO,T,MO,MDT,AMGN,TXN,HON,SBUX,KHC,MMM | +1/−1 | Information Technology:40%; Health Care:19%; Consumer Staples:13%; Industrials:11%; Communication Services:10%; Energy:5%; Consumer Discretionary:3% | INTC,TXN |
| 2016-10-03 | MSFT,MRK,INTC,ORCL,AAPL,CVX,PM,VZ,BA,CSCO,UNH,T,AMGN,TXN,MDT,MO,QCOM,CHTR,HON,KHC | +2/−2 | Information Technology:45%; Health Care:18%; Communication Services:12%; Consumer Staples:12%; Industrials:8%; Energy:5% | INTC,TXN,QCOM |
| 2017-01-03 | MSFT,CVX,MRK,BA,INTC,AAPL,ORCL,VZ,UNH,PM,CSCO,T,TXN,AMGN,CHTR,MDT,QCOM,HON,KHC,MO | +0/−0 | Information Technology:44%; Health Care:17%; Communication Services:13%; Consumer Staples:10%; Industrials:8%; Energy:7% | INTC,TXN,QCOM |
| 2017-04-03 | GE,MSFT,AAPL,BA,MRK,ORCL,PM,INTC,UNH,CSCO,VZ,TXN,T,MO,AMGN,CHTR,MDT,HON,KHC,MMM | +2/−2 | Industrials:39%; Information Technology:31%; Health Care:13%; Consumer Staples:9%; Communication Services:8% | INTC,TXN |
| 2017-07-03 | GE,MSFT,BA,ORCL,AAPL,MRK,PM,UNH,CVX,INTC,CSCO,VZ,MO,TXN,T,AMGN,MDT,CHTR,HON,MMM | +1/−1 | Industrials:37%; Information Technology:31%; Health Care:13%; Communication Services:8%; Consumer Staples:7%; Energy:4% | INTC,TXN |
| 2017-10-02 | GE,MSFT,BA,AAPL,ORCL,MRK,UNH,INTC,CVX,PM,CSCO,VZ,TXN,AMGN,T,CHTR,MO,HON,MDT,MMM | +0/−0 | Industrials:35%; Information Technology:33%; Health Care:13%; Communication Services:8%; Consumer Staples:6%; Energy:4% | INTC,TXN |
| 2018-01-02 | GE,MSFT,BA,CVX,AAPL,UNH,INTC,ORCL,CSCO,MRK,TXN,PM,VZ,T,AMGN,CHTR,HON,MDT,MMM,WMT | +1/−1 | Information Technology:37%; Industrials:30%; Health Care:13%; Communication Services:9%; Consumer Staples:6%; Energy:5% | INTC,TXN |
| 2018-04-02 | MSFT,GE,BA,AAPL,INTC,UNH,ORCL,CSCO,CVX,MRK,TXN,PM,VZ,T,MO,AMGN,HON,MDT,CHTR,MMM | +1/−1 | Information Technology:40%; Industrials:27%; Health Care:14%; Communication Services:8%; Consumer Staples:6%; Energy:4% | INTC,TXN |
| 2018-07-02 | MSFT,GE,BA,AAPL,UNH,INTC,CVX,MRK,ORCL,TXN,VZ,PM,T,AMGN,MDT,HON,MO,CHTR,WMT,MMM | +1/−1 | Information Technology:38%; Industrials:27%; Health Care:15%; Communication Services:8%; Consumer Staples:7%; Energy:4% | INTC,TXN |
| 2018-10-01 | MSFT,BA,AAPL,UNH,MRK,INTC,ORCL,CVX,TXN,VZ,PM,T,MDT,AMGN,HON,MO,CHTR,WMT,MMM,COP | +1/−1 | Information Technology:44%; Health Care:17%; Industrials:15%; Communication Services:9%; Consumer Staples:8%; Energy:7% | INTC,TXN |
| 2019-01-02 | MSFT,BA,UNH,MRK,CVX,INTC,AAPL,VZ,ORCL,TXN,T,PM,AMGN,MDT,COP,HON,WMT,CHTR,MMM,SBUX | +1/−1 | Information Technology:41%; Health Care:18%; Industrials:14%; Communication Services:10%; Energy:9%; Consumer Staples:5%; Consumer Discretionary:2% | INTC,TXN |
| 2019-04-01 | MSFT,BA,MRK,INTC,AAPL,UNH,DIS,CVX,ORCL,VZ,TXN,PM,T,HON,MDT,AMGN,CHTR,MO,WMT,DHR | +3/−3 | Information Technology:42%; Health Care:18%; Communication Services:15%; Industrials:13%; Consumer Staples:8%; Energy:5% | INTC,TXN |
| 2019-07-01 | MSFT,BA,DIS,MRK,AAPL,UNH,CSCO,INTC,ORCL,CVX,TXN,VZ,T,PM,HON,CHTR,MDT,WMT,AMGN,DHR | +1/−1 | Information Technology:47%; Health Care:18%; Communication Services:15%; Industrials:11%; Consumer Staples:5%; Energy:4% | INTC,TXN |
| 2019-10-01 | MSFT,BA,AAPL,MRK,DIS,INTC,TXN,UNH,VZ,CSCO,CVX,ORCL,T,MDT,PM,CHTR,WMT,HON,AMGN,SBUX | +1/−1 | Information Technology:47%; Communication Services:15%; Health Care:15%; Industrials:12%; Consumer Staples:5%; Energy:4%; Consumer Discretionary:2% | INTC,TXN |
| 2020-01-02 | MSFT,BA,AAPL,DIS,MRK,UNH,INTC,CVX,TXN,VZ,CSCO,ORCL,T,CHTR,PM,MDT,AMGN,HON,WMT,DHR | +1/−1 | Information Technology:48%; Health Care:18%; Communication Services:15%; Industrials:10%; Consumer Staples:5%; Energy:5% | INTC,TXN |
| 2020-04-01 | MSFT,GE,AAPL,MRK,UNH,INTC,DIS,VZ,TXN,ORCL,CSCO,BA,CHTR,PM,T,WMT,CVX,AMGN,MDT,HON | +1/−1 | Information Technology:50%; Health Care:15%; Communication Services:14%; Industrials:13%; Consumer Staples:5%; Energy:2% | INTC,TXN |
| 2020-07-01 | MSFT,AAPL,GE,UNH,INTC,MRK,DIS,TXN,CSCO,VZ,ORCL,CHTR,CVX,TMUS,AMGN,T,PM,DHR,WMT,MDT | +2/−2 | Information Technology:54%; Health Care:17%; Communication Services:15%; Industrials:6%; Consumer Staples:5%; Energy:3% | INTC,TXN |
| 2020-10-01 | AAPL,MSFT,UNH,GE,MRK,DIS,TXN,INTC,CHTR,VZ,ORCL,CSCO,TMUS,DHR,WMT,AMGN,QCOM,PM,MDT,T | +1/−1 | Information Technology:66%; Health Care:13%; Communication Services:12%; Industrials:4%; Consumer Staples:4% | TXN,INTC,QCOM |
| 2021-01-04 | AAPL,MSFT,GE,DIS,UNH,TXN,MRK,INTC,VZ,CHTR,ORCL,CVX,CSCO,TMUS,QCOM,DHR,PM,MDT,WMT,HON | +2/−2 | Information Technology:64%; Communication Services:11%; Health Care:11%; Industrials:8%; Consumer Staples:4%; Energy:2% | TXN,INTC,QCOM |
| 2021-04-01 | AAPL,MSFT,GE,DIS,UNH,TXN,INTC,MRK,TSLA,ORCL,CSCO,VZ,CHTR,TMUS,PM,DHR,QCOM,MDT,HON,T | +2/−2 | Information Technology:63%; Communication Services:12%; Health Care:11%; Industrials:9%; Consumer Discretionary:3%; Consumer Staples:2% | TXN,INTC,QCOM |
| 2021-07-01 | AAPL,MSFT,GE,UNH,DIS,TXN,MRK,TSLA,INTC,ORCL,CHTR,CSCO,TMUS,VZ,DHR,PM,MDT,QCOM,HON,NKE | +1/−1 | Information Technology:64%; Health Care:11%; Communication Services:10%; Industrials:9%; Consumer Discretionary:4%; Consumer Staples:2% | TXN,INTC,QCOM |
| 2021-10-01 | AAPL,MSFT,UNH,DIS,TXN,TSLA,MRK,ORCL,INTC,CSCO,CHTR,DHR,CVX,VZ,PM,TMUS,MDT,HON,QCOM,AMD | +2/−2 | Information Technology:69%; Health Care:11%; Communication Services:10%; Consumer Discretionary:3%; Energy:2%; Consumer Staples:2%; Industrials:2% | TXN,INTC,QCOM,AMD |
| 2022-01-03 | AAPL,MSFT,UNH,TSLA,TXN,DIS,CVX,MRK,CSCO,ORCL,INTC,DHR,QCOM,AMD,CHTR,VZ,PM,TMUS,COP,ISRG | +2/−2 | Information Technology:71%; Health Care:11%; Communication Services:8%; Consumer Discretionary:4%; Energy:4%; Consumer Staples:2% | TXN,INTC,QCOM,AMD |
| 2022-04-01 | AAPL,MSFT,UNH,TSLA,TXN,CVX,MRK,DIS,ORCL,CSCO,INTC,DHR,AMD,PM,VZ,TMUS,CHTR,QCOM,RTX,WMT | +2/−2 | Information Technology:70%; Health Care:10%; Communication Services:8%; Consumer Discretionary:4%; Consumer Staples:3%; Energy:3%; Industrials:2% | TXN,INTC,AMD,QCOM |
| 2022-07-01 | AAPL,MSFT,GOOGL,AMZN,UNH,MRK,CVX,TSLA,TXN,ORCL,PM,DIS,VZ,TMUS,DHR,CSCO,INTC,RTX,CHTR,T | +3/−3 | Information Technology:49%; Communication Services:22%; Consumer Discretionary:14%; Health Care:9%; Energy:2%; Consumer Staples:2%; Industrials:1% | TXN,INTC |
| 2022-10-03 | AAPL,MSFT,GOOGL,AMZN,TSLA,UNH,MRK,CVX,TXN,DHR,DIS,TMUS,ORCL,CSCO,PM,VZ,COP,QCOM,WMT,RTX | +3/−3 | Information Technology:47%; Consumer Discretionary:20%; Communication Services:17%; Health Care:9%; Energy:4%; Consumer Staples:3%; Industrials:1% | TXN,QCOM |
| 2023-01-03 | AAPL,MSFT,GOOGL,AMZN,UNH,CVX,MRK,TSLA,TXN,ORCL,COP,PM,CSCO,DHR,TMUS,RTX,DIS,VZ,HON,AMGN | +2/−2 | Information Technology:47%; Communication Services:17%; Consumer Discretionary:13%; Health Care:12%; Energy:6%; Industrials:3%; Consumer Staples:2% | **あり** (TXN) |
| 2023-04-03 | AAPL,MSFT,GOOGL,AMZN,TSLA,UNH,MRK,TXN,CVX,ORCL,CSCO,PM,DIS,TMUS,DHR,AMD,RTX,INTC,VZ,QCOM | +3/−3 | Information Technology:54%; Communication Services:17%; Consumer Discretionary:15%; Health Care:9%; Energy:3%; Consumer Staples:2%; Industrials:1% | **あり** (TXN,AMD,INTC,QCOM) |
| 2023-07-03 | AAPL,MSFT,GOOGL,AMZN,TSLA,UNH,MRK,ORCL,TXN,CVX,CSCO,AMD,PM,DIS,TMUS,DHR,INTC,WMT,RTX,HON | +2/−2 | Information Technology:53%; Consumer Discretionary:18%; Communication Services:15%; Health Care:8%; Consumer Staples:3%; Industrials:2%; Energy:2% | **あり** (TXN,AMD,INTC) |
| 2023-10-02 | AAPL,MSFT,GOOGL,AMZN,TSLA,UNH,MRK,ORCL,CVX,TXN,CSCO,PM,AMD,DHR,TMUS,INTC,DIS,MPC,WMT,AMGN | +2/−2 | Information Technology:51%; Consumer Discretionary:18%; Communication Services:16%; Health Care:9%; Energy:3%; Consumer Staples:3% | **あり** (TXN,AMD,INTC) |
| 2024-01-02 | AAPL,MSFT,GOOGL,AMZN,TSLA,UNH,MRK,CVX,ORCL,TXN,COP,AMD,INTC,CSCO,TMUS,PM,DHR,DIS,QCOM,AMGN | +2/−2 | Information Technology:52%; Consumer Discretionary:18%; Communication Services:16%; Health Care:9%; Energy:4%; Consumer Staples:1% | **あり** (TXN,AMD,INTC,QCOM) |
| 2024-04-01 | MSFT,AAPL,GOOGL,AMZN,TSLA,WMT,MRK,UNH,ORCL,AMD,TXN,CVX,NVDA,DIS,MPC,CSCO,TMUS,QCOM,DHR,PM | +3/−3 | Information Technology:51%; Consumer Discretionary:17%; Communication Services:16%; Health Care:7%; Consumer Staples:5%; Energy:3% | **あり** (AMD,TXN,NVDA,QCOM) |
| 2024-07-01 | MSFT,AAPL,GOOGL,AMZN,TSLA,WMT,UNH,MRK,ORCL,TXN,NVDA,CVX,AMD,QCOM,TMUS,PM,DIS,CSCO,DHR,GE | +1/−1 | Information Technology:52%; Consumer Discretionary:17%; Communication Services:17%; Health Care:7%; Consumer Staples:5%; Energy:2%; Industrials:1% | **あり** (TXN,NVDA,AMD,QCOM) |
| 2024-10-01 | AAPL,MSFT,NVDA,GOOGL,AMZN,TSLA,AVGO,WMT,UNH,ORCL,MRK,TXN,AMD,CVX,PM,TMUS,CSCO,GE,DHR,QCOM | +1/−1 | Information Technology:61%; Consumer Discretionary:15%; Communication Services:12%; Health Care:6%; Consumer Staples:5%; Energy:1%; Industrials:1% | **あり** (NVDA,AVGO,TXN,AMD,QCOM) |
| 2025-01-02 | AAPL,NVDA,MSFT,AMZN,GOOGL,TSLA,AVGO,WMT,ORCL,UNH,MRK,CVX,TXN,TMUS,PM,CSCO,COP,DIS,AMD,ISRG | +3/−3 | Information Technology:58%; Consumer Discretionary:17%; Communication Services:13%; Health Care:5%; Consumer Staples:5%; Energy:3% | NVDA,AVGO,TXN,AMD |
| 2025-04-01 | AAPL,MSFT,NVDA,AMZN,GOOGL,TSLA,AVGO,WMT,UNH,ORCL,PM,TXN,TMUS,MRK,CVX,CSCO,GE,T,PLTR,DIS | +3/−3 | Information Technology:58%; Consumer Discretionary:16%; Communication Services:14%; Consumer Staples:6%; Health Care:4%; Energy:1%; Industrials:1% | NVDA,AVGO,TXN |
| 2025-07-01 | NVDA,MSFT,AAPL,AMZN,GOOGL,AVGO,TSLA,WMT,ORCL,PM,TXN,PLTR,UNH,MRK,TMUS,CSCO,GE,CVX,DIS,AMD | +1/−1 | Information Technology:62%; Consumer Discretionary:15%; Communication Services:12%; Consumer Staples:5%; Health Care:3%; Industrials:1%; Energy:1% | NVDA,AVGO,TXN,AMD |
| 2025-10-01 | NVDA,MSFT,AAPL,GOOGL,AMZN,AVGO,TSLA,ORCL,WMT,PLTR,PM,GE,MRK,UNH,TXN,CVX,AMD,CSCO,TMUS,RTX | +1/−1 | Information Technology:62%; Consumer Discretionary:15%; Communication Services:13%; Consumer Staples:4%; Health Care:2%; Industrials:2%; Energy:1% | NVDA,AVGO,TXN,AMD |
| 2026-01-02 | NVDA,AAPL,GOOGL,MSFT,AMZN,TSLA,AVGO,WMT,ORCL,PLTR,NFLX,MRK,CVX,AMD,MU,GE,PM,TXN,UNH,CSCO | +2/−2 | Information Technology:60%; Communication Services:16%; Consumer Discretionary:15%; Consumer Staples:5%; Health Care:3%; Energy:1%; Industrials:1% | NVDA,AVGO,AMD,MU,TXN |
| 2026-04-01 | NVDA,AAPL,GOOGL,MSFT,AMZN,AVGO,TSLA,WMT,MRK,ORCL,MU,NFLX,CVX,PLTR,AMD,TXN,PM,GE,CSCO,LRCX | +1/−1 | Information Technology:59%; Communication Services:16%; Consumer Discretionary:15%; Consumer Staples:5%; Health Care:2%; Energy:2%; Industrials:1% | NVDA,AVGO,MU,AMD,TXN,LRCX |
| 2026-07-01 | NVDA,GOOGL,AAPL,MSFT,AMZN,AVGO,TSLA,MU,AMD,WMT,TXN,LRCX,CSCO,MRK,GLW,ORCL,GE,UNH,PM,KLAC | +3/−3 | Information Technology:60%; Communication Services:16%; Consumer Discretionary:15%; Consumer Staples:4%; Health Care:3%; Industrials:1% | NVDA,AVGO,MU,AMD,TXN,LRCX,KLAC |
| 2026-10-01 | NVDA,AAPL,GOOGL,MSFT,AMZN,AVGO,TSLA,MU,AMD,WMT,PLTR,CSCO,LRCX,ORCL,CVX,MRK,DELL,UNH,GE,PM | +3/−3 | Information Technology:64%; Communication Services:14%; Consumer Discretionary:14%; Consumer Staples:4%; Health Care:2%; Energy:1%; Industrials:1% | NVDA,AVGO,MU,AMD,LRCX |

### 2023–2024 半導体サマリ

| 構成 | 四半期 | 半導体保有 |
|---|---|---|
| corrdiverse_15__equal | 2023-01-03 | なし |
| corrdiverse_15__equal | 2023-04-03 | なし |
| corrdiverse_15__equal | 2023-07-03 | なし |
| corrdiverse_15__equal | 2023-10-02 | なし |
| corrdiverse_15__equal | 2024-01-02 | なし |
| corrdiverse_15__equal | 2024-04-01 | なし |
| corrdiverse_15__equal | 2024-07-01 | なし |
| corrdiverse_15__equal | 2024-10-01 | なし |
| plain_20__mcap | 2023-01-03 | あり TXN |
| plain_20__mcap | 2023-04-03 | あり TXN,AMD,INTC,QCOM |
| plain_20__mcap | 2023-07-03 | あり TXN,AMD,INTC |
| plain_20__mcap | 2023-10-02 | あり TXN,AMD,INTC |
| plain_20__mcap | 2024-01-02 | あり TXN,AMD,INTC,QCOM |
| plain_20__mcap | 2024-04-01 | あり AMD,TXN,NVDA,QCOM |
| plain_20__mcap | 2024-07-01 | あり TXN,NVDA,AMD,QCOM |
| plain_20__mcap | 2024-10-01 | あり NVDA,AVGO,TXN,AMD,QCOM |

## (7) 最終リバランス（2026-10-01）— なぜこの 15 銘柄まで残ったか（漏斗）

採用構成 **corrdiverse_15__equal** の、その日の選び方です。上から順に「足切り」されていきます。

| 段階 | 残った銘柄数 | この段階で落ちた数 |
|---|---:|---:|
| ① S&P 500 構成（PIT） | 503 | — |
| ② テーマ除外（crypto/space 等）後 | 500 | 3 |
| ③ 金融セクター除外後 | 425 | 75 |
| ④ 当日株価がある | 425 | 0 |
| ⑤ 黒字（TTM・EDGAR） | 113 | 312 |
| ⑥ 相関計算用データ（約 1 年分の値動き） | 113 | 0 |
| ⑦ **eligible**（②〜⑤を一括した公式リスト） | 113 | — |
| ⑧ corrdiverse **候補プール**（⑥で相関が計算できる銘柄） | 113 | 0 |
| ⑨ **最終 15 銘柄** | 15 | 98 はプール内だが枠・相関ルールで不採用 |

※ v1 実行時点の EDGAR キャッシュは **watchlist 中心**（監査 §3）のため、⑤で大半の構成銘柄が落ちています。これが「たばこ・通信ばかり」に見える主因です。

### corrdiverse の考え方（2〜3 文）

候補プールの中で、**他の銘柄と値動きがあまり似ていないもの**を優先します。まずプール全体での「平均の似方（相関）」が**低い順**に並べ、上から 1 銘柄ずつ試します。**すでに選んだ銘柄と相関が 0.7 より高い**ものはスキップし、15 銘柄埋まるまで続けます（`round19-saka.ts` の `pickCorrGreedy`）。

## (8) 採用 15 銘柄 — 選ばれた順番と相関

| 順番 | ティッカー | セクター | プール内の平均相関 | 採用時点で既選銘柄との平均相関 | 最大 ρ（既選） |
|---:|---|---|---:|---:|---:|
| 1 | MO | Consumer Staples | -0.05 | 0.00 | 0.00 |
| 2 | VRSK | Industrials | -0.05 | 0.17 | 0.17 |
| 3 | CVX | Energy | -0.04 | 0.14 | 0.20 |
| 4 | TMUS | Communication Services | -0.04 | 0.25 | 0.28 |
| 5 | T | Communication Services | -0.02 | 0.33 | 0.62 |
| 6 | TYL | Information Technology | -0.01 | 0.18 | 0.54 |
| 7 | PM | Consumer Staples | -0.01 | 0.23 | 0.55 |
| 8 | FANG | Energy | 0.00 | 0.13 | 0.68 |
| 9 | NOW | Information Technology | 0.00 | 0.10 | 0.53 |
| 10 | VLO | Energy | 0.01 | 0.13 | 0.59 |
| 11 | DGX | Health Care | 0.01 | 0.07 | 0.19 |
| 12 | WMT | Consumer Staples | 0.01 | 0.09 | 0.31 |
| 13 | NFLX | Communication Services | 0.02 | 0.10 | 0.29 |
| 14 | AMT | Real Estate | 0.02 | 0.17 | 0.32 |
| 15 | ADSK | Information Technology | 0.02 | 0.18 | 0.64 |

**選定理由の要約:** 各行は「プール内で平均相関が低い順」に試した結果、既選 15 とどれも ρ≤0.7 だった銘柄です（同順位はティッカー名順）。

## (9) 半導体代表銘柄 — どの段階で落ちたか（2026-10-01）

| ティッカー | 結果 |
|---|---|
| NVDA | 枠 15 名満了のため未採用（平均ρ 0.15、順位 69/113） |
| AVGO | 枠 15 名満了のため未採用（平均ρ 0.16、順位 81/113） |
| AMD | 枠 15 名満了のため未採用（平均ρ 0.17、順位 93/113） |
| MU | 枠 15 名満了のため未採用（平均ρ 0.17、順位 91/113） |
| QCOM | 枠 15 名満了のため未採用（平均ρ 0.17、順位 86/113） |
| TXN | 枠 15 名満了のため未採用（平均ρ 0.17、順位 92/113） |
| AMAT | EDGAR facts なし（黒字判定不可） |
| LRCX | 枠 15 名満了のため未採用（平均ρ 0.21、順位 110/113） |
| KLAC | 枠 15 名満了のため未採用（平均ρ 0.19、順位 104/113） |
| INTC | TTM 赤字または黒字データ不足 |

※ 半導体 **セクター上限 30%** は **ウェイト付け段階**（equal なら採用後も各 6.7%）であり、**選定段階では不適用**です。

## (10) 手数料 **$244**（採用構成・OOS・$0.35）の内訳

スタディは**四半期ごとに全売却→再購入**（`simulateSaka`）のため、銘柄が同じでも「売り＋買い」の 2 注文が発生します。

| 項目 | 注文数 | 金額（$0.35/注文） |
|---|---:|---:|
| OOS 四半期リバランス回数 | 24 回 | — |
| **合計注文** | **705** | **$247**（`ROUND19_ja.md` **$244** — 再集計差は端数・丸め） |
| 銘柄入替に伴う注文（外れた銘柄の売り＋新規の買い） | 181 | $63 |
| 継続銘柄のウェイト合わせ（売り＋買いの両方） | 524 | $183 |

**見積（ラベル付き）:** 取引額が **$50 未満**のリバランス片をスキップした場合、約 **0** 注文を省略でき、手数料はおおよそ **$0** 少なくなる可能性があります（実装は未変更・概算のみ）。



## Corrected v1（バグ修正再実行・**新デザインではない**）

事前登録 `6e3ad93` の **30 構成・IS 採用規則は同一**。データは `data/.cache/pit/`（`docs/DATA_PIT_ja.md`）。

### 事実 — 修正内容

| 修正 | 内容 |
|---|---|
| CIK | SEC マップ + `PIT_TICKER_ALIASES` + `data/pit_cik_overrides.json`（版管理） |
| 価格 | Yahoo（`pit_price_ticker_aliases.json` で現行ティッカー）→ Stooq → pickdani GitHub CSV；`price_meta.json` に source |
| EDGAR | facts 欠損は **unknown**；黒字は **filed ≤ リバランス日** の四半期のみ TTM（`ttmNetIncomePitAudit`） |
| 相関 | 日付キーでリターンを揃えて Pearson |
| 株クラス | 同一 CIK は 1 銘柄（GOOG/GOOGL 等） |
| 約定 | 主表は **差分リバランス**（$25 / 20% ドリフト） |

### 事実 — データカバレッジ

- PIT ユニーク: **745**／facts ファイル **739**（99.2%）
- CIK 未解決: **0**
- リバランス日 PIT 構成に対する **facts** 最悪値: **99.2%**（目標 ≥95%）
- リバランス日 PIT 構成に対する **価格** 最悪値: **87.7%**（目標 ≥95%）

**Before/after（`e2380b8` → 本実行）:** 採用 **plain_15__equal** → **plain_15__mcap_cap5**；OOS CAGR **15.4%** → **15.4%**；OOS DD **-20.3%** → **-19.0%**；OOS 順位 **5/30** → **4/30**

### 事実 — PIT 黒字（コード根拠）

`round19-saka.ts` の `factFiledOnOrBefore` が各 `NetIncomeLoss` 四半期の **`filed`** をリバランス日以下でフィルタ。例 **AAPL** @ **2020-01-02**（TTM **138.47B**）:

| 四半期終了 | filed | fp | form | 値 |
|---|---|---|---|---:|
| 2019-06-29 | 2019-07-31 | Q3 | 10-Q | 41.57B |
| 2019-03-30 | 2019-05-01 | Q2 | 10-Q | 31.53B |
| 2018-12-29 | 2019-01-30 | Q1 | 10-Q | 19.96B |
| 2018-06-30 | 2018-08-01 | Q3 | 10-Q | 45.41B |

### 事実 — 四半期漏斗（修正後）

「−価格なし」= 金融・テーマ後でも当日株価が無い銘柄（旧表の 297+18+13≠454 の差 **126** はここ）。「−株クラス」= 黒字後の重複 CIK 除外数。

| 日付 | PIT | 金融・テーマ後 | −価格なし | 黒字 | 赤字 | unknown | −株クラス | eligible | facts/PIT | ∩watchlist |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2016-01-04 | 504 | 454 | 89 | 324 | 21 | 20 | 11 | 313 | 99.2% | 20.1% |
| 2016-04-01 | 505 | 454 | 85 | 329 | 20 | 20 | 11 | 318 | 99.4% | 19.8% |
| 2016-07-01 | 507 | 454 | 78 | 340 | 21 | 15 | 13 | 327 | 99.6% | 19.6% |
| 2016-10-03 | 507 | 454 | 73 | 341 | 24 | 16 | 13 | 328 | 99.8% | 19.8% |
| 2017-01-03 | 506 | 453 | 71 | 340 | 26 | 16 | 13 | 327 | 99.8% | 20.2% |
| 2017-04-03 | 506 | 452 | 67 | 339 | 29 | 17 | 12 | 327 | 99.8% | 20.2% |
| 2017-07-03 | 506 | 452 | 62 | 335 | 37 | 18 | 11 | 324 | 99.8% | 20.1% |
| 2017-10-02 | 506 | 452 | 57 | 350 | 30 | 15 | 11 | 339 | 99.8% | 20.4% |
| 2018-01-02 | 505 | 451 | 55 | 356 | 27 | 13 | 11 | 345 | 100.0% | 20.0% |
| 2018-04-02 | 506 | 452 | 54 | 358 | 27 | 13 | 10 | 348 | 100.0% | 19.8% |
| 2018-07-02 | 507 | 452 | 53 | 360 | 27 | 12 | 9 | 351 | 100.0% | 20.5% |
| 2018-10-01 | 506 | 451 | 52 | 365 | 23 | 11 | 9 | 356 | 100.0% | 21.1% |
| 2019-01-02 | 506 | 450 | 47 | 371 | 21 | 11 | 9 | 362 | 99.8% | 21.8% |
| 2019-04-01 | 505 | 449 | 43 | 370 | 23 | 13 | 9 | 361 | 99.8% | 21.9% |
| 2019-07-01 | 506 | 450 | 43 | 375 | 19 | 13 | 10 | 365 | 99.8% | 21.4% |
| 2019-10-01 | 505 | 448 | 38 | 382 | 19 | 9 | 10 | 372 | 99.8% | 22.3% |
| 2020-01-02 | 505 | 446 | 34 | 388 | 16 | 8 | 12 | 376 | 99.8% | 22.6% |
| 2020-04-01 | 505 | 446 | 32 | 392 | 15 | 7 | 12 | 380 | 99.8% | 22.6% |
| 2020-07-01 | 505 | 446 | 30 | 376 | 32 | 8 | 9 | 367 | 99.8% | 23.2% |
| 2020-10-01 | 505 | 446 | 30 | 361 | 49 | 6 | 8 | 353 | 99.6% | 22.4% |
| 2021-01-04 | 505 | 446 | 28 | 356 | 55 | 7 | 8 | 348 | 99.6% | 22.4% |
| 2021-04-01 | 505 | 445 | 25 | 355 | 58 | 7 | 8 | 347 | 99.6% | 22.5% |
| 2021-07-01 | 505 | 445 | 23 | 347 | 67 | 8 | 7 | 340 | 99.6% | 22.1% |
| 2021-10-01 | 505 | 444 | 21 | 361 | 56 | 6 | 6 | 355 | 99.6% | 23.1% |
| 2022-01-03 | 505 | 442 | 19 | 378 | 39 | 6 | 7 | 371 | 99.6% | 23.2% |
| 2022-04-01 | 505 | 440 | 16 | 378 | 40 | 6 | 6 | 372 | 99.6% | 23.1% |
| 2022-07-01 | 503 | 438 | 14 | 395 | 24 | 5 | 4 | 391 | 99.6% | 23.3% |
| 2022-10-03 | 505 | 440 | 14 | 397 | 24 | 5 | 5 | 392 | 99.6% | 23.2% |
| 2023-01-03 | 503 | 436 | 9 | 394 | 28 | 5 | 5 | 389 | 99.6% | 24.2% |
| 2023-04-03 | 503 | 436 | 7 | 392 | 30 | 7 | 5 | 387 | 99.6% | 24.0% |
| 2023-07-03 | 503 | 437 | 5 | 394 | 31 | 7 | 5 | 389 | 99.8% | 23.7% |
| 2023-10-02 | 504 | 436 | 6 | 395 | 29 | 6 | 5 | 390 | 99.8% | 24.4% |
| 2024-01-02 | 503 | 436 | 4 | 397 | 28 | 7 | 4 | 393 | 99.8% | 24.2% |
| 2024-04-01 | 504 | 436 | 3 | 399 | 26 | 8 | 4 | 395 | 99.8% | 24.6% |
| 2024-07-01 | 503 | 434 | 3 | 404 | 21 | 6 | 4 | 400 | 99.8% | 24.3% |
| 2024-10-01 | 504 | 434 | 3 | 407 | 19 | 5 | 4 | 403 | 99.8% | 25.3% |
| 2025-01-02 | 503 | 432 | 3 | 411 | 16 | 2 | 4 | 407 | 100.0% | 25.3% |
| 2025-04-01 | 503 | 432 | 3 | 410 | 17 | 2 | 4 | 406 | 100.0% | 25.6% |
| 2025-07-01 | 503 | 431 | 3 | 404 | 22 | 2 | 4 | 400 | 100.0% | 26.3% |
| 2025-10-01 | 503 | 429 | 3 | 405 | 18 | 3 | 3 | 402 | 100.0% | 26.4% |
| 2026-01-02 | 503 | 427 | 3 | 399 | 22 | 3 | 3 | 396 | 100.0% | 26.8% |
| 2026-04-01 | 503 | 426 | 4 | 395 | 24 | 3 | 3 | 392 | 100.0% | 27.6% |
| 2026-07-01 | 503 | 425 | 3 | 393 | 24 | 5 | 3 | 390 | 100.0% | 28.5% |
| 2026-10-01 | 503 | 425 | 0 | 400 | 21 | 4 | 3 | 397 | 100.0% | 28.5% |

### 事実 — 相関（2026-10-01）

| ペア | ρ（日付揃え） |
|---|---:|
| KLAC–LRCX | 0.875 |
| CVX–XOM | 0.843 |
| MO–PM | 0.550 |
| AMD–NVDA | 0.471 |
| プール中央値 | 0.110 |

**corrdiverse 用「平均ρ 低い順」上位 15（日付揃え）:** CF, EOG, CVX, FANG, OXY, VLO, DVN, APA, COP, LYB, MPC, CTVA, STX, PSX, DDOG

**旧方式（インデックス揃え・監査比較）:** CF, EOG, CVX, FANG, OXY, VLO, DVN, APA, COP, LYB, MPC, CTVA, STX, PSX, DDOG — リスト一致: **はい**

### 事実 — IS 採用

- **plain_15__mcap_cap5**（IS CAGR 14.1%、DD -31.5%）

### 事実 — OOS（$0.35・差分リバランス）

| 順位 | 構成 | OOS 年率 | OOS DD | OOS 手数料 |
|---:|---|---:|---:|---|
| 1 | plain_15__equal | 15.9% | -18.1% | $107 (306 ord) |
| 2 | plain_20__mcap_cap5 | 15.7% | -19.1% | $130 (371 ord) |
| 3 | plain_20__equal | 15.7% | -19.1% | $130 (371 ord) |
| 4 | **plain_15__mcap_cap5** | 15.4% | -19.0% | $113 (323 ord) |
| 5 | plain_15__mcap_cap10 | 14.7% | -22.1% | $103 (293 ord) |
| 6 | plain_20__mcap_cap10 | 13.7% | -21.9% | $121 (346 ord) |
| 7 | plain_15__invvol | 11.3% | -14.9% | $123 (351 ord) |
| 8 | plain_20__invvol | 10.9% | -16.0% | $152 (433 ord) |
| 9 | volprune_20__mcap | 7.2% | -22.4% | $167 (477 ord) |
| 10 | corrdiverse_20__mcap_cap5 | 6.9% | -18.5% | $162 (464 ord) |
| 11 | corrdiverse_15__mcap_cap5 | 6.9% | -20.8% | $129 (368 ord) |
| 12 | plain_20__mcap | 6.5% | -25.8% | $103 (295 ord) |
| 13 | volprune_20__mcap_cap5 | 6.4% | -21.2% | $169 (483 ord) |
| 14 | corrdiverse_20__equal | 6.3% | -18.8% | $162 (464 ord) |
| 15 | plain_15__mcap | 6.2% | -27.0% | $80 (229 ord) |
| 16 | volprune_15__mcap_cap5 | 6.0% | -18.2% | $129 (369 ord) |
| 17 | volprune_20__equal | 5.9% | -18.3% | $165 (471 ord) |
| 18 | corrdiverse_15__equal | 5.9% | -18.3% | $130 (371 ord) |
| 19 | corrdiverse_20__mcap_cap10 | 5.6% | -20.8% | $164 (468 ord) |
| 20 | volprune_20__mcap_cap10 | 5.0% | -20.7% | $172 (490 ord) |
| 21 | corrdiverse_20__mcap | 5.0% | -19.6% | $153 (438 ord) |
| 22 | corrdiverse_20__invvol | 4.9% | -16.6% | $188 (536 ord) |
| 23 | corrdiverse_15__invvol | 4.8% | -19.3% | $149 (425 ord) |
| 24 | volprune_15__mcap | 4.5% | -22.1% | $123 (350 ord) |
| 25 | corrdiverse_15__mcap_cap10 | 4.2% | -24.2% | $132 (378 ord) |
| 26 | volprune_15__equal | 4.1% | -18.5% | $129 (368 ord) |
| 27 | volprune_15__invvol | 4.1% | -17.8% | $147 (421 ord) |
| 28 | volprune_15__mcap_cap10 | 3.7% | -20.5% | $130 (372 ord) |
| 29 | corrdiverse_15__mcap | 2.2% | -34.8% | $117 (333 ord) |
| 30 | volprune_20__invvol | -0.2% | -40.0% | $188 (538 ord) |
| — | SPY | 15.2% | -24.5% | — |

**OOS 順位:** 4 / 30

### 事実 — 暦年リターン（採用 vs SPY・前年最終営業日）

| 年 | plain_15__mcap_cap5 | SPY |
|---|---:|---:|
| 2016 | — | — |
| 2017 | 18.1% | 21.7% |
| 2018 | -1.6% | -4.6% |
| 2019 | 24.2% | 31.2% |
| 2020 | 16.5% | 18.3% |
| 2021 | 26.7% | 28.7% |
| 2022 | -14.5% | -18.2% |
| 2023 | 21.6% | 26.2% |
| 2024 | 27.1% | 24.9% |
| 2025 | 18.2% | 17.7% |
| 2026 YTD | 13.2% | 13.7% |

**プラス年比率（2016–2026）:** 80%

### 事実 — 事前登録合格基準（OOS・$0.35）

| 基準 | 採用構成 | 判定 |
|---|---|---|
| OOS CAGR ≥ 10% | 15.4% | 合格 |
| OOS MaxDD < SPY（-24.5%） | -19.0% | 合格 |
| 暦年プラス ≥ 70% | 80% | 合格 |
| （参考）OOS CAGR > SPY | 15.4% vs 15.2% | はい |

### 事実 — 手数料の同条件比較（OOS・$0.35）

| 構成 | 差分リバランス | 全売却→再購入 |
|---|---|---|
| corrdiverse_15__equal | $130 / 371 注文 | $245 / 701 注文 |
| **plain_15__mcap_cap5** | $113 / 323 注文 | $248 / 708 注文 |

### 事実 — 最終ホールディング（2026-10-01）

最大ペア ρ: **0.60**。ρ>0.6: MU–AMD (0.60)

| ティッカー | セクター | ウェイト |
|---|---|---:|
| NVDA | Information Technology | 7.8% |
| AAPL | Information Technology | 7.8% |
| GOOGL | Communication Services | 7.8% |
| MSFT | Information Technology | 7.8% |
| AMZN | Consumer Discretionary | 7.8% |
| AVGO | Information Technology | 7.8% |
| TSLA | Consumer Discretionary | 5.0% |
| MU | Information Technology | 5.0% |
| LLY | Health Care | 5.0% |
| AMD | Information Technology | 5.0% |
| WMT | Consumer Staples | 5.0% |
| JNJ | Health Care | 5.0% |
| ABBV | Health Care | 7.8% |
| PLTR | Information Technology | 7.8% |
| CSCO | Information Technology | 7.8% |

### 事実 — 半導体（2023–2024）

- 採用 **plain_15__mcap_cap5**: **あり**
- plain_20__mcap: **あり**

### 解釈

- watchlist 100% 張り付きは解消（∩watchlist はおおむね 25–28%）。eligible 拡大により IS 採用が **mcap 上位 plain** に移った可能性がある（過適合リスクは v1 事前登録どおり残る）。
- facts カバレッジが 2016 台で 77–88% の四半期は、PIT 構成員の EDGAR 未取得が残っている（`rebuild-pit-dataset.ts --fetch-facts` で改善）。

*生成: `npx tsx scripts/round19-corrected-v1-study.ts`*
