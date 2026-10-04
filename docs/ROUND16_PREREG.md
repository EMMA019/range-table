# Round 16 — 20-day box entry line — pre-registration

Locked before any round-16 run. A change to the text below is a new study, not a silent edit. Analysis only. Live alerts, the frozen paper-test rules, and `data/watchlist.yaml` are not part of this file.

Results must cite the commit that added this file.

## Question

Among 25%, 30%, and 35% recovery lines on the 20-day box, which line is best for a single stock entry? The 15% line is run only as a reference row. It cannot be selected.

## Universe

The current watchlist in `data/watchlist.yaml`, minus:

- the watchlist group `financials`,
- every ticker on the solar, crypto, nuclear, and quantum lists in `src/lib/themes.ts` (the round-12 solar, crypto, and nuclear lists plus the quantum list Emma asked for on 2026-10-04; SPCX is not on those lists),
- every ticker whose trailing four-quarter GAAP net income is strictly below zero under the round-4 F1 rule (`ttmAt` on slim EDGAR company facts at the signal date; unknown is kept; SPCX is never dropped by F1 even if negative).

The study reports how many watchlist names in this pool have F1 status `unknown`, and lists their tickers.

## Common bar filters

On the signal session (the close that qualifies the line), all of the following must hold:

- ATR(14) is at least 3% of that session's close (same ratio as the detail table: ATR14 ÷ close × 100).
- The close is at most $550 (same cap as the frozen box book).
- The entry open on the next session is not above the signal session's 20-day box high (round-4 F2: `entry <= high20`; missing high20 voids the signal).
- SPY's close is at or above SPY's 20-day simple moving average on the signal session (the morning screen rule; not the round-9 50-day or 200-day filters).
- No Nasdaq 8-K item 2.02 reaction date within five SPY sessions of the signal session (same `nearEarnings` rule as `earnings: true` on the range book; tickers with no stored dates are not blocked).

## Windows

- Main: 2024-10-03 through the last SPY session on or before 2026-10-02.
- Out-of-sample check: 2022-10-03 through 2024-10-02.

## Box line price

For signal index `i`, with signal-day `low20` and `high20` from the same 20-day box as the site:

`line = low20 + (pct / 100) × (high20 − low20)`

for `pct` in {15, 25, 30, 35}.

## One buy per box episode

Signals are built per ticker in calendar order. After a signal is taken, the next signal on that ticker may not use a signal session earlier than the exit session of the prior simulated trade on that ticker. Within each gap, only the **first** signal session that qualifies counts. That is one buy per box episode between exits.

## Entry flavors

Two flavors per line percentage. The buy is always the next session's open after the signal close. The stop is the signal session's 20-day low. Take-profit is round-7 variant C (sell at the signal session's 20-day box high). Max hold is 20 sessions after entry. The portfolio uses round-7 legs on the walk.

### Touch (`touch`)

The first qualifying signal session in a gap where the session low is at or below the variant line price (intraday touch). No rebound requirement.

### Rebound (`rebound`)

The first qualifying signal session in a gap where:

1. `reboundDays` from `compute.ts` is at least 1 (the same consecutive bullish candles after the 20-day low that the frozen box book requires), and
2. the session low is at or below the variant line price, and
3. the close is at or above the variant line price (close back on or above the line after having traded at or through it).

This is the paper-test rebound idea applied to the variant line instead of the fixed 15–25% IN OK band. The frozen paper book still uses 15% minimum and IN OK; this study does not change that file.

## Shares

`shares = min(floor(30 / (entry − stop)), floor(450 / entry))` using the entry open and the signal-day box low. If `shares < 1`, the signal is void. This replaces `sharesForBudget` for this study only.

## Portfolio mechanics

Stocks only. No SOXX sleeve and no idle-cash ETF. Otherwise the round-8 stock portfolio walk: start $3,200, at most five stock positions, at most two in the watchlist semiconductor or equipment groups, one open position per ticker, rank 20-session excess return over SPY then ticker A–Z, $0.70 on each sell, $1.90 round-trip restatement per position. Settlement and slot rules are unchanged.

## Variants

Eight rows: line 15 / 25 / 30 / 35 × flavor touch / rebound. Labels use `L{pct}-{touch|rebound}`.

## Metrics per row and window

Trade count (stock positions), win rate (engine P&L strictly above zero), total $1.90-net P&L, average $1.90-net P&L per trade, engine max drawdown, lowest marked equity and its date.

## Pre-registered decision criteria

Write these verbatim into results; do not relax them after the run.

1. A line is a 'candidate' only if, in 2024-26, it has the highest net P&L among 25/30/35 within the same flavor, has >= 30 trades, and its max DD is no more than 20% worse than the 25% line's.
2. It is 'confirmed' only if in 2022-24 it is also not the worst of 25/30/35 by net P&L.
3. If the net P&L gap between best and second-best in 2024-26 is under $100, verdict is 'no meaningful difference'.
4. 15% is reference only and cannot be selected.

Judged lines are 25, 30, and 35 only. Verdicts are per flavor (`touch` and `rebound`). The 15% rows are printed for context.

## Outputs

`data/backtest/round16.json`, a backtest section, per-trade CSVs under `/opt/cursor/artifacts/round16_trades/` (not committed), and a short Japanese summary paragraph (facts first, interpretation clearly labeled) for forwarding.
