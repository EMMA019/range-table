# Round 13 — ATR cap — pre-registration

Locked before any round-13 run. A change to the text below is a new study, not a silent edit. Analysis only. Live alerts, the frozen paper-test rules, and `data/watchlist.yaml` are not part of this file.

Results must cite the commit that added this file.

## The 8% threshold is post hoc

The 8% cap was found after the fact from the round-10 baseline's own trades. That search used the same 2022–24 and 2024–26 windows this study scores. It is in-sample. It is hindsight. This file does not re-open that search and does not try any threshold other than the three named below. A result on the 8% row is confirmatory-weak. It is not evidence that 8% was known at the start of either window, and it is not a license to trade the cap.

## What stays

The book is the round-11 and round-12 baseline. That is round-8 `C+SOXX` with entry E30, the box exit, and a 20-day box, with no regime filter. The sleeve rules are the round-8 pre-registration at `4235eface3528f5e1ca4a13e1cf1d0a75742a1f5`, the ATR amendment at `52b73ed249d46e5d3af26d61c1148af5e83397a5`, and the entry amendment at `54dcc909b06c22fe7e1a0c36be8aa334ee910eda`. The stock exit is round-7 C, locked at `d5864cd146d28a9c47faee2aea9d0dc5db3aa3ac`, on the round-4 base plus F1-include-unknown plus F2, locked at `1c2da22ba844c94ece16595262deddf5c606fbfb`. The round-10 sizing study is the comparator, locked at `573cc7409decf183db4714ddb0bc795e51e811b6`. This round does not use the round-10 `R30` or `R35` share counts. It does not use the round-11 width filter or the round-12 exclusion lists.

E30 is a close strictly above the box low and at or below the 30% line, with no previous-close check. The 30% line is the box low + 0.30 × (box high − box low), rounded to 4 decimals. The box exit is the box low and the box high. The entry open must stay strictly inside the signal box. One ETF at a time. Stock signals win. Preemption, settlement, the 35% stock gap void, and the next-open fill stay as locked. The void is not applied to SOXX.

Capital is $3,200. At most five stock positions, at most two in the round-4 semiconductor class, one position per ticker. Rank is 20-session excess return, then ticker A–Z. Sale proceeds settle on the next session, except a preemption, which settles immediately.

The stock lot stays `sharesForBudget`, $300 to $450. The SOXX lot stays `min(floor(32 / (entry − box low)), floor(idle cash / entry))`. Idle cash is settled cash after that session's stock entries. Zero shares skips the ETF entry. No fractional shares. The $32 is the locked 1% of $3,200. This round does not resize SOXX and does not resize a stock that still enters.

Windows: 2022-10-03 through 2024-10-02, and 2024-10-03 through the last SPY session on or before 2026-10-02. Judged cells are point-in-time S&P 500+400 and ADV top 200, both windows, and only the 8% row. The 7% row, the 10% row, and the current list are stored and not judged. The current-list signal close cap of $550 stays. Point-in-time and ADV do not use that cap.

The no-cap row must reproduce the published round-10 baseline, which is the same book. A mismatch of account P&L, max mark-to-market drawdown, ETF P&L, stock trade count, ETF trade count, joint-loss days, or the $1.90 total stops the run.

## Fee

The engine still charges $0.70 on each stock sell and each ETF sell, and nothing on the buy. That is the locked round-8 charge. It is not $0.70 on the buy and again on the sell.

The reported net adds every engine $0.70 sell charge back and subtracts $1.90 once per stock position and once per ETF position. A position that sells in one fill is one $1.90. This is the series round-trip restatement. It is not $1.90 on the buy and another $1.90 on the sell. The net is what the report leads with beside the engine total. It is not the verdict. The drawdown path is the engine path, with the $0.70 sells.

## ATR cap

Only individual-stock entries change, and only by being dropped. The thresholds are 8% (primary), 7% (reference), and 10% (reference). No other threshold is tried. The no-cap row is the baseline.

ATR14 is the signal session's average true range already stored on the candidate. It is the simple average of the 14 true ranges ending at that session, rounded to 4 decimals, the same `atr14` the book's ATR ≥ 3% gate uses. The close is that same signal session's close, the unrounded feature close the gate divides by. The percent is `(ATR14 / close) × 100`. There is no further rounding before the comparison.

The filter runs after F1-include-unknown, after F2, and after exit C is planned, on candidates that are not voided and whose entry date is inside the window, and before the portfolio walk. A candidate the filter drops is not passed to the walk. Its cash and its slot stay free for a later stock and for SOXX.

- Close not strictly positive, or a missing or non-finite ATR14: the study stops. It does not treat that name as a skip.
- Percent strictly greater than X: skip. Reason `atr`.
- Percent equal to X: keep.

SOXX orders are not tested and are not dropped by this filter.

The ATR skip count is the number of candidates removed by the percent test. A name removed here is not also counted as `budget`, `slot`, `cash`, or `semi`. The walk can still refuse a name that remains. Those counters stay the engine's:

- `budget`: `sharesForBudget(entry, 300, 450)` returns null.
- `slot`: the five-position cap, or the throttled cap, is full.
- `cash`: settled cash cannot pay for the shares.
- `semi`: the name is in the round-4 semiconductor class and two such names are already open.

A second signal in a ticker that is already open is dropped by the walk and has no counter of its own. The baseline ATR skip count is zero.

## Scoring

A stock position is one trade. An ETF position is one trade. Account P&L is ending equity minus $3,200. Max drawdown is the peak-to-trough of engine equity marked at each close. The stored drawdown is that engine figure. The peak date, peak equity, trough date, and trough equity are read from the cent-rounded daily path. When those two cents do not subtract to the engine figure, both numbers are stored. The round-10 baseline already differs by $0.01 on the cent-rounded path for point-in-time 2022–24 and ADV 2024–26. That penny is not a baseline failure. The baseline check uses the engine drawdown.

The lowest equity is the minimum cent-rounded close mark in the window, with its date, and the difference from $3,200.

Wins lost, and losses removed, use the identity `ticker|entryDate` on stock fills. A later fill of the same ticker is a different trade. A baseline stock fill whose identity is absent from the variant is removed.

- A removed fill with engine P&L strictly above zero is a win lost. The count and the sum are stored.
- A removed fill with engine P&L strictly below zero is a loss removed. The count and the sum are stored.
- A removed fill with engine P&L of zero is a flat. The count is stored so the three counts add to the removed count.

ETF fills use the same identity on the ETF sleeve. Their count and P&L change versus the baseline are stored separately. They are not inside the stock win-lost or loss-removed totals.

A replacement is a variant stock fill whose `ticker|entryDate` is absent from the baseline. The count and the sum of those engine P&Ls are stored, with the same per-ticker split. A replacement can be a win or a loss. It is not a removed baseline trade.

For HIMS, CLS, and SMCI, every cell stores the removed wins (count and sum), the removed losses (count and sum), and the replacement count and sum, even when every figure is zero. Every other ticker with a removed fill or a replacement fill is stored the same way. The report names the removed winners, and it names HIMS, CLS, and SMCI whether or not they appear.

A large stock loss is a stock engine position P&L less than or equal to −$60. The count and the sum are stored for the variant. ETF losses are not in that count.

The pass rule is the round-7 rule, on the engine account total, and only for the 8% row. Below 100 trades the window is a hold before a loss can fail. Otherwise the engine total must be positive. `n < N` is a hold even when the ratio or the bootstrap bound fails. A negative total with at least 100 trades fails. The ratio is the engine total divided by the engine max drawdown, and it must be strictly above the SPY ratio. The bootstrap one-sided 98% lower bound of the mean trade must be above zero. The bootstrap is 10,000 draws, seed 20261003, q = 0.02, z = 2.05. `N = (2.05 × sd / mean)²`. `n` and the mean are stock positions plus ETF positions, in engine dollars. SPY is +$1,661.54 / $379.84 / 4.37 out of sample and +$982.45 / $582.25 / 1.69 in sample.

Judged cells are the 8% cap on the four point-in-time and ADV windows. The baseline is the comparator. It is stored and not judged. The 7% row, the 10% row, and the current list are not judged. One fail fails the 8% row. A hold keeps the 8% row a hold. Beating or missing the baseline is reported and is not a second gate. The $1.90 net is not the verdict. Because the 8% level was chosen from these windows, a pass would still be confirmatory-weak, and the report says so.

## Hypotheses

These were written before the run. They are not the pass rule.

Skipping a stock whose signal ATR14 is more than X percent of the signal close should cut the count and the sum of stock losses at or below −$60. Account P&L is not assumed to rise. The dropped trades include high-ATR winners. The cash they would have used can fill a different later stock and can fill extra SOXX trades. Those replacements are part of the result.

The ATR the gate uses is a level known on the signal day. It is not the later loss. A high ATR percent is a wide recent range, not proof that the trade will lose.

## Selection

The 8% level was not chosen inside this file by a fresh search. It was supplied as a post-hoc cut from the round-10 baseline trades on these same windows. The 7% and 10% rows are the two neighbors, stored so a reader can see whether the 8% cell is a spike. They are not a search over other cuts, and they are not judged. Four judged cells is the whole test. The chance that one cell looks good by luck is non-trivial. The report states that.

Dropping high-ATR names can drop the large winners, including HIMS, CLS, and SMCI when those names were filled on the baseline. A smaller drawdown on the filled set can come from dropping those names. The filled-trade averages are not the result of the baseline trades with a different exit. Skipped capital that SOXX then uses is part of this filter. It is not a separate search over ETF rules.

## Published cells the baseline must match

Round-10 baseline, which is round-8 SOXX, E30, box exit, 20-day box, no regime filter, stock lot $300–$450. Account P&L, ETF P&L, ETF trades, stock trades, drawdown, joint-loss days, $1.90 total:

| Universe | 2022-10–2024-10 | 2024-10–2026-10 |
|---|---|---|
| current list | +$2,174.12, ETF +$371.05, 29 / 245, DD $639.82, 79, $1.90 +$1,855.86 | +$949.29, ETF +$293.12, 23 / 265, DD $918.14, 66, $1.90 +$617.01 |
| point-in-time | +$670.37, ETF +$334.61, 30 / 319, DD $646.89, 82, $1.90 +$261.36 | +$560.29, ETF +$258.05, 23 / 340, DD $954.41, 63, $1.90 +$129.58 |
| ADV top 200 | +$1,105.85, ETF +$351.20, 29 / 236, DD $621.54, 78, $1.90 +$799.74 | +$1,069.65, ETF +$364.60, 23 / 261, DD $804.17, 60, $1.90 +$735.84 |
