# Round 6 — exclude semiconductors and adjacent names — pre-registration

Locked before any round-6 run. A change to the text below is a new study, not a silent edit. Analysis only. Live alerts and the frozen paper-test rules are not part of this file.

Results must cite the commit that added this file. The baseline cells must reproduce the published round-4 book below. A mismatch stops the study. It is not a new result.

## Book

Round-4 base plus F1-include-unknown plus F2, locked at `1c2da22ba844c94ece16595262deddf5c606fbfb`, with the round-5 semiconductor-and-adjacent class removed after selection.

The class is exactly the one locked at `d35eaff2120c385f57c561fddb05204d545a280e` in `docs/ROUND5_PREREG.md`. This file does not rewrite it. A ticker is excluded when `inRound5Class` is true: watchlist group `semi` or `equipment`, or watchlist group `network`, `server`, or `power` except AKAM, or current Wikipedia GICS sub-industry exactly `Semiconductors` or `Semiconductor Materials & Equipment`. S&P 500 overwrites S&P 400. AKAM stays in the book.

The study recomputes the five round-5 lists (current list, point-in-time on each window date, ADV top 200 in each window). A different list stops the study.

## Baseline

The comparison book is round-4 base `F1iF2` with semiconductors still eligible. Filters in that book are applied before the portfolio, which is how round 4 was run. Round 6 does not use that order. The cells below are reproduced by that round-4 order. The study stops if a cell differs.

| Universe | 2022-10–2024-10 | 2024-10–2026-10 |
|---|---|---|
| current list | +$1,581.13 on 350 | +$1,105.45 on 375 |
| point-in-time | +$135.08 on 373 | +$10.16 on 381 |
| ADV top 200 | +$879.27 on 346 | +$277.96 on 381 |

SPY buy-and-hold with the same $0.70 sell fee:

- 2022-10 through 2024-10: total +$1,661.54, mark-to-market drawdown $379.84, ratio 4.37.
- 2024-10 through 2026-10: total +$982.45, mark-to-market drawdown $582.25, ratio 1.69.

The strategy ratio is total P&L divided by maximum mark-to-market drawdown, rounded to cents. A zero drawdown fails the ratio test. The comparison is strict. Scaled SPY is the full SPY total for that window multiplied by the invested fraction. Scaled SPY is not used for pass, fail, or hold.

## What the unfiltered run is

The unfiltered run is the round-4 base engine before F1i, before F2, and before the round-5 exclusion.

- Rebound of at least 1 day. Signal close at or above the 15% line of the 20-session box. ATR% at least 3. No earnings block.
- Stop is the signal session's 20-session low. Target is the entry open + 1 × the signal ATR14. Maximum hold is 20 sessions. Gap-through stop, as in round 4. A 35% close-to-close gap voids the trade.
- At most five positions. One position per ticker. No scale-out. Capital $3,200. Sale proceeds are available on the next session. The charge is $0.70 once on each sell fill.
- At most two open names in the round-4 semiconductor cap. That cap is not the round-5 class. On the current list it is watchlist group `semi` or `equipment`. On the point-in-time book and the ADV book it is a current GICS sub-industry whose name contains "semiconductor". A name with no GICS row is not in that cap. Adjacent names in the round-5 class can still be selected here. They are dropped in the next section.
- Rank by 20-session return minus SPY's 20-session return, descending. A missing rank sorts last. Ticker A–Z breaks ties.
- Current-list signal close ≤ $550. The point-in-time book and the ADV book have no $550 cap.
- Windows and membership are the round-4 windows and the round-4 membership. Point-in-time membership is as of the first session of the window. ADV is that signal date's top 200. Benchmark and sector ETFs are not names in that top 200.

A size skip, a cash skip, a full-book skip, and a round-4 semiconductor-cap skip stay inside this run. The engine walks on to the next ranked name. Those skips are not the drops in the next section.

## Drops, without backfill

From the unfiltered fills, drop a fill when any of these is true:

- The ticker is in the round-5 class.
- F1i would skip it: trailing four-quarter GAAP TTM strictly below zero. Unknown is kept. The cutoff is the signal date. Facts come from the slim EDGAR cache. A CIK with no slim file is unknown. This study does not send a new EDGAR request.
- F2 would skip it: the entry open is strictly above the signal session's 20-session high. Equality is kept. A missing high is a skip.

A fill that matches more than one of these is dropped once. Nothing replaces it. A name the unfiltered run did not take does not enter.

The reported book is a second portfolio run whose only candidates are the kept fills. The second run can refuse a kept fill when the order costs more than the cash settled that morning. That refusal is recorded as the unfunded count. A refusal for a full book, a price rule, or a duplicated candidate stops the study.

The reported P&L, drawdown, invested fraction, and ticker sums are the second run.

The semi-drop tally is not the second run. It is the count and the sum of unfiltered-fill P&L for fills whose ticker is in the round-5 class, including a class fill that also fails F1i or F2. An F1i or F2 drop that is not in the class is removed from the book and is not in this tally.

## Share size

The judged row uses the base lot: `sharesForBudget`, whole shares whose cost is from $300 to $450 inclusive. A name that does not fit is skipped. There is no separate $32 risk budget on the judged row.

The reference row is the same book with round-3 `riskShares`: `min(floor($32 / (entry − stop)), floor($450 / entry))`. Distance ≤ 0, distance > $32, entry > $450, or a count below 1 skips the name. $32 is 1% of the $3,200 account. The stop stays the 20-session low. The $300 minimum is not used. The reference row is stored on every universe and is not judged.

## Rows

Judged rows are the $300–$450 lot on the point-in-time book and the ADV book only.

Stored and not judged:

- The $300–$450 lot on the current list.
- The 1% risk row on the current list, the point-in-time book, and the ADV book.

## What is reported

For each round-6 row, on the second-run fills:

- Verdict.
- Total P&L: end equity minus $3,200.
- Maximum mark-to-market drawdown.
- Win rate: share of filled trades with P&L > 0.
- Average win and average loss. A loss stays negative.
- Trade count.
- Invested fraction, the same cash-ratio definition as round 3.
- Scaled SPY.
- Per ticker, the sum of that row's fill P&L. The five largest sums and the five smallest sums. Fewer than five tickers lists every ticker. Ties break by ticker A–Z.
- Delta: this row's total minus the reproduced round-4 `F1iF2` total on the same universe and window, in dollars, rounded to cents. The delta is not the semi-drop sum. The round-4 book admits replacement trades. This book does not.
- Semi-drop count and the sum of those fills' unfiltered P&L, as defined above.
- Unfunded count.

## Pass, fail, and hold

Judged rows only. The order is the round-3 order, including the 100-trade hold.

Per judged window. The bootstrap is round 3's: 10,000 resamples with replacement, seed `20261003`, `mulberry32`, one-sided 98% so `q = 0.02` and `z = 2.05`. The lower bound is the nearest-rank index `ceil(0.02 × 10000) − 1`. `N = (2.05 × sd / mean)²` with `sd` the sample standard deviation using `n − 1`.

1. Trade count below 100 is a hold. The window is not judged further. A non-positive total does not turn that hold into a fail.
2. Otherwise the round-3 window rule:
   - `n < 2`, or the lower bound is null: hold.
   - Total ≤ 0: fail.
   - Total > 0 and `n < N`: hold, even when the ratio or the lower bound fails.
   - Total > 0, `n ≥ N`, and the ratio is not strictly above the SPY ratio or the lower bound is not above 0: fail.
   - Total > 0, `n ≥ N`, ratio strictly above the SPY ratio, and lower bound above 0: pass.

Universe verdict, from that universe's two windows: fail if either window fails; otherwise hold if either window is a hold; otherwise pass. Overall verdict, from the four point-in-time and ADV windows of the $300–$450 lot: the same rule. Current-list windows and 1% risk windows are not an input.
