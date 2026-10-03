# Round 4 — loss-maker and box-top filters — pre-registration

Locked before any round-4 run. A change to the text below is a new study, not a silent edit. Analysis only. Live alerts and the frozen paper-test rules are not part of this file.

Results must cite the commit that added this file. The baseline rows must reproduce the published books below. A mismatch stops the study. It is not a new result.

## Books

Two baselines. Filters are applied on top of each one. They do not change the stop, the target, the hold, the fee, the share-size rule, the rank, or the earnings rule of that baseline.

### base

The PR #20 box-low book.

- Rebound of at least 1 day. Signal close at or above the 15% line of the 20-session box.
- ATR% at least 3.
- No earnings block.
- Stop is the signal session's 20-session low. Target is the entry open + 1 × the signal ATR14. Maximum hold is 20 sessions.
- After the entry session, an open below the stop fills at that open. A close below the stop fills at that close. A target can fill on the entry session when the high reaches it. The entry session does not fill a target or a stop at the open.
- Size is `sharesForBudget`: whole shares whose cost is from $300 to $450 inclusive. A name that does not fit is skipped.
- Current-list signal close ≤ $550. The entry open is not given a second $550 cap. The point-in-time book and the ADV book have no $550 cap.

### R1

The round-3 row locked at `65bd4a01312cad804a4cbcb302d8c18eb1d2788a`.

- The same box, ATR%, hold, target, gap-through, and universe rules as round 3.
- E1 earnings block on every R1 row, including every filtered row. Drop a new buy whose entry session is 1, 2, 3, 4, or 5 sessions before an earnings reaction day. The reaction day itself is allowed.
- Stop, for every name, is the signal session's 20-session low minus 1.5 × that session's ATR14.
- Shares = `min(floor(32 / distance), floor(450 / entry))` with the round-3 skip rules. Distance ≤ 0, distance > 32, entry > 450, or shares below 1 skips the name. There is no $300 minimum.

## Shared rules

- A 35% close-to-close gap from the entry session through the session that flattens the last share voids the trade. A voided trade does not enter and is not counted.
- At most five positions. At most two open names in the semiconductor class. One position per ticker.
- Semiconductor class: on the current list, watchlist group `semi` or `equipment`. On the point-in-time book and the ADV book, a current GICS sub-industry whose name contains "semiconductor". A name with no GICS row is not in the class.
- Capital $3,200. No fractional shares. Sale proceeds are available on the next session. The charge is $0.70 once on each sell fill, and nothing on the buy.
- When more than one new buy is possible on the same open, rank by 20-session return minus SPY's 20-session return, descending. A missing rank sorts last. Ticker A–Z breaks ties.
- Windows: 2022-10-03 through 2024-10-02, and 2024-10-03 through the last SPY session on or before 2026-10-02.
- Current list: the watchlist names. ONDS is ignored. Point-in-time S&P 500 union S&P 400, and the ADV top 200, use the same membership, bar pool, and 63-day dollar-volume rank as the round-3 script. The ADV pool is not the whole US market.
- Filters remove candidates before the portfolio runs. They do not resize a trade that still qualifies.

## Baseline reproduction

These cells are the published books. The study stops if a baseline cell differs.

| Book | Universe | 2022-10–2024-10 | 2024-10–2026-10 |
|---|---|---|---|
| base | current list | +$1,172.36 on 378 | +$1,304.86 on 382 |
| base | point-in-time | −$401.68 on 348 | +$451.15 on 345 |
| base | ADV top 200 | +$1,475.92 on 376 | +$120.83 on 367 |
| R1 | current list | +$174.44 on 276 | +$599.94 on 293 |
| R1 | point-in-time | −$127.88 on 267 | +$62.67 on 305 |
| R1 | ADV top 200 | +$518.88 on 281 | +$227.61 on 281 |

## F1 — no loss-makers

Skip a candidate when its trailing four-quarter GAAP net income is strictly below zero. Zero is allowed. The test uses that candidate's signal date. A filing dated on the entry session is not visible, because the cutoff is the signal date.

### Source

SEC EDGAR companyfacts, `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json`.

CIKs come from the cached `company_tickers.json` current map. The lookup tries the ticker, then dot/dash swaps. There is no point-in-time CIK. A ticker with no CIK is unknown.

Requests use `SEC_USER_AGENT` and the existing EDGAR client, at most 5 requests per second, which is inside the 10-per-second cap. The contact email is not written into the repo. A response larger than 40,000,000 bytes, a 404, or a request that still fails after 3 tries makes that CIK unknown. The study caches only the three USD concept arrays under `data/.cache/`, which is not committed.

### Concept order

For each candidate, try these `us-gaap` concepts in order and use the first one that produces a TTM on that signal date. Do not mix concepts inside one TTM.

1. `NetIncomeLoss`
2. `ProfitLoss`
3. `NetIncomeLossAvailableToCommonStockholdersBasic`

`ifrs-full` is not used. Units other than `USD` are not used. The `frame` and `fp` fields are ignored.

### Facts that count

Keep a fact only when all of these hold:

- `form` is `10-Q`, `10-Q/A`, `10-K`, or `10-K/A`. This drops `8-K`, `20-F`, `20-F/A`, `40-F`, and `6-K`. TSM, STM, and ASX stay unknown on this rule.
- `filed` is a `YYYY-MM-DD` date on or before the signal date.
- `start` and `end` are dates and `end` is after `start`.
- `val` is a finite number.
- Duration is `end` minus `start` in calendar days, not adding one.

A fact is quarterly when its duration is from 80 through 105 days. A fact is annual when its duration is from 330 through 380 days. Year-to-date facts in between are ignored.

For one concept, deduplicate by `start|end`. Keep the fact with the latest `filed` date that is still on or before the signal date. A tied `filed` keeps the greater `accn`.

### Q4

Many 10-K filings report the year and not a separate fourth quarter. For each annual fact ending on `E` and starting on `S`:

- If any quarterly fact ends on `E`, do not derive a quarter for that year.
- Otherwise take quarterly facts with `start >= S` and `end < E`.
- Derive a fourth quarter only when those facts are exactly three, they do not overlap (`next.start >= prev.end`), each later start is at most 5 calendar days after the previous end, and the earliest start is on `S` or within 7 calendar days after `S`.
- The derived value is the annual value minus the three quarterly values. Its end is `E`. Its start is the day after the third quarter's end. Its `filed` date is the latest `filed` date among the annual fact and the three quarters.

### TTM

Take reported quarterly facts plus derived fourth quarters. Keep those with `end` on or before the signal date. Sort by `end` descending and take four.

Those four must be contiguous: sorted by `end` ascending, each later start is on or after the previous end and at most 5 calendar days after it, and each later end is 80 to 110 calendar days after the previous end. The latest of the four ends must be within 200 calendar days before the signal date. If any of that fails, this concept did not produce a TTM.

The TTM is the sum of the four values. Strictly below zero skips the candidate.

### Unknown

A candidate is unknown when no concept produces a TTM. That covers a missing CIK, a non-USD filer, a 20-F filer, fewer than four quarters, a broken quarter sequence, and a stale sequence.

- `F1x` skips unknown candidates and skips TTM < 0.
- `F1i` trades unknown candidates and still skips TTM < 0.

## F2 — no buys above the box top

Skip a candidate when its entry open is strictly above the signal session's 20-session high. An entry equal to that high is allowed. A missing high skips the candidate.

## Rows

Each row is its own book. `base` and `R1` are baselines. They are stored on every universe and window and are not judged.

Judged rows, on the point-in-time book and the ADV book only:

- `F1x`, `F1i`, `F2`, `F1xF2`, `F1iF2`, each on `base` and on `R1`.

`F1xF2` skips a name that `F1x` skips or that `F2` skips. `F1iF2` skips a name that `F1i` skips or that `F2` skips. The current list is stored and marked not judged.

## Flow around the filter

Identity of a fill is ticker plus entry date.

For each filtered row, against that book's baseline on the same universe and window:

- Excluded-original: baseline fills that fail this row's filter. Count, and the sum of their baseline P&L.
- Newly-admitted: filtered fills whose identity is not in the baseline fills. Count, and the sum of their filtered P&L.
- Crowded-out: baseline fills that pass the filter and are absent from the filtered fills. Count, and the sum of their baseline P&L. This is the slot effect, kept separate from excluded-original.

Unknown tally, for every row of a book: among the baseline fills, the count and the sum of baseline P&L whose F1 status is unknown. On an `F1x` row, also the count and baseline P&L of those unknown fills, which are part of excluded-original.

## What is reported

For each row, universe, and window, on the trades the book filled:

- Total P&L: end equity minus $3,200.
- Trade count.
- Win rate: share of filled trades with P&L > 0.
- Average win and average loss, as in round 3. A loss stays negative.
- Worst filled-trade P&L.
- Maximum mark-to-market drawdown.
- Share of sessions whose mark-to-market equity is at least $10 above the prior session's equity.
- Profit factor.
- Expectancy in R: mean of P&L / initial risk, using filled shares × (entry − that row's stop). Non-positive risk is left out.
- Invested fraction, the same cash-ratio definition as round 3.
- Scaled SPY: the full SPY total for that window multiplied by the invested fraction. This column is not used for pass, fail, or hold.

Plus the flow counts above.

## SPY benchmark

Pass and fail use the published $0.70 SPY buy-and-hold:

- 2022-10 through 2024-10: total +$1,661.54, mark-to-market drawdown $379.84, ratio 4.37.
- 2024-10 through 2026-10: total +$982.45, mark-to-market drawdown $582.25, ratio 1.69.

The strategy ratio is total P&L divided by maximum mark-to-market drawdown, rounded to cents. A zero drawdown fails the ratio test. The comparison is strict.

## Pass, fail, and hold

Judged rows are the ten filter rows, on the point-in-time book and the ADV book only.

Per judged window, in this order. The bootstrap is round 3's: 10,000 resamples with replacement, seed `20261003`, `mulberry32`, one-sided 98% so `q = 0.02` and `z = 2.05`. The lower bound is the nearest-rank index `ceil(0.02 × 10000) − 1`. `N = (2.05 × sd / mean)²` with `sd` the sample standard deviation using `n − 1`.

1. Trade count below 100 is a hold. The window is not judged further. A non-positive total does not turn that hold into a fail.
2. Otherwise the round-3 window rule:
   - `n < 2`, or the lower bound is null: hold.
   - Total ≤ 0: fail.
   - Total > 0 and `n < N`: hold, even when the ratio or the lower bound fails.
   - Total > 0, `n ≥ N`, and the ratio is not strictly above the SPY ratio or the lower bound is not above 0: fail.
   - Total > 0, `n ≥ N`, ratio strictly above the SPY ratio, and lower bound above 0: pass.

Universe verdict, from that universe's two windows: fail if either window fails; otherwise hold if either window is a hold; otherwise pass. Overall verdict, from the four point-in-time and ADV windows of that row: the same rule. Current-list windows are not an input to either verdict.
