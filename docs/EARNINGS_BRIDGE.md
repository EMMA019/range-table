# Earnings-window bridge — candidate E1

Selected after the published bridge step 4 (avoid new buys within five sessions of an 8-K Item 2.02 filing date, on both sides) cost about −$815 on the current list in 2024-10–2026-10. This file is not part of `docs/ROUND2_PREREG.md`. The text below is locked before the E1 run. A later change is a new candidate, not an edit of E1.

E1 was chosen after that bridge result. A pass here is not a confirmation that was registered before any earnings-window result was known.

## Earnings day

Used by E1, by the post-earnings comparison, and by the forced exit. Not used by the published filing-date row.

Take the 8-K Item 2.02 `acceptanceDateTime`. Convert it to America/New_York. Form 8-K/A is ignored.

- At or after 16:00 ET: the reaction day is the next trading session after that ET calendar date.
- Before 09:30 ET: the reaction day is that ET calendar date when it is a trading session, otherwise the next trading session.
- From 09:30 ET up to but not including 16:00 ET: the reaction day is that same ET calendar date when it is a trading session, otherwise the next trading session.

A filing with no acceptance timestamp is ignored and counted. It is not assigned a reaction day from the filing date. A name with no reaction day is not blocked and is not given a forced exit.

"Before" means the entry session is 1, 2, 3, 4, or 5 sessions before a reaction day. The reaction day itself is not before.

"After" means the entry session is the reaction day, or 1, 2, 3, 4, or 5 sessions after it.

The count uses the SPY session calendar.

## Shared book

Analysis only. Live alerts and the frozen paper rules are unchanged. The account is the bias-study box, not the round-2 IBKR book.

- Rebound of at least 1 day, close at or above the 15% line, target = next open + 1 ATR, stop = the signal session's 20-session low, maximum hold 20 sessions.
- ATR% at least 3. A stop gapped through fills at that open, after the entry session.
- At most five positions, at most two open semiconductor names, one position per ticker.
- Whole shares from $300 to $450, capital $3,200, round-trip fee $0.70. Sale proceeds settle the next session.
- Same-day rank is 20-session return minus SPY's 20-session return, then ticker A–Z.
- Windows: 2022-10-03 through 2024-10-02, and 2024-10-03 through the last SPY session on or before 2026-10-02.
- Current list: the watchlist names that the bridge trades, semiconductor = the watchlist semiconductor or equipment group, signal close ≤ $550.
- Point-in-time S&P 500 union S&P 400: membership as of the first day of the window, from the Wikipedia change history. Semiconductor = a current GICS sub-industry whose name contains "semiconductor". No $550 cap. A missing GICS row is not a semiconductor.
- ADV top 200: trailing 63-day average dollar volume, recomputed on each signal date, the same pool as the bias-study ADV book (Wikipedia history, the watchlist, and cached sector-ETF holdings when those bars exist). Not the whole US market. Semiconductor uses the same GICS rule. No $550 cap.

## Rows

Each row is its own book. Deltas versus the no-earnings row are not additive.

- `none`: no earnings entry block and no forced earnings exit.
- `filing`: the published step. Drop a signal whose session is within 5 sessions of an Item 2.02 filing date, before or after, including that date. This uses the filing date, not the reaction day. Comparison only.
- `pre` (E1): drop the entry when it is one of the 5 sessions before a reaction day. No block on the reaction day or after it.
- `post`: drop the entry when it is the reaction day or one of the next 5 sessions. Comparison only.
- `span`: do not drop the entry. If a reaction day is after the entry session and the trade would still be open on that reaction day, sell at the close of the prior session. A target or a stop that fills earlier still fills earlier. Comparison only.

## E1 judgment

Judged on `pre` only. `none`, `filing`, `post`, and `span` are not judged.

Per window, on the trades the book filled, with the same rule as the round-2 main candidates:

1. Total P&L > 0.
2. Total / mark-to-market drawdown is strictly greater than SPY buy-and-hold for that window. SPY is whole shares of $3,200 from the first open to the last close, round-trip fee $0.70. A zero drawdown fails this test.
3. The lower bound of the one-sided 98% bootstrap interval on mean trade P&L is > 0.
4. `N = (2.05 × sd / mean)²`, with `sd` the sample standard deviation (n − 1). If total > 0 and `n < N`, the window is a hold.

Bootstrap: 10,000 resamples with replacement, seed `20261003`, `mulberry32`, nearest-rank index `ceil(0.02 × 10000) − 1`.

Window verdict: `n < 2` or an undefined lower bound is a hold. Total ≤ 0 is a fail. Total > 0 and `n < N` is a hold. Total > 0, `n ≥ N`, and criterion 2 or 3 fails is a fail. All of 1–3 with `n ≥ N` is a pass.

Universe verdict: fail if either window fails; otherwise hold if either window is a hold; otherwise pass. Overall: fail if any of the three universes fails; otherwise hold if any is a hold; otherwise pass.
