# Round 8 amendment 2 — ETF entry grid

The round-8 pre-registration at `4235eface3528f5e1ca4a13e1cf1d0a75742a1f5` and the ATR-exit amendment at `52b73ed249d46e5d3af26d61c1148af5e83397a5` stay locked. This file does not edit them. Results must cite the commit that added this file.

Analysis only. Live alerts, the frozen paper-test rules, and `data/watchlist.yaml` stay out of this file.

## What stays

The stock book is still round-7 C. Sizing, stock priority, preemption, fees, and the fill order are unchanged. The fill is still the next session's open. The entry open must still be strictly inside the signal box. One ETF at a time. A signal while an ETF position is open is dropped, not queued. The box exit is still the box low and the box high. The ATR exit is still entry − 1.5×ATR14 and entry + 2×ATR14, with the one-share flag from the first amendment. N is 20, 40, and 60. The 20-day grid is the main grid. The 40-day and 60-day grids use the same entries and exits and stay reference. The current list is stored and not judged. `C` alone and every published E15 box row must match. A mismatch stops the run. Verdicts stay on E15 with the box exit and N = 20 only. The other combos are stored without a verdict.

## Entries

E15 is the locked fresh cross of the 15% line. This session's close is at or above this session's line, and the previous session's close was strictly below the previous session's own line. The line is the box low + 0.15 × (box high − box low), rounded to 4 decimals.

E25 is that same fresh cross at 0.25. Each session uses its own box.

E30 signals on a close that is strictly above the box low and at or below the box low + 0.30 × (box high − box low), that 30% line rounded to 4 decimals. The previous close is not consulted. A box with no height has no signal. The same close can signal again on a later session after the position is flat.

## Grid

SOXX and QQQ, each with E15, E25, and E30, each with the box exit and the ATR exit. That is 12 combinations on N = 20, and the same 12 on N = 40 and on N = 60. Each combination is stored on the current list, point-in-time S&P 500+400, and ADV top 200, for both windows.

The reported figures for a combination are the account P&L, the ETF-only engine P&L, the ETF trade count, the ETF win rate, the ETF average win, the ETF average loss, the account total after the $1.90 round trip, the account max mark-to-market drawdown, and the joint-loss days. The $1.90 total adds back every engine $0.70 sell and subtracts $1.90 once per stock position and once per ETF position. A joint-loss day is a session whose stock sleeve and ETF sleeve each have a strictly negative day result.
