# Round 5 — semiconductor and adjacent book — pre-registration

Locked before any round-5 run. A change to the text below is a new study, not a silent edit. Analysis only. Live alerts and the frozen paper-test rules are not part of this file.

Results must cite the commit that added this file. The baseline cells must reproduce the published round-4 book below. A mismatch stops the study. It is not a new result.

## What this book is

Round 5 is one new book on a subset of the existing universes. It keeps the round-4 base entry, the round-4 F1-include-unknown rule, and the round-4 F2 rule. It changes the universe, the share-size rule, and the stop. It does not change live alerts or the paper rules.

The comparison baselines are:

- Round-4 base plus F1-include-unknown plus F2, locked at `1c2da22ba844c94ece16595262deddf5c606fbfb`.
- SPY buy-and-hold with the same $0.70 sell fee, the published totals below.

## Baseline reproduction

These cells are the published round-4 base `F1iF2` book. The study stops if a cell differs.

| Universe | 2022-10–2024-10 | 2024-10–2026-10 |
|---|---|---|
| current list | +$1,581.13 on 350 | +$1,105.45 on 375 |
| point-in-time | +$135.08 on 373 | +$10.16 on 381 |
| ADV top 200 | +$879.27 on 346 | +$277.96 on 381 |

## SPY benchmark

Pass and fail use the published $0.70 SPY buy-and-hold:

- 2022-10 through 2024-10: total +$1,661.54, mark-to-market drawdown $379.84, ratio 4.37.
- 2024-10 through 2026-10: total +$982.45, mark-to-market drawdown $582.25, ratio 1.69.

The strategy ratio is total P&L divided by maximum mark-to-market drawdown, rounded to cents. A zero drawdown fails the ratio test. The comparison is strict.

## Universe

Each existing universe is cut down to the semiconductor class defined here. The membership rule of the universe does not change. Only the names inside it change.

- Current list: the watchlist, with ONDS ignored, the same way the other studies ignore it. The round-4 current-list signal-close cap of $550 is not used.
- Point-in-time: S&P 500 union S&P 400 as of the first session of the window, the same `membershipAsOf` rule as round 4. A name that joins after that date is not in that window.
- ADV top 200: the same bar pool and the same 63-session average dollar-volume rank as round 4. A name is eligible on a signal date only when it is in that date's top 200. The pool is not the whole US market.

Windows: 2022-10-03 through 2024-10-02, and 2024-10-03 through the last SPY session on or before 2026-10-02.

### Class rule

A ticker is in the class when any of these is true. AKAM is never in the class.

1. Watchlist group `semi` or `equipment`.
2. Watchlist group `network`, `server`, or `power`, except AKAM.
3. Current Wikipedia GICS sub-industry is exactly `Semiconductors` or `Semiconductor Materials & Equipment`. S&P 500 overwrites S&P 400 when a ticker is on both. This GICS text is the current table, not the sub-industry on the signal date. A former member with no current row does not match rule 3.

Rule 1 is semiconductors and semiconductor equipment, including watchlist names with no current GICS row. SNDK is in `semi`, so it is in the class even though its current GICS sub-industry is `Technology Hardware, Storage & Peripherals`.

Rule 2 is the adjacent hardware already grouped on the watchlist: optical and photonics networking (`network`), server, storage, and connector hardware (`server`), and power and cooling hardware (`power`). The whole group is kept. That includes CSCO, NOK, PWR, EME, TT, and GEV, because they sit in those groups. AKAM is out: its group is `network`, and its GICS sub-industry is `Internet Services & Infrastructure`.

These groups are not in the class: `cloud`, `generation`, and every other watchlist group. Power producers, GPU-cloud operators, and application software are not added by a GICS sweep. `BE` stays out even though its GICS sub-industry is `Electrical Components & Equipment`.

Rule 3 adds index names the watchlist does not list. FSLR is in, because the current table files it under `Semiconductors`. No later pass removes solar, display, or analog names that the table files under those two strings.

The two-semiconductor slot cap from the base engine is not applied. That cap limits semiconductors inside a mixed book. This book is the semiconductor class, and the cap would leave two slots. Round 5 keeps five slots and one position per ticker. This is a stated change.

### Trade-count flag

The class is small next to the full books, which produced about 350 trades from about 900 names. Counted from the cached tables and the watchlist at this commit, with a name kept only when at least 30 daily bars are cached:

- Current list: 69 names.
- Point-in-time on 2022-10-03: 47 names. On 2024-10-03: 52 names. None of the class members on those dates lacked bars.
- ADV top 200, names that appear at least once: 30 in the first window, 47 in the second.

A judged window can finish under 100 trades. Under 100 trades the window is a hold, and a non-positive total does not turn that hold into a fail.

### Tickers

Sorted A–Z.

Current list (69): AAOI, ADI, AEHR, ALAB, AMD, AMKR, ANET, APH, ARM, ASML, ASX, AVGO, CAMT, CIEN, CLS, COHR, CRDO, CSCO, DELL, EME, ENTG, ETN, FN, FORM, GEV, GFS, GLW, HPE, HUBB, INTC, JBL, KLAC, LITE, LRCX, LSCC, MCHP, MOD, MPWR, MRVL, MTSI, MU, NOK, NTAP, NVDA, NVMI, NVTS, NXPI, ON, ONTO, POET, POWI, POWL, PWR, QCOM, RMBS, SITM, SMCI, SNDK, STM, STX, SWKS, TEL, TER, TSM, TT, TXN, VIAV, VRT, WDC.

Point-in-time on 2022-10-03 (47): ADI, AMAT, AMD, AMKR, ANET, APH, AVGO, CIEN, COHR, CRUS, CSCO, EME, ETN, FSLR, GLW, HPE, HUBB, INTC, JBL, KLAC, LITE, LRCX, LSCC, MCHP, MKSI, MPWR, MTSI, MU, NTAP, NVDA, NXPI, OLED, ON, POWI, PWR, QCOM, SITM, SLAB, SMTC, STX, SWKS, SYNA, TEL, TER, TT, TXN, WDC.

Point-in-time on 2024-10-03 (52): ADI, ALGM, AMAT, AMD, AMKR, ANET, APH, AVGO, CIEN, COHR, CRUS, CSCO, DELL, EME, ETN, FN, FSLR, GEV, GLW, HPE, HUBB, INTC, JBL, KLAC, LITE, LRCX, LSCC, MCHP, MKSI, MPWR, MTSI, MU, NTAP, NVDA, NXPI, OLED, ON, ONTO, POWI, PWR, QCOM, RMBS, SLAB, SMCI, STX, SWKS, SYNA, TEL, TER, TT, TXN, WDC.

ADV top 200, first window (30): ADI, AMAT, AMD, ANET, APH, ARM, ASML, AVGO, CSCO, DELL, ETN, FSLR, GEV, INTC, KLAC, LRCX, MCHP, MPWR, MRVL, MU, NVDA, NXPI, ON, QCOM, SMCI, TSM, TT, TXN, VRT, WDC.

ADV top 200, second window (47): AAOI, ADI, ALAB, AMAT, AMD, ANET, APH, ARM, ASML, AVGO, CIEN, CLS, COHR, CRDO, CSCO, DELL, ETN, FN, FSLR, GEV, GLW, HPE, INTC, KLAC, LITE, LRCX, MCHP, MPWR, MRVL, MU, NOK, NVDA, NVTS, NXPI, ON, PWR, QCOM, SMCI, SNDK, STM, STX, TER, TSM, TT, TXN, VRT, WDC.

The study recomputes these sets from `data/watchlist.yaml`, the cached Wikipedia tables, and the cached bars. A different set stops the study.

## Entry and exit

The entry is the round-4 base box, not a new 15% formula.

- Rebound of at least 1 day. Signal close at or above the 15% line of the 20-session box.
- ATR% at least 3 on the signal session.
- No earnings block.
- Target is the entry open plus 1 × the signal ATR14. Maximum hold is 20 sessions.
- After the entry session, an open below the stop fills at that open. A close below the stop fills at that close. A target can fill on the entry session when the high reaches it. The entry session does not fill a target or a stop at the open.
- A 35% close-to-close gap from the entry session through the session that flattens the last share voids the trade. A voided trade does not enter and is not counted.
- One position per ticker. No second buy while the ticker is open. No scale-out and no partial exit. The whole position leaves on the one exit.
- At most five positions. Capital $3,200. No fractional shares. Sale proceeds are available on the next session. The charge is $0.70 once on each sell fill, and nothing on the buy.
- When more than one new buy is possible on the same open, rank by 20-session return minus SPY's 20-session return, descending. A missing rank sorts last. Ticker A–Z breaks ties.
- A position still open on the last session of the window is sold at that close.

### Stops

- S0: the signal session's 20-session low.
- S1: that low minus 1 × that session's ATR14.

S0 and S1 are separate rows. They are not mixed inside one portfolio.

## Share size

The base engine's lot is `sharesForBudget`: the share count whose cost falls in $300 to $450. Round 5 does not use that band. There is no $300 minimum.

The round-5 count is `floor($32 / (entry − stop))`. Distance ≤ 0, distance > $32, or a count below 1 skips the name. Distance > $32 is the rule that one share must not risk more than $32.

The $450 notional cap is part of the round-3 risk sizer, and it is applied on the judged rows. It is not the base engine's $300–$450 band. Judged size is the round-3 `riskShares` function: `min(floor($32 / distance), floor($450 / entry))`, and an entry above $450 skips the name.

Each judged row also has an uncapped reference row. That row uses `floor($32 / distance)` only, with the same distance skips, and no $450 cap. The portfolio still skips an order whose cost is above the cash settled that morning. That is the cash limit. There is no other per-name notional cap on the reference row.

A size skip, a cash skip, and a full-book skip are inside the engine. The engine walks on to the next ranked name. Those skips are not the filter in the next section.

## F1i, F2, and empty slots

F1i and F2 are the round-4 rules at `1c2da22ba844c94ece16595262deddf5c606fbfb`. This file does not rewrite them.

- F1i skips a candidate whose trailing four-quarter GAAP TTM is strictly below zero. Unknown is traded. The cutoff is the signal date.
- F2 skips a candidate whose entry open is strictly above the signal session's 20-session high. Equality is allowed. A missing high skips the candidate.

Facts come from the slim EDGAR cache written for round 4. A CIK with no slim file is unknown. This study does not send a new EDGAR request.

The filter is applied after selection, not before it.

1. Build the candidates for that stop on the class subset of the universe.
2. Run the portfolio with no F1i and no F2. This is the unfiltered engine.
3. Drop a fill that F1i would skip or that F2 would skip. The dropped fill is not replaced. A name the first run did not take does not enter.
4. Run the portfolio again with only the kept fills as candidates. Nothing else is eligible.
5. If the second run's trade count is not the kept fill count, the study stops.

The reported P&L, drawdown, and invested fraction are the second run.

## Rows

Each row is one stop, one cap, one universe, and one window.

Judged rows are S0 and S1 with the $450 cap, on the point-in-time book and the ADV book only.

Stored and not judged:

- S0 and S1 with the $450 cap, on the current list.
- S0 and S1 with no $450 cap, on every universe.

S0 and S1 are judged separately. The uncapped rows are not an input to a verdict.

## What is reported

For each row, on the second-run fills:

- Verdict.
- Total P&L: end equity minus $3,200.
- Maximum mark-to-market drawdown.
- Win rate: share of filled trades with P&L > 0.
- Average win and average loss. A loss stays negative.
- Trade count.
- Invested fraction, the same cash-ratio definition as round 3.
- Scaled SPY: the full SPY total for that window multiplied by the invested fraction. This column is not used for pass, fail, or hold.
- Per ticker, the sum of that row's fill P&L. The five largest sums and the five smallest sums, with the ticker. Fewer than five tickers lists every ticker. Ties break by ticker A–Z.

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

Universe verdict, from that universe's two windows: fail if either window fails; otherwise hold if either window is a hold; otherwise pass. Overall verdict, from the four point-in-time and ADV windows of that stop's capped rows: the same rule. Current-list windows and uncapped windows are not an input.
