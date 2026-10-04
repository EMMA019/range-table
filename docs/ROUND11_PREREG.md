# Round 11 — stop-width filter — pre-registration

Locked before any round-11 run. A change to the text below is a new study, not a silent edit. Analysis only. Live alerts, the frozen paper-test rules, and `data/watchlist.yaml` are not part of this file.

Results must cite the commit that added this file. The no-filter row must reproduce the published round-10 baseline, which is the round-9 `F-off` book for C plus idle-cash SOXX, entry E30, box exit, 20-day box. A mismatch of account P&L, max mark-to-market drawdown, ETF P&L, stock trade count, ETF trade count, joint-loss days, or the $1.90 total stops the run.

## What stays

The book is the round-10 baseline. That is round-8 `C+SOXX` with entry E30, the box exit, and a 20-day box, with no regime filter. The sleeve rules are the round-8 pre-registration at `4235eface3528f5e1ca4a13e1cf1d0a75742a1f5`, the ATR amendment at `52b73ed249d46e5d3af26d61c1148af5e83397a5`, and the entry amendment at `54dcc909b06c22fe7e1a0c36be8aa334ee910eda`. The stock exit is round-7 C, locked at `d5864cd146d28a9c47faee2aea9d0dc5db3aa3ac`, on the round-4 base plus F1-include-unknown plus F2, locked at `1c2da22ba844c94ece16595262deddf5c606fbfb`. The round-10 sizing study is the comparator, locked at `573cc7409decf183db4714ddb0bc795e51e811b6`. This round does not use the round-10 `R30` or `R35` share counts.

E30 is a close strictly above the box low and at or below the 30% line, with no previous-close check. The 30% line is the box low + 0.30 × (box high − box low), rounded to 4 decimals. The box exit is the box low and the box high. The entry open must stay strictly inside the signal box. One ETF at a time. Stock signals win. Preemption, settlement, the 35% stock gap void, and the next-open fill stay as locked. The void is not applied to SOXX.

Capital is $3,200. At most five stock positions, at most two in the round-4 semiconductor class, one position per ticker. Rank is 20-session excess return, then ticker A–Z. Sale proceeds settle on the next session, except a preemption, which settles immediately.

The stock lot stays `sharesForBudget`, $300 to $450. The SOXX lot stays `min(floor(32 / (entry − box low)), floor(idle cash / entry))`. Idle cash is settled cash after that session's stock entries. Zero shares skips the ETF entry. No fractional shares. The $32 is the locked 1% of $3,200. This round does not resize SOXX and does not resize a stock that still enters.

Windows: 2022-10-03 through 2024-10-02, and 2024-10-03 through the last SPY session on or before 2026-10-02. Judged cells are point-in-time S&P 500+400 and ADV top 200, both windows. The current list is stored and not judged. The current-list signal close cap of $550 stays. Point-in-time and ADV do not use that cap.

## Fee

The engine still charges $0.70 on each stock sell and each ETF sell, and nothing on the buy. That is the locked round-8 charge. It is not $0.70 on the buy and again on the sell.

The reported net adds every engine $0.70 sell charge back and subtracts $1.90 once per stock position and once per ETF position. A position that sells in one fill is one $1.90. This is the series round-trip restatement. The request's "$1.90 per side" is this one charge per position. It is not $1.90 on the buy and another $1.90 on the sell. The net is what the report leads with beside the engine total. It is not the verdict. The drawdown path is the engine path, with the $0.70 sells.

## Width filter

Only individual-stock entries change, and only by being dropped. The three thresholds, chosen before the run, are 10%, 12%, and 15%. No other threshold is tried. The no-filter row is the baseline.

The stop is the engine stop on that stock candidate. On exit C that stop is the signal session's `low20`, stored as `cand.stop`. The entry is the next session's open, stored as `cand.entry`. Both are the unrounded prices. The fraction is `(entry − stop) / entry`. There is no rounding before the comparison.

The filter runs after F1-include-unknown, after F2, and after exit C is planned, on candidates that are not voided and whose entry date is inside the window, and before the portfolio walk. A candidate the filter drops is not passed to the walk. Its cash and its slot stay free for a later stock and for SOXX.

- `entry ≤ 0`, or a missing or non-finite stop: the study stops. It does not treat that name as a skip.
- Fraction strictly greater than X: skip. Reason `width`.
- Fraction equal to X: keep.
- `entry ≤ stop`: the fraction is not strictly greater than X, so this filter does not skip the name. The book may still enter it. Exit C allows a gap through the stop.

SOXX orders are not tested and are not dropped by this filter.

The width skip count is the number of candidates removed by the fraction test. A name removed here is not also counted as `budget`, `slot`, `cash`, or `semi`. The walk can still refuse a name that remains. Those counters stay the engine's:

- `budget`: `sharesForBudget(entry, 300, 450)` returns null.
- `slot`: the five-position cap, or the throttled cap, is full.
- `cash`: settled cash cannot pay for the shares.
- `semi`: the name is in the round-4 semiconductor class and two such names are already open.

A second signal in a ticker that is already open is dropped by the walk and has no counter of its own. The baseline width count is zero. Its `budget` count is the same count the round-10 baseline stored.

## Reference exclusion

One extra row is stored and not judged. Its label is hindsight reference. It is the baseline book plus a ticker exclusion. It does not use the width filter. It is not a pass, a fail, or a hold.

`data/watchlist.yaml` has no tag named solar, crypto, or nuclear. The tags in that file are unrelated. This row therefore uses the lists already locked in the round-7b pre-registration at `98704c07b43b4ed8aa266d8a7bf736f1d3acb866`, and the watchlist description text, both of which exist before this run. The labels were chosen with knowledge through 2026-10-03. They are not measured from this backtest.

Excluded tickers, and how:

- Nuclear, the round-7b nuclear list: CEG, TLN, OKLO, SMR, CCJ, LEU. The watchlist group `発電・原子力` is wider. BE, VST, NRG, and FLNC stay eligible. They are not on that nuclear list.
- Crypto, a watchlist description that contains `マイニング`: IREN, CIFR, WULF. Those three descriptions are the only ones that contain that word. APLD and CORZ are on the round-7b transition list and are not excluded. Their descriptions do not contain `マイニング`, and there is no crypto tag.
- Solar: no ticker. The repo has no solar tag, no solar group, and no description that names solar. No ticker is added after the run.
- Loss-making: the baseline already skips a candidate whose trailing four-quarter GAAP net income is strictly below zero, and it keeps an unknown, using the slim EDGAR cache and the signal date. That is F1-include-unknown. This row does not apply F1 a second time. The round-7b hindsight loss-making list is not used. A candidate that reaches this row has already passed F1, so the loss-making clause removes nobody. The study stores that removed count, and it stops if the count is not zero.
- SPCX exception: SPCX is removed from the exclusion set if it appears there. It is not on the nuclear list and not on the crypto list. The exception does not put a name back that F1 or F2 already refused. It does not change the baseline treatment of SPCX.

The exclusion runs on the same candidate set as the width filter: after F1-include-unknown, after F2, after exit C, not voided, entry inside the window, before the walk. A removed name is not passed to the walk. Its cash and its slot stay free for a later stock and for SOXX. The theme skip count is the number of candidates removed because the ticker is on the nuclear list or the crypto list. SOXX is not on either list.

## Scoring

A stock position is one trade. An ETF position is one trade. Account P&L is ending equity minus $3,200. Max drawdown is the peak-to-trough of engine equity marked at each close. The stored drawdown is that engine figure. The peak date, peak equity, trough date, and trough equity are read from the cent-rounded daily path. When those two cents do not subtract to the engine figure, both numbers are stored. The round-10 baseline already differs by $0.01 on the cent-rounded path for point-in-time 2022–24 and ADV 2024–26. That penny is not a baseline failure. The baseline check uses the engine drawdown.

The lowest equity is the minimum cent-rounded close mark in the window, with its date, and the difference from $3,200.

The win rate, the average win, and the average loss use stock positions and ETF positions together. A win is engine P&L strictly above zero. A flat position is in the trade count and in neither average. The averages use the engine P&L. The win count is stored.

Wins lost versus the baseline use the identity `ticker|entryDate`. A later fill of the same ticker is a different trade. A baseline winning position whose identity is absent from the variant's fills is one win lost. Stock wins lost and ETF wins lost are stored separately. The stock count is the filter's dropped winners. The ETF count is the change in which SOXX trades filled.

A large loss is an engine position P&L less than or equal to −$60. The count and the sum are stored for stock and ETF together, and again for stocks only. The variant's figures are stored beside the baseline's figures for the same cell.

SOXX trades are the ETF fill count. SOXX P&L is the sum of ETF engine P&L. The change versus the baseline is the variant's count minus the baseline's count, and the variant's P&L minus the baseline's P&L, on the same universe and the same window.

Capital deployed is the average, over the window's sessions, of stock market value at the close plus ETF market value at the close, divided by $3,200. The two sleeve averages are stored as well. Their sum is this figure.

For NBIS, CRWV, CRDO, CVNA, ENPH, and SEDG, each cell stores the variant's filled trade count and the sum of those engine P&Ls. Versus the baseline it stores how many baseline fills of that ticker are absent, the sum of those absent fills' engine P&Ls, and the sum of the absent fills whose engine P&L is strictly below zero. A ticker with no fill stores zeros. Absence from a universe is a zero, not a missing row.

The pass rule is the round-7 rule, on the engine account total. Below 100 trades the window is a hold before a loss can fail. Otherwise the engine total must be positive. `n < N` is a hold even when the ratio or the bootstrap bound fails. A negative total with at least 100 trades fails. The ratio is the engine total divided by the engine max drawdown, and it must be strictly above the SPY ratio. The bootstrap one-sided 98% lower bound of the mean trade must be above zero. The bootstrap is 10,000 draws, seed 20261003, q = 0.02, z = 2.05. `N = (2.05 × sd / mean)²`. `n` and the mean are stock positions plus ETF positions, in engine dollars. SPY is +$1,661.54 / $379.84 / 4.37 out of sample and +$982.45 / $582.25 / 1.69 in sample.

Judged rows are the 10%, 12%, and 15% filters, on the four point-in-time and ADV cells. The baseline is the comparator. It is stored and not judged. The current list is not judged. The reference exclusion is not judged. One fail fails the row. A hold keeps the row a hold. Beating or missing the baseline is reported and is not a second gate. The $1.90 net is not the verdict.

## Hypotheses

These were written before the run. They are not the pass rule.

Skipping a stock whose stop sits more than X below the entry should cut the count and the sum of stock losses at or below −$60, and it may cut the account drawdown. The engine stop is the 20-session low, so a wide fraction is a wide box, not a gap that has already happened.

Account P&L is not assumed to rise. The dropped trades include wide-stop winners. The cash they would have used can fill a different later stock and can fill extra SOXX trades. Those replacements are part of the result.

## Selection

The three thresholds were chosen before the run. No other threshold is tried. Three variants times four judged cells is twelve verdicts. The chance that one cell looks good by luck is non-trivial. The report states that.

Dropping wide-stop names can drop the large winners. A higher win rate, a smaller average loss, or a smaller drawdown on the filled set can come from dropping those names. The filled-trade averages are not the result of the baseline trades with a different exit. Skipped capital that SOXX then uses is part of this filter. It is not a separate search over ETF rules.

The reference exclusion was chosen from lists that already existed. It is hindsight. It is not evidence that the same lists would have been chosen at the start of either window.

## Published cells the baseline must match

Round-10 baseline, which is round-8 SOXX, E30, box exit, 20-day box, no regime filter, stock lot $300–$450. Account P&L, ETF P&L, ETF trades, stock trades, drawdown, joint-loss days, $1.90 total:

| Universe | 2022-10–2024-10 | 2024-10–2026-10 |
|---|---|---|
| current list | +$2,174.12, ETF +$371.05, 29 / 245, DD $639.82, 79, $1.90 +$1,855.86 | +$949.29, ETF +$293.12, 23 / 265, DD $918.14, 66, $1.90 +$617.01 |
| point-in-time | +$670.37, ETF +$334.61, 30 / 319, DD $646.89, 82, $1.90 +$261.36 | +$560.29, ETF +$258.05, 23 / 340, DD $954.41, 63, $1.90 +$129.58 |
| ADV top 200 | +$1,105.85, ETF +$351.20, 29 / 236, DD $621.54, 78, $1.90 +$799.74 | +$1,069.65, ETF +$364.60, 23 / 261, DD $804.17, 60, $1.90 +$735.84 |
