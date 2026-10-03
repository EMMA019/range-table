# Round 3 — risk sizing — pre-registration

Locked before any round-3 run. A change to the text below is a new study, not a silent edit. Analysis only. Live alerts and the frozen paper-test rules are not part of this file.

The base row is the earnings-bridge `pre` book (E1). On the current list for 2024-10-03 through the last SPY session on or before 2026-10-02, that book is +$1,307.46 on 363 trades. The `base` row on that list and window must reproduce that total and that count.

## Shared book

- Rebound of at least 1 day. Signal close at or above the 15% line of the 20-session box. The 15% line is `round4(low20 + 0.15 × (high20 − low20))`.
- ATR% at least 3. ATR14 is the signal session's ATR14.
- After the entry session, an open below the stop fills at that open. A close below the stop fills at that close. A target can fill on the entry session when the high reaches it. The entry session does not fill a target or a stop at the open.
- A 35% close-to-close gap from the entry session through the session that flattens the last share voids the trade. A voided trade does not enter and is not counted. This is the existing engine rule.
- At most five positions. At most two open names in the semiconductor class below. One position per ticker.
- Capital $3,200. No fractional shares. Sale proceeds are available on the next session.
- When more than one new buy is possible on the same open, rank by 20-session return minus SPY's 20-session return, descending. A missing rank sorts last. Ticker A–Z breaks ties.
- Windows: 2022-10-03 through 2024-10-02, and 2024-10-03 through the last SPY session on or before 2026-10-02.
- Current list: the watchlist names the bridge trades. ONDS is ignored. Signal close ≤ $550. The entry open is not given a second $550 cap.
- Point-in-time S&P 500 union S&P 400, and the ADV top 200, use the same membership, bar pool, and 63-day dollar-volume rank as the earnings-bridge script. Those two books have no $550 cap. The ADV pool is Wikipedia-history names, the watchlist, and cached sector-ETF holdings when those bars exist. It is not the whole US market.
- Pass, fail, and hold use only the point-in-time book and the ADV book. The current list is stored and marked not judged.

## Semiconductor class

The same class as the two-slot cap and the stop comparison.

- Current list: watchlist group `semi` or `equipment`.
- Point-in-time book and ADV book: a current GICS sub-industry whose name contains "semiconductor". A name with no GICS row is not in the class.

## Earnings block

E1, on every row. Drop a new buy whose entry session is 1, 2, 3, 4, or 5 sessions before an earnings reaction day. The reaction day itself is allowed. Sessions after it are allowed.

The reaction day is the 8-K Item 2.02 `acceptanceDateTime` in America/New_York. Form 8-K/A is ignored.

- At or after 16:00 ET: the next trading session after that ET calendar date.
- Before 09:30 ET, or from 09:30 ET up to but not including 16:00 ET: that ET calendar date when it is a trading session, otherwise the next trading session.

A filing with no acceptance timestamp is ignored and counted. It is not assigned a reaction day from the filing date. The count uses the SPY session calendar.

## Fee

The charge is the existing bridge fee: $0.70 once on each sell fill, and nothing on the buy. It is not $0.70 on the buy and again on the sell.

A trade that leaves in one sell pays $0.70. A scale-out that sells twice pays $0.70 on each sell. SPY buy-and-hold pays $0.70 once, on the final sell. The pass/fail benchmark below is that full SPY result.

## Rows

Each row is its own book. `base` and `R1` are both reported on every universe and window. `base` is the box-low stop with the existing $300–$450 size. `R1` is the risk-sized book with no other add-on. `base` is not judged. `R1` through `R7` are judged on the point-in-time book and the ADV book.

### base

Stop is the signal session's 20-session low. Target is the entry open + 1 × the signal ATR14. Maximum hold is 20 sessions: the close of the session `entryIndex + 20`, or the last bar if the series ends first. Size is the existing `sharesForBudget` lot: whole shares whose cost is from $300 to $450 inclusive. A name that does not fit is skipped. No $32 risk size.

### R1

Stop, for every name, is the signal session's 20-session low minus 1.5 × that session's ATR14. This is not limited to the semiconductor class. Target and maximum hold stay as on `base`. Gap-through stays as on `base`.

Risk budget is $32, which is 1% of $3,200. Risk distance is `entry − stop`.

- Distance ≤ 0: skip.
- Distance > 32: skip. One share would risk more than $32. Distance equal to 32 is allowed.
- Entry > 450: skip. One share would cost more than $450. Entry equal to 450 is allowed.
- Otherwise shares = `min(floor(32 / distance), floor(450 / entry))`. Floor means round toward zero. There is no $300 minimum.
- Shares below 1: skip.

The $450 cap is notional. It is not the $300–$450 lot.

### R2

`R1`, plus a scale-out. The +1 ATR target is not used.

Half the filled shares sell at the box midpoint. The remainder sells at the box top. Half is `floor(qty / 2)`. An odd share stays with the remainder, so the first half rounds down. Quantity 1 sells 0 at the midpoint and 1 at the top.

The midpoint is the signal session's `mid`, `round((low20 + high20) / 2, 4)`. The top is that session's 20-session high. Both are fixed at the entry.

A scale price that is less than or equal to the entry price is inactive. Shares assigned to an inactive midpoint wait for the top when the top is above the entry. Shares assigned to an inactive top wait for the stop or the 20-session timeout. They are not sold at a target at or below the entry.

The share split is applied when the buy fills, because the share count depends on cash that morning.

On a session after the entry session, in this order:

1. Open at or above an active top: sell every share still open, at that open.
2. Otherwise, open at or above an active midpoint and the midpoint half is still open: sell that half at the open. The remainder stays.
3. Otherwise, open below the stop: sell every share still open, at that open.

Then, still on that session, if shares remain:

4. High at or above an active top: the unsold midpoint half, if the midpoint is active, sells at the midpoint, and the remainder sells at the top. If the midpoint is inactive, the remaining shares sell at the top in one sell.
5. Otherwise, high at or above an active midpoint and that half is still open: sell that half at the midpoint.
6. Otherwise, close below the stop: sell the remaining shares at that close.
7. Otherwise, if this session is `entryIndex + 20`: sell the remaining shares at that close.

The entry session skips steps 1–3. Steps 4–7 still apply. Two sells are two fills and two $0.70 fees. Cash from the first sell is available on the next session, including when the second sell is the same day. The position is one trade. Its P&L is the sum of the sells. It is counted once, when the last share is sold.

### R3

`R1`, plus one time check. On the close of session `entryIndex + 5` (five sessions after the entry session; the entry session is not day 1), if that close is less than or equal to the entry price, sell the remaining shares at that close. Fees are not part of the test. If that close is above the entry, the check does not fire and it is not repeated on a later red close. The `R1` target, stop, and 20-session hold stay in force. On that fifth session a target that is reached by the high fills before the close check, and an open exit from steps 1–3 of the shared stop/target order fills before the close.

### R4

`R1`, plus a signal-bar filter. Enter only when `rs20 > 0` or the signal close is above the signal `ma50`. `rs20` is the stock's 20-session return minus SPY's 20-session return. A null side is false. Both null skips the name.

### R5

`R1`, plus a fee test after the share count is known. Let `mid` be the signal midpoint. Skip when `mid` is null, when `mid ≤ entry`, or when `(mid − entry) × shares < 7`. The 7 is ten times the $0.70 sell fee. The test runs inside the sizer. It is not a screen applied before the share count exists.

### R6

`R1`, except the signal close must also be at or above the 25% line. The 25% line is `round4(low20 + 0.25 × (high20 − low20))`. Names are taken from the 15% candidates and then kept only when the close clears that line. `R6` does not add the scale-out, the day-5 check, the strength filter, or the fee test.

### R7

`R1` plus `R2`, `R3`, `R4`, and `R5`. Not `R6`. The entry line stays at 15%. Targets are the scale-out prices. The day-5 check, the `R1` stop, and the 20-session timeout still apply. On the day-5 session, scale sells that the high has reached fill before the close check. The +1 ATR target is not used.

## What is reported

For each row, universe, and window, on the trades the book filled:

- Total P&L: end equity minus $3,200.
- Trade count.
- Win rate: share of filled trades with P&L > 0.
- Average win: mean P&L of trades with P&L > 0. Null when there is none.
- Average loss: mean P&L of trades with P&L < 0, kept negative. Null when there is none.
- Worst trade: the minimum filled-trade P&L. A loss is negative.
- Maximum mark-to-market drawdown.
- Share of sessions whose mark-to-market equity is at least $10 above the prior session's equity.
- Profit factor: gross winning dollars divided by gross losing dollars. Null when there is no losing dollar.
- Expectancy in R: for each filled trade, P&L divided by initial risk. Initial risk is filled shares × (entry − stop), using the share count at entry and that row's stop. Trades with risk ≤ 0 are left out of the mean. The reported figure is the mean of the rest. Null when none remain. A scale-out uses the original share count, not the half that sold first.
- Invested fraction: after that session's fills, cash is settled cash plus cash that has not settled, and equity is the mark-to-market equity. Cash ratio is cash / equity. Sessions with equity ≤ 0 are left out. Invested fraction is 1 minus the average cash ratio. Same-day close exits are cash at that close.
- Days-open share: share of sessions that still have an open position at that close.
- Scaled SPY: the full SPY total for that window, below, multiplied by the invested fraction. This column is not used for pass, fail, or hold.

## SPY benchmark

Pass and fail use the published $0.70 SPY buy-and-hold, unchanged:

- 2022-10 through 2024-10: total +$1,661.54, mark-to-market drawdown $379.84, ratio 4.37.
- 2024-10 through 2026-10: total +$982.45, mark-to-market drawdown $582.25, ratio 1.69.

The strategy ratio is total P&L divided by maximum mark-to-market drawdown, rounded to cents, the same rounding as the earnings-bridge judgment. A zero drawdown fails the ratio test. The comparison is strict. Scaled SPY is reported beside each row and is not this benchmark.

## Pass, fail, and hold

Judged rows are `R1`, `R2`, `R3`, `R4`, `R5`, `R6`, and `R7`, on the point-in-time book and the ADV book only. `base`, and every current-list row, is not judged.

Per judged window, in this order:

1. Trade count below 100 is a hold. The window is not judged further. A non-positive total does not turn that hold into a fail. This test is in addition to the round-2 rules below.
2. Otherwise the round-2 main-candidate window rule, with the same bootstrap: 10,000 resamples with replacement, seed `20261003`, `mulberry32`, one-sided 98% so `q = 0.02` and `z = 2.05`. The lower bound is the nearest-rank index `ceil(0.02 × 10000) − 1`. `N = (2.05 × sd / mean)²` with `sd` the sample standard deviation using `n − 1`.
   - `n < 2`, or the lower bound is null: hold.
   - Total ≤ 0: fail. `N` does not rescue a loss once the trade count is at least 100.
   - Total > 0 and `n < N`: hold, even when the ratio or the lower bound fails.
   - Total > 0, `n ≥ N`, and the ratio is not strictly above the SPY ratio or the lower bound is not above 0: fail.
   - Total > 0, `n ≥ N`, ratio strictly above the SPY ratio, and lower bound above 0: pass.

Universe verdict, from that universe's two windows: fail if either window fails; otherwise hold if either window is a hold; otherwise pass. Overall verdict, from the four point-in-time and ADV windows of that row: the same rule. Current-list windows are not an input to either verdict.
