# Round 10 — stop-distance stock sizing — pre-registration

Locked before any round-10 run. A change to the text below is a new study, not a silent edit. Analysis only. Live alerts, the frozen paper-test rules, and `data/watchlist.yaml` are not part of this file.

Results must cite the commit that added this file. The baseline row must reproduce the published round-9 `F-off` cells for C plus idle-cash SOXX, entry E30, box exit, 20-day box. A mismatch of account P&L, max mark-to-market drawdown, ETF P&L, stock trade count, ETF trade count, joint-loss days, or the $1.90 total stops the run.

## What stays

The book is round-8 `C+SOXX` with entry E30, the box exit, and a 20-day box, with no regime filter. That is round-9 `F-off` on base `SOXX`. The sleeve rules are the round-8 pre-registration at `4235eface3528f5e1ca4a13e1cf1d0a75742a1f5`, the ATR amendment at `52b73ed249d46e5d3af26d61c1148af5e83397a5`, and the entry amendment at `54dcc909b06c22fe7e1a0c36be8aa334ee910eda`. The stock exit is round-7 C, locked at `d5864cd146d28a9c47faee2aea9d0dc5db3aa3ac`, on the round-4 base plus F1-include-unknown plus F2, locked at `1c2da22ba844c94ece16595262deddf5c606fbfb`.

E30 is a close strictly above the box low and at or below the 30% line, with no previous-close check. The 30% line is the box low + 0.30 × (box high − box low), rounded to 4 decimals. The box exit is the box low and the box high. The entry open must stay strictly inside the signal box. One ETF at a time. Stock signals win. Preemption, settlement, the 35% stock gap void, and the next-open fill stay as locked. The void is not applied to SOXX.

Capital is $3,200. At most five stock positions, at most two in the round-4 semiconductor class, one position per ticker. Rank is 20-session excess return, then ticker A–Z. Sale proceeds settle on the next session, except a preemption, which settles immediately.

The SOXX lot is unchanged. It is `min(floor(32 / (entry − box low)), floor(idle cash / entry))`. Idle cash is settled cash after that session's stock entries. Zero shares skips the ETF entry. No fractional shares. The $32 is the locked 1% of $3,200. This round does not resize SOXX.

Windows: 2022-10-03 through 2024-10-02, and 2024-10-03 through the last SPY session on or before 2026-10-02. Judged cells are point-in-time S&P 500+400 and ADV top 200, both windows. The current list is stored and not judged. The current-list signal close cap of $550 stays. Point-in-time and ADV do not use that cap.

## Fee

The engine still charges $0.70 on each stock sell and each ETF sell, and nothing on the buy. That is the locked round-8 charge. It is not $0.70 on the buy and again on the sell.

The reported net adds every engine $0.70 sell charge back and subtracts $1.90 once per stock position and once per ETF position. A position that sells in one fill is one $1.90. This is the series round-trip restatement. The request's "$1.90 per side" is this one charge per position. It is not $1.90 on the buy and another $1.90 on the sell. The net is what the report leads with. It is not the verdict. The drawdown path is the engine path, with the $0.70 sells.

## What changes

Only the individual-stock share count changes, and only on the two risk rows. The baseline keeps `sharesForBudget`, $300 to $450.

The 20-session low is the signal session's `low20`. That is the stock stop on exit C. It is known on the signal close. The entry is the next session's open. Distance is `entry − low20`, with no rounding.

`R` is a fixed dollar budget. It is not a percent of the running equity. The two values, chosen before the run, are $30 and $35. No other value is tried. $30 is just under 1% of the $3,200 start. $35 is the second pre-chosen budget.

For a stock candidate that is not voided and whose entry date is inside the window:

- Distance ≤ 0, including an entry equal to the low: skip. Reason `flat`. This count is separate from every other skip.
- Distance > 0 and `floor(R / distance) < 1`: skip. Reason `wide`. One share would lose more than `R` at the low. Distance equal to `R` is allowed, because `floor(R / R)` is 1.
- `floor(R / distance) ≥ 1` and `floor(500 / entry) < 1`: skip. Reason `cap`. One share would cost more than $500. Entry equal to $500 is allowed.
- Otherwise the share count is `min(floor(R / distance), floor(500 / entry))`. Floor means round toward zero. There is no $300 minimum. There is no $450 cap on these rows. The $500 cap is notional. It reduces the count so that `shares × entry ≤ 500`. It is not a cash test.

Exit C is replanned at that share count. The C path does not depend on the count: one full exit, stop first. A name the $300–$450 lot would refuse still gets this exit when the risk row gives it a count of at least 1.

The walk can still refuse a sized name. Those counters stay the engine's, and they are not sizing skips:

- `slot`: the five-position cap, or the throttled cap, is full.
- `cash`: settled cash cannot pay for the shares. The $500 cap does not look at cash.
- `semi`: the name is in the round-4 semiconductor class and two such names are already open.

A second signal in a ticker that is already open is dropped by the walk and has no counter of its own.

The baseline skip `budget` is `sharesForBudget(entry, 300, 450)` returning null: the open is above $450, or the largest whole lot that costs at most $450 costs under $300. Baseline names are not classified as `flat`, `wide`, or `cap`.

Sizing counts are taken on the candidate set before the walk. Each risk-row candidate in that set has exactly one of `flat`, `wide`, `cap`, or a share count. Voided names are excluded before that classification, as they are on the baseline.

## Scoring

A stock position is one trade. An ETF position is one trade. Account P&L is ending equity minus $3,200. Max drawdown is the peak-to-trough of engine equity marked at each close. The stored drawdown is that engine figure. The peak date, peak equity, trough date, and trough equity are read from the cent-rounded daily path. When those two cents do not subtract to the engine figure, both numbers are stored.

The lowest equity is the minimum cent-rounded close mark in the window, with its date, and the difference from $3,200.

The win rate, the average win, and the average loss use stock positions and ETF positions together. A win is P&L strictly above zero. A flat position is in the trade count and in neither average. The averages use the engine P&L.

The largest single-trade loss is the minimum engine position P&L among stock fills and ETF fills.

A stock loss exceeds `R` on a gap-down when all of these hold: the engine position P&L is strictly less than `−R`, the exit reason is the stop, and the exit session's open is strictly below the signal `low20`. The C rule sells that open. The stored sizes are those engine position P&Ls, in cents. A close that finishes below the low while the open was at or above the low is not this count, even when the loss exceeds `R` because the close ran through or because the $0.70 fee pushed a full-risk stop a few cents past `R`. Those other exceedances are stored as their own count and their own sizes. They are not the gap count. ETF losses are not in either count. The baseline has no `R`, so it does not store either count.

Capital deployed is the average, over the window's sessions, of stock market value at the close plus ETF market value at the close, divided by $3,200. The two sleeve averages are stored as well. Their sum is this figure.

The pass rule is the round-7 rule, on the engine account total. Below 100 trades the window is a hold before a loss can fail. Otherwise the engine total must be positive. `n < N` is a hold even when the ratio or the bootstrap bound fails. A negative total with at least 100 trades fails. The ratio is the engine total divided by the engine max drawdown, and it must be strictly above the SPY ratio. The bootstrap one-sided 98% lower bound of the mean trade must be above zero. The bootstrap is 10,000 draws, seed 20261003, q = 0.02, z = 2.05. `N = (2.05 × sd / mean)²`. `n` and the mean are stock positions plus ETF positions, in engine dollars. SPY is +$1,661.54 / $379.84 / 4.37 out of sample and +$982.45 / $582.25 / 1.69 in sample.

Judged rows are `R30` and `R35`, on the four point-in-time and ADV cells. The baseline is the comparator. It is stored and not judged. The current list is not judged. One fail fails the row. A hold keeps the row a hold. Beating or missing the baseline is reported and is not a second gate.

## Hypotheses

These were written before the run. They are not the pass rule.

The share count is set so that a stop filled at the signal low loses at most `R` before the $0.70 fee, unless the open gaps through that low or the $500 cap cut the count. The largest stock loss and the account drawdown should therefore sit closer to `R` than on the $300–$450 book, except for those gaps.

Account P&L is not assumed to rise. The same dollar buys more shares when the low is close to the entry, and it buys none when one share risks more than `R`.

## Selection

Stop-distance sizing favors names whose entry open is close to the 20-session low. A tight range gets more shares. A wide range is skipped once one share would lose more than `R`. The skipped wide-range trades can be the large winners. A higher win rate, a smaller average loss, or a smaller drawdown on the filled set can come from dropping those names, rather than from resizing the same trades. The report states that. The filled-trade averages are not the result of the baseline trades at a different size.

`R30` and `R35` were chosen before the run. No other budget, no other notional cap, and no other stop are tried. Two variants times four judged cells is eight verdicts. The chance that one cell looks good by luck is non-trivial. The report states that.

## Published cells the baseline must match

Round-8 SOXX, E30, box exit, 20-day box, no regime filter. Account P&L, ETF P&L, ETF trades, stock trades, drawdown, joint-loss days, $1.90 total:

| Universe | 2022-10–2024-10 | 2024-10–2026-10 |
|---|---|---|
| current list | +$2,174.12, ETF +$371.05, 29 / 245, DD $639.82, 79, $1.90 +$1,855.86 | +$949.29, ETF +$293.12, 23 / 265, DD $918.14, 66, $1.90 +$617.01 |
| point-in-time | +$670.37, ETF +$334.61, 30 / 319, DD $646.89, 82, $1.90 +$261.36 | +$560.29, ETF +$258.05, 23 / 340, DD $954.41, 63, $1.90 +$129.58 |
| ADV top 200 | +$1,105.85, ETF +$351.20, 29 / 236, DD $621.54, 78, $1.90 +$799.74 | +$1,069.65, ETF +$364.60, 23 / 261, DD $804.17, 60, $1.90 +$735.84 |
