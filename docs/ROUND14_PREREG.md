# Round 14 — idle cash in a T-bill ETF — pre-registration

Locked before any round-14 run. A change to the text below is a new study, not a silent edit. Analysis only. Live alerts, the frozen paper-test rules, and `data/watchlist.yaml` are not part of this file.

Results must cite the commit that added this file.

## What this round measures

The book is the round-11 and round-12 baseline: round-8 `C+SOXX` with entry E30, the box exit, and a 20-day box, no regime filter. The stock exit is round-7 C. Entries are the round-4 base plus F1-include-unknown plus F2. The account starts at $3,200. At most five stock positions, at most two in the round-4 semiconductor class, one position per ticker. Rank is 20-session excess return, then ticker A–Z. The stock lot stays `sharesForBudget`, $300 to $450. The SOXX lot stays `min(floor(32 / (entry − box low)), floor(buying power / entry))`.

Windows: 2022-10-03 through 2024-10-02, and 2024-10-03 through the last SPY session on or before 2026-10-02. The four cells are point-in-time S&P 500+400 and ADV top 200, both windows. The current list is stored beside them and is not a separate claim. There is no pass, fail, or hold.

The row with the park turned off must reproduce the published round-10 baseline. A mismatch of account P&L, max mark-to-market drawdown, ETF P&L, stock trade count, ETF trade count, joint-loss days, or the $1.90 total stops the run. Joint-loss days stay stock versus SOXX. The park is not in that count.

## The park

Idle settled cash is held in SGOV. BIL is used on a session only when that session has no SGOV bar and does have a BIL bar. A session with neither bar stops the study. The report stores how many sessions used BIL. SGOV covers the cached calendar of both windows, so that count is expected to be zero.

Quote open, high, low, and close are the split-adjusted Yahoo bars, not the dividend-adjusted close. A cash dividend is credited separately. On an ex-date, shares held overnight — the shares still open after the prior session, not a same-day buy — receive the cash dividend per share. That cash is settled at the start of the ex-date, before the open. The study stores the sum of those credits as distributions. Price P&L is the engine P&L of the park sells and does not include the credits.

Whole shares only. Cash that cannot buy one share stays as cash. No interest is paid on that remainder.

One park position per flat-to-flat cycle. A buy while shares are already open is a top-up of that cycle, not a new position. A sale that leaves shares open does not end the cycle. A sale to zero shares ends it. The next buy starts another cycle.

## Session order

The park is off unless the study asks for it. With it off, the walk is the published walk.

With it on, after the prior session's sales settle and after the ex-date dividend is credited:

1. Stock and SOXX open exits run as they do today.
2. A stock buy, and a SOXX buy, that needs more settled cash sells the minimum whole park shares at that session's open. The engine charges $0.70 on that sell. The proceeds, shares times the open minus $0.70, settle immediately, before the buy. This is the same immediate settlement a SOXX preemption already uses.
3. Stock buys then run under the existing cash, slot, and semiconductor tests.
4. SOXX sizes off buying power, not off settled cash alone. Buying power is settled cash plus the after-fee proceeds of selling every remaining park share at the open. The $0.70 is inside that proceeds term. The $32 risk budget is unchanged. Parking must not leave SOXX unable to sell shares it holds. A name the baseline afforded by less than that $0.70, or by a SGOV price move, can still be skipped. The study does not patch that skip.
5. After that session's stock and SOXX buys, settled cash that can buy at least one whole share buys as many whole shares as it can at the same open. The engine charges $0 on that buy. A top-up adds to the open cycle.
6. The last session flattens stocks and SOXX as today, then sells any remaining park shares at that session's close. The engine charges $0.70. There is no next session, so the proceeds stay in ending equity.

The park does not use a stock slot and is not a semiconductor name.

## Fee

The engine charges $0.70 on each park sell and nothing on a park buy. It is not $0.70 on the buy and again on the sell.

The reported net adds every engine $0.70 sell charge back, including park sells, and subtracts $1.90 once per position. A park cycle is one position, so it is one $1.90, however many top-ups and partial sells it had. A second cycle is another $1.90. This is not $1.90 on the buy and another $1.90 on the sell. The net is not a verdict.

## What is stored

For each cell, the parked book and the baseline:

- Engine account P&L and the $1.90 total.
- Engine uplift and $1.90 uplift, each also as a fraction of $3,200.
- Park distributions, park price P&L, park sell count, and the extra engine fees on those sells ($0.70 times the sell count).
- Max mark-to-market drawdown and the lowest marked equity, with the date. The park is inside both marks.
- Stock P&L, SOXX P&L, and park P&L, so a fill that moved because of the $0.70 is visible.

Per calendar year that contains a window session: the parked engine equity change across that year's sessions inside the window, minus the baseline's change across the same sessions. The year boundary is the last SPY session of the year, or the window end when that is sooner. The start is the prior boundary, or the window start. Uplift in dollars, and that uplift divided by $3,200, are stored. A year with no session is omitted.

## What this file does not do

It does not change the live alerts, the paper test, or the watchlist. It does not add a stock stop, a target, or a size other than $300 to $450. It does not run the round-13 ATR cap or the round-12b unlimited book.
