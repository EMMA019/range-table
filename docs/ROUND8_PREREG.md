# Round 8 — ETF cash sleeve — pre-registration

Locked before any round-8 run. A change to the text below is a new study, not a silent edit. Analysis only. Live alerts, the frozen paper-test rules, and `data/watchlist.yaml` are not part of this file.

Results must cite the commit that added this file. The `C` row must reproduce the published round-7 C cells. A mismatch stops the study.

## Stock book

Round-7 row C. Round-4 base + F1-include-unknown + F2, locked at `1c2da22ba844c94ece16595262deddf5c606fbfb`. Exit C is locked at `d5864cd146d28a9c47faee2aea9d0dc5db3aa3ac`: sell all at the signal session's 20-session high, stop first when the same bar also triggers the box-low stop.

- Signal on the close. The fill is the next session's open. The entry session does not sell a target or a stop at the open.
- After the entry session, an open at or above the target sells all at that open. An open strictly below the box-low stop sells all at that open.
- A high at or above the target sells all at the target, including the entry session. A close strictly below the stop sells all at that close, including the entry session.
- The same bar does not take both. The stop fills and the target does not.
- Timeout is the close of the session 20 steps after the entry. A series that ends first sells at the last close. Reason `window`.
- Lot is `sharesForBudget`, $300 to $450. Stop is the signal 20-session low. Capital is $3,200. At most five stock positions, at most two in the round-4 semiconductor class, one position per ticker. Rank is 20-session excess return, then ticker A–Z.
- The engine charges $0.70 on each stock sell and nothing on the buy. Sale proceeds are available on the next session. A 35% close-to-close gap from the entry through the last sell voids that stock trade.
- Windows: 2022-10-03 through 2024-10-02, and 2024-10-03 through the last SPY session on or before 2026-10-02. Judged cells are point-in-time S&P 500+400 and ADV top 200. The current list is stored and not judged. The current-list signal close cap of $550 stays.

Published round-7 C cells, which `C` alone must match:

| Universe | 2022-10–2024-10 | 2024-10–2026-10 |
|---|---|---|
| current list | +$1,801.92 on 245 | +$633.32 on 266 |
| point-in-time | +$335.76 on 319 | +$302.24 on 340 |
| ADV top 200 | +$831.79 on 236 | +$704.43 on 262 |

## ETF sleeve

The sleeve uses idle cash in the same $3,200 account. It does not take a stock slot. One ETF position at a time. A row is either SOXX or QQQ, never both. The clock is the SPY session list. The box is the N sessions ending on the signal session, including that session. N is 20, 40, or 60. The 15% line is the box low + 0.15 × (box high − box low), rounded to 4 decimals, the same rounding as the stock 15% line. A box with no height has no signal.

The signal is a fresh cross, confirmed on the close: this session's close is at or above this session's 15% line, and the previous session's close was strictly below the previous session's own 15% line. The fill is the next session's open. A signal while an ETF position is open is dropped, not queued. The entry open must be strictly below the signal box high and strictly above the signal box low. Otherwise there is no entry.

The stop is that box low. The target is that box high. The timeout is 20 SPY sessions. The fill order is the stock order above, including stop-first on a bar that both reaches the target and triggers the stop. The 35% gap void is not applied to the ETF. An ETF sell that is not a preemption settles on the next session, and the fee is the same $0.70. The buy has no fee.

Size is `min(floor(32 / (entry − box low)), floor(idle cash / entry))`. Idle cash is settled cash after that session's stock entries. Zero shares skips the entry. No fractional shares.

Stock signals win. On a stock entry, if settled cash is short and the ETF is still held after that session's open exits, sell the minimum whole ETF shares at the ETF opening price so that `shares × open − 0.70` covers the shortfall. Those proceeds are settled immediately and fund that stock. The remainder keeps the original stop, target, and timeout. If selling every remaining share still does not cover the stock, sell none and skip the stock. A planned ETF exit at the open is not a preemption: it settles on the next session. Reason `preempted` is only this funding sale.

Session order: settle cash from the prior session, open exits, stock entries with preemption, then an ETF entry if flat, then the rest of the day's stop, target, and timeout.

## Rows

Each row is stored on the current list, point-in-time, and ADV top 200, for both windows.

- `C`, the stock book alone
- `C+SOXX` with N = 20, 40, and 60
- `C+QQQ` with N = 20, 40, and 60

Buy-and-hold SPY, QQQ, and SOXX, each on $3,200, are reference. Whole shares are `floor(3200 / first open)`, bought at the first session's open and sold at the last session's close with one $0.70 fee. Leftover cash stays in the account. The path marks each close. Report P&L and max mark-to-market drawdown.

## Scoring

A stock position is one trade. An ETF position is one trade, including when a preemption sells only some of the shares. Account P&L is ending equity minus $3,200. Max drawdown is the peak-to-trough of that equity, marked at each close.

Capital use is the average, over sessions, of stock market value at the close divided by $3,200, and the same for the ETF. Market value uses the close and the shares still held.

ETF legs are `target`, `stop`, `timeout`, `preempted`, or `window`. The breakdown counts legs.

A both-negative day is a session whose stock sleeve and ETF sleeve each have a strictly negative mark-to-market result. A sleeve's day result is its close marks minus the prior session's close marks, plus that day's sale proceeds, minus that day's purchase cost. A sleeve with no position and no trade that day is zero, so the day is not both-negative.

A same-day stop is a session that has at least one stock stop fill and at least one ETF stop fill. A preemption is not a stop.

The $1.90 total adds every engine $0.70 sell charge back and subtracts $1.90 once per stock position and once per ETF position. It is not the verdict.

The pass rule is the round-7 rule. Below 100 trades the window is a hold before a loss can fail. Otherwise the engine total must be positive. `n < N` is a hold even when the ratio or the bootstrap bound fails. A negative total with at least 100 trades fails. The ratio must be strictly above the SPY ratio, and the bootstrap one-sided 98% lower bound of the mean trade must be above zero. The bootstrap is 10,000 draws, seed 20261003, q = 0.02, z = 2.05. `N = (2.05 × sd / mean)²`. SPY is +$1,661.54 / $379.84 / 4.37 out of sample and +$982.45 / $582.25 / 1.69 in sample.

Judged rows are `C+SOXX` and `C+QQQ` with N = 20, on the four point-in-time and ADV cells. `C` alone is stored and not judged here. N = 40 and N = 60 are stored and not judged. The current list is not judged. One fail fails the row. A hold keeps the row a hold.
