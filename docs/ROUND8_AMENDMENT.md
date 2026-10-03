# Round 8 amendment — ATR exit for the ETF sleeve

The round-8 pre-registration at `4235eface3528f5e1ca4a13e1cf1d0a75742a1f5` is already locked, and its box-exit run is published at `d0c6c72`. This file does not edit that text. It adds one exit variant. Results must cite the commit that added this file. A change here is a new study.

Analysis only. Live alerts, the frozen paper-test rules, and `data/watchlist.yaml` stay out of this file.

## What stays

The stock book is still round-7 C. The ETF entry is still the fresh close through box-low + 15% of the N-session box, filled at the next session's open. The entry open must still be strictly inside that box. One ETF at a time. Stock signals still win, and a funding sale is still `preempted` at the ETF open, settled immediately, with the same $0.70 fee. The fill order is the round-8 order: the entry session does not sell at the open; after that, a gap through the stop or the target fills at the open; a high at or above the target fills at the target; a close strictly below the stop fills at the close; the same bar takes the stop and does not take the target. Timeout is still 20 SPY sessions, and a window that ends first is still `window`. N is still 20, 40, and 60. N = 20 is the comparison that sits beside the judged box rows. N = 40 and 60 stay reference. The current list stays unjudged. The box-exit rows are not re-judged. This variant is stored and not judged. A box-exit row that differs from the published round-8 file stops the run.

## ATR exit

The signal ATR14 is the simple average of the 14 true ranges ending on the signal session, including that session, rounded to 4 decimals. That is the stock sheet's ATR, not Wilder smoothing. A missing or non-positive ATR skips the entry. The true range uses the previous close.

The stop is the entry open minus 1.5 times that rounded ATR. The target is the entry open plus 2 times that rounded ATR. Both prices are rounded to 4 decimals. The size uses 1.5 times the rounded ATR, not the rounded stop distance:

`min(floor(32 / (1.5 × ATR14)), floor(idle cash / entry))`.

When `floor(32 / (1.5 × ATR14))` is 0 and idle cash can buy one share, the entry is one share and the position is flagged. Zero shares still skips. No fractional shares. The flag is counted once per position, including when a later preemption sells only some of the shares.

The box exit keeps its own size, `min(floor(32 / (entry − box low)), floor(idle cash / entry))`, and is never flagged by this rule.

## Extra metrics

Each SOXX and QQQ row stores the box exit and the ATR exit. For each exit the report adds, on the ETF positions: trade count, win rate, average win, average loss, and the $1.90 total. A win is a position with P&L strictly above zero. The win rate divides by every ETF position. The average win uses the winners. The average loss uses the losers. A flat position is in the count and in neither average. The $1.90 total adds back every engine $0.70 ETF sell and subtracts $1.90 once per ETF position. The account $1.90 total, which includes the stock positions, stays on the row.

Max drawdown is the account's close-marked peak-to-trough under that exit. A same-day joint loss is a session whose stock sleeve and ETF sleeve each have a strictly negative day result. That is the both-negative day from the round-8 pre-registration. The row also stores the average shares bought and the count of flagged one-share entries.
