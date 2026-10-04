# Round 7 — take-profit exits — pre-registration

Locked before any round-7 run. A change to the text below is a new study, not a silent edit. Analysis only. Live alerts and the frozen paper-test rules are not part of this file.

Results must cite the commit that added this file. The Locked cells must reproduce the published round-4 base F1-include-unknown + F2 book. A mismatch stops the study.

## What the locked engine does now

The locked take-profit is sell all at the entry open + 1 × the signal session's ATR14. That is the user's "+1 ATR sell all." The stop, the hold, and the same-bar order are part of the same exit, and the same-bar order is not "stop first."

`rangeCandidates` walks each session from the entry session through the session `entryIndex + 20` in this order:

1. After the entry session, an open at or above the target sells all at that open. Reason `target`.
2. After the entry session, an open strictly below the box-low stop sells all at that open. Reason `stop`.
3. A high at or above the target sells all at the target. This includes the entry session. Reason `target`.
4. A close strictly below the box-low stop sells all at that close. This includes the entry session. Reason `stop`.
5. The session `entryIndex + 20` sells all at that close. Reason `timeout`.

The entry session does not sell a target or a stop at the open. The box-low stop is not an intraday print of the low. A low below the stop with a close at or above the stop is not an exit.

A bar whose high reaches the target and whose close is below the stop takes the target. The locked walker checks the intraday target before the close stop. Row `Locked` keeps this walker. Row A is the same prices with the stop-first rule below, even when the two rows match trade for trade.

If the series ends before `entryIndex + 20`, the remaining shares sell at the last close. Reason `window`. The portfolio also flattens a position still open on the window's last session at that close. Reason `window`.

## Book

Round-4 base + F1-include-unknown + F2, locked at `1c2da22ba844c94ece16595262deddf5c606fbfb`. Filters run before the portfolio, so a dropped name can be replaced. Semiconductors stay in the book. This is not the round-6 exclusion.

- Rebound of at least 1 day. Signal close at or above the 15% line of the 20-session box. ATR% at least 3. No earnings block.
- F1-include-unknown drops trailing-four-quarter GAAP net income strictly below zero and keeps an unknown. F2 drops an entry open strictly above the signal session's 20-session high.
- Stop is the signal session's 20-session low. It does not change on A, B, C, or D, except the remainder in B after the first half fills.
- Maximum hold is 20 sessions. It does not change.
- Size is `sharesForBudget`: whole shares whose cost is from $300 to $450. A name that does not fit is skipped. No $32 risk size.
- Current-list signal close ≤ $550. The point-in-time book and the ADV book have no $550 cap.
- A 35% close-to-close gap from the entry session through the session that sells the last share voids the trade. The void is recomputed on each row's own last exit. A voided trade does not enter.
- At most five positions. At most two open names in the round-4 semiconductor class. One position per ticker.
- Capital $3,200. No fractional shares. Sale proceeds are available on the next session. The engine charges $0.70 on each sell fill and nothing on the buy. A two-leg sale is two charges.
- Rank by 20-session excess return, then ticker A–Z.
- Windows: 2022-10-03 through 2024-10-02, and 2024-10-03 through the last SPY session on or before 2026-10-02.
- Universes match round 4. Judged cells are point-in-time S&P 500+400 and ADV top 200, both windows. The current list is stored and not judged.

## Same-bar rule for A, B, C, and D

If one bar both reaches a target and triggers a stop, the stop fills and the target does not. A gap through the stop still fills at the open. A close through the stop fills at the close. A target that wins fills at the open when the open is through it after the entry session, and otherwise at the target price.

"Triggers a stop" means the locked trigger: after the entry session, the open is strictly below the stop, or the close is strictly below the stop. It does not mean the low printed the stop.

## Rows

`Locked` is the engine above. A, B, C, and D replace only the exit. The entry, the filters, the lot, the box-low stop, the 20-session timeout, the fee, and the portfolio are the same.

### A — sell all at +1 ATR, stop first

Target is the entry open + 1 × the signal ATR14. Sell all there. Same stop and timeout as `Locked`. The same-bar rule above is the only change from `Locked`.

### B — half at +1 ATR, remainder at the nearer of the box high and +2 ATR

Let `qty` be the lot. If `qty` is 1, B is A. If `qty` is at least 2, the half is `floor(qty / 2)` and the remainder is the rest.

The half's target is the entry open + 1 × the signal ATR14. The remainder's target is the lower of the signal session's 20-session high and the entry open + 2 × the signal ATR14, keeping only prices strictly above the entry. The +2 ATR price is above the entry whenever ATR is positive. A box high at or below the entry is inactive, and the remainder target is then +2 ATR.

The half and the remainder can fill in either order. An open through a target after the entry session fills that lot at the open. A high through a target fills that lot at the target.

Until the half fills, a stop sells every share still open at the box-low stop. Reason `stop`. After the half fills, the remainder's stop moves to the entry price and the box-low stop no longer applies to those shares. An open strictly below that entry fills the remainder at the open. A close strictly below that entry fills it at the close. Reason `breakeven`. On the bar that sells the half, a close strictly below the entry sells the remainder at the close and does not take the remainder's target.

A remainder target and a half target on the same bar both fill when the stop does not. Each sell is its own fill and its own $0.70.

### C — sell all at the box high

Target is the signal session's 20-session high. Sell all there. Same stop, timeout, gap-through, and stop-first rule as A. F2 has already removed an entry strictly above that high.

### D — after +1 ATR, sell on a break of the prior day's low

The +1 ATR price is the entry open + 1 × the signal ATR14. Touching it does not sell. A touch is a high at or above that price, or, after the entry session, an open at or above it.

The prior-day exit starts on the next session. The session that touches +1 ATR does not itself exit on the prior day's low. The prior day's low is that next session's previous low.

On a session before the touch, and on the touch session: the box-low stop and the timeout are the only exits, in the locked order, and the +1 ATR price is not a sale. If that session also triggers the stop, the stop fills and the trail does not arm.

On a later session, in this order:

1. An open strictly below the box-low stop sells all at the open. Reason `stop`.
2. An open strictly below the prior day's low sells all at the open. Reason `priorLow`.
3. A low at or below the prior day's low sells all at the prior day's low. Reason `priorLow`.
4. A close strictly below the box-low stop sells all at the close. Reason `stop`.
5. The 20-session timeout sells all at the close. Reason `timeout`.

## Scoring

A position is one trade. Its P&L is the sum of its sell legs. A win is a trade P&L strictly above zero. Holding sessions are the exit session index of the last share minus the entry session index.

`meanUsd` is the average engine trade P&L. `meanNet190Usd` adds the engine's $0.70 sell charges back and subtracts $1.90 once per position, then averages. A two-leg sale is still one $1.90.

The exit breakdown counts legs, so the counts can exceed the trade count. Each leg is `target`, `stop`, `breakeven`, `priorLow`, `timeout`, or `window`, with its own count and P&L. Leg P&L includes that leg's $0.70.

The pass rule is Elena's round-3 rule. Below 100 trades, the window is a hold before a loss can fail. Otherwise the total must be positive, the P&L / max mark-to-market drawdown must be strictly above the full SPY ratio, and the bootstrap one-sided 98% lower bound of the mean trade P&L must be above zero. The bootstrap is 10,000 draws, seed 20261003, mulberry32, q = 0.02, nearest rank `ceil(0.02 × 10000) − 1`. `N = (2.05 × sd / mean)²`. `n < N` is a hold even when the ratio or the bound fails. SPY is +$1,661.54 / $379.84 / 4.37 out of sample and +$982.45 / $582.25 / 1.69 in sample. Scaled SPY is not part of the verdict.

Each of `Locked`, A, B, C, and D is judged on the four point-in-time and ADV cells. The current list is not judged. A row's verdict is the four judged cells. One fail fails the row. A hold keeps the row a hold.

## Locked reproduction

These are the published round-4 base F1-include-unknown + F2 cells. The study stops if `Locked` differs.

| Universe | 2022-10–2024-10 | 2024-10–2026-10 |
|---|---|---|
| current list | +$1,581.13 on 350 | +$1,105.45 on 375 |
| point-in-time | +$135.08 on 373 | +$10.16 on 381 |
| ADV top 200 | +$879.27 on 346 | +$277.96 on 381 |
