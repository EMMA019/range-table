# Round 9 — SPY regime filter — pre-registration

Locked before any round-9 run. A change to the text below is a new study, not a silent edit. Analysis only. Live alerts, the frozen paper-test rules, and `data/watchlist.yaml` are not part of this file.

Results must cite the commit that added this file. `F-off` on base `C` must reproduce the published round-7 C cells. `F-off` on base `SOXX` must reproduce the published round-8 cells for C plus idle-cash SOXX, entry E30, box exit, 20-day box. A mismatch of account P&L, max mark-to-market drawdown, ETF P&L, stock trade count, ETF trade count, joint-loss days, or the $1.90 total stops the run.

## What stays

Two bases. Everything that is not the filter stays on the locked book.

`C` is round-7 C, locked at `d5864cd146d28a9c47faee2aea9d0dc5db3aa3ac`, on the round-4 base plus F1-include-unknown plus F2, locked at `1c2da22ba844c94ece16595262deddf5c606fbfb`. No ETF.

`SOXX` is round-8 `C+SOXX` with entry E30, the box exit, and a 20-day box. The sleeve rules are the round-8 pre-registration at `4235eface3528f5e1ca4a13e1cf1d0a75742a1f5`, the ATR amendment at `52b73ed249d46e5d3af26d61c1148af5e83397a5`, and the entry amendment at `54dcc909b06c22fe7e1a0c36be8aa334ee910eda`. E30 is a close strictly above the box low and at or below the 30% line, with no previous-close check. The box exit is the box low and the box high. Size, stock priority, preemption, the $0.70 engine sell fee, the next-open fill, and the open-inside-box gate stay as locked.

The lot is still `sharesForBudget`, $300 to $450. Capital is $3,200. At most five stock positions, at most two in the round-4 semiconductor class, one position per ticker. Rank is 20-session excess return, then ticker A–Z. Sale proceeds settle on the next session, except a preemption, which settles immediately. The 35% gap void stays on stocks and is not applied to SOXX.

Windows: 2022-10-03 through 2024-10-02, and 2024-10-03 through the last SPY session on or before 2026-10-02. Judged cells are point-in-time S&P 500+400 and ADV top 200, both windows. The current list is stored and not judged. The current-list signal close cap of $550 stays.

The filter never closes a position that is already open. A stock stop, a stock target, a stock timeout, an ETF stop, an ETF target, an ETF timeout, a preemption, and a window flatten all stay in force on a below day.

## Regime

The clock is the SPY session list. `SMA20` on a session is the arithmetic mean of the 20 SPY closes ending on that session, including that close. The mean is not rounded. A session is below when its SPY close is strictly less than that mean. A close equal to the mean is not below. A session with fewer than 20 SPY closes through that session is not below. A signal date that is missing from the SPY calendar is not below.

The regime is the signal session's close. The fill is still the next session's open. For a stock, the signal session is the candidate's signal date. For SOXX, the signal session is the close that placed the order, which is the session before the entry open.

## Filters

Each filter is applied to candidates that already passed the base entry, the rebound of at least one day, F1-include-unknown, and F2. Dropped names are removed before the portfolio walk, so a later name in rank order can take the slot. F2 remains an entry open that is not strictly above the signal session's 20-session high.

The base stock band is `above15`: the signal close is at or above the 15% line, and there is no upper cap. The 15% line is the box low + 0.15 × (box high − box low), rounded to 4 decimals.

- `F-off` applies no regime filter.
- `F-stop` drops a stock candidate whose signal session is below. SOXX orders are unchanged.
- `F-strict` keeps the base rule on a session that is not below. On a below session it also requires the signal close to be at or above the 30% line of that same signal box. The 30% line is the box low + 0.30 × (box high − box low), rounded to 4 decimals, the same rounding as the 15% line. A box with no height has no 30% line, and the candidate is dropped. The rebound and F2 still apply. SOXX orders are unchanged. Because 0.30 is above 0.15, a close can clear the 15% line and miss the 30% line. `F-strict` is neither impossible nor the same rule as the base.
- `F-stop-all` uses the `F-stop` stock rule and also drops a SOXX order whose signal session is below. Base `C` has no SOXX order, so on that base `F-stop-all` is the same book as `F-stop`. Both rows are stored.

## Scoring

A stock position is one trade. An ETF position is one trade. Account P&L is ending equity minus $3,200. Max drawdown is the peak-to-trough of equity marked at each close.

The win rate is the count of positions with P&L strictly above zero, divided by the count of stock positions plus ETF positions. A flat position is in neither average. The average win is the mean of the strictly positive positions. The average loss is the mean of the strictly negative positions.

The $1.90 total adds every engine $0.70 sell charge back and subtracts $1.90 once per stock position and once per ETF position. It is not the verdict.

A joint-loss day is a session whose stock sleeve and ETF sleeve each have a strictly negative day result, using the round-8 definition. Base `C` has no ETF position and no ETF trade, so its joint-loss count is 0.

Capital use is the average, over the window's sessions, of stock market value at the close divided by $3,200, and the same for the ETF. Base `C` has ETF use 0.

The share below is the number of window sessions that are below, divided by the number of sessions in the window. It is a property of the window. Every row in a window stores the same share.

The pass rule is the round-7 rule. Below 100 trades the window is a hold before a loss can fail. Otherwise the engine total must be positive. `n < N` is a hold even when the ratio or the bootstrap bound fails. A negative total with at least 100 trades fails. The ratio must be strictly above the SPY ratio, and the bootstrap one-sided 98% lower bound of the mean trade must be above zero. The bootstrap is 10,000 draws, seed 20261003, q = 0.02, z = 2.05. `N = (2.05 × sd / mean)²`. `n` and the mean are stock positions plus ETF positions. SPY is +$1,661.54 / $379.84 / 4.37 out of sample and +$982.45 / $582.25 / 1.69 in sample.

Judged rows are both bases and all four filters, on the four point-in-time and ADV cells. The current list is not judged. One fail fails a base-and-filter pair. A hold keeps that pair a hold.

## Selection

These four filters and this 20-session average were chosen before the run. No other average length is tried. The threshold is only the close against that average. The extra line is only 30% of box height. There is no search.

Four variants times two bases is eight books. Six are active filters. The best active book is the one with the largest sum, over the four judged cells, of its engine P&L minus that base's `F-off` engine P&L. A tie keeps the earlier pair in this order: `C`/`F-stop`, `C`/`F-strict`, `C`/`F-stop-all`, `SOXX`/`F-stop`, `SOXX`/`F-strict`, `SOXX`/`F-stop-all`. The improvement is consistent when that book's engine P&L is strictly above its `F-off` on all four judged cells. The $1.90 totals are not the ranking.

With eight books, the chance that the best one looks good by luck is non-trivial. The report states that, and states whether the best book's improvement is consistent.

## Published cells the baselines must match

Round-7 C. Account P&L, drawdown, and stock trades:

| Universe | 2022-10–2024-10 | 2024-10–2026-10 |
|---|---|---|
| current list | +$1,801.92, DD $459.51, 245 | +$633.32, DD $823.76, 266 |
| point-in-time | +$335.76, DD $670.94, 319 | +$302.24, DD $782.86, 340 |
| ADV top 200 | +$831.79, DD $447.80, 236 | +$704.43, DD $684.07, 262 |

Round-8 SOXX, E30, box exit, 20-day box. Account P&L, ETF P&L, ETF trades, stock trades, drawdown, joint-loss days, $1.90 total:

| Universe | 2022-10–2024-10 | 2024-10–2026-10 |
|---|---|---|
| current list | +$2,174.12, ETF +$371.05, 29 / 245, DD $639.82, 79, $1.90 +$1,855.86 | +$949.29, ETF +$293.12, 23 / 265, DD $918.14, 66, $1.90 +$617.01 |
| point-in-time | +$670.37, ETF +$334.61, 30 / 319, DD $646.89, 82, $1.90 +$261.36 | +$560.29, ETF +$258.05, 23 / 340, DD $954.41, 63, $1.90 +$129.58 |
| ADV top 200 | +$1,105.85, ETF +$351.20, 29 / 236, DD $621.54, 78, $1.90 +$799.74 | +$1,069.65, ETF +$364.60, 23 / 261, DD $804.17, 60, $1.90 +$735.84 |
