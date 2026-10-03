# Stop comparison — pre-registration

Locked before any stop-comparison run. A change to the text below is a new comparison, not a silent edit. Analysis only. Live alerts and the frozen paper-test rules are not part of this file.

## Book

The earnings-bridge `none` book: semiconductors capped at 2, no earnings block. On the current list for 2024-10-03 through the last SPY session on or before 2026-10-02, that book is +$1,304.86. The variant `low` on that list and window must reproduce that total.

- Rebound of at least 1 day, close at or above the 15% line of the 20-session box, target = next open + 1 × the signal session's ATR14, maximum hold 20 sessions.
- ATR% at least 3.
- After the entry session, an open below the stop fills at that open. A close below the stop fills at that close. The target can fill on the entry session.
- At most five positions. At most two open names in the semiconductor class below. One position per ticker.
- Whole shares whose cost is from $300 to $450, capital $3,200, round-trip fee $0.70. Sale proceeds are available on the next session.
- When more than one new buy is possible on the same open, rank by 20-session return minus SPY's 20-session return, descending. Ticker A–Z breaks ties.
- No earnings filter and no forced earnings exit.
- Windows: 2022-10-03 through 2024-10-02, and 2024-10-03 through the last SPY session on or before 2026-10-02.
- Current list: the watchlist names the bridge trades. ONDS is ignored. Signal close ≤ $550.
- Point-in-time S&P 500 union S&P 400, and the ADV top 200, use the same membership, bar pool, and 63-day dollar-volume rank as the earnings-bridge script. Those two books have no $550 cap. The ADV pool is Wikipedia-history names, the watchlist, and cached sector-ETF holdings when those bars exist. It is not the whole US market.

## Semiconductor class

The same class the two-slot cap uses. Variants 2, 3, and 4 do not invent a second list.

- Current list: watchlist group `semi` or `equipment`.
- Point-in-time book and ADV book: a current GICS sub-industry whose name contains "semiconductor". A name with no GICS row is not in the class.

"Semis/semi-equipment" and "semis only" both mean this class. Other names keep the box-low stop in every variant.

## Stops

The box low is the signal session's 20-session low. ATR14 is that same session's ATR14. Both are fixed at the entry open. They are not recomputed later.

1. `low`: every name, stop = box low.
2. `pct5`: class names, stop = box low × 0.95. Other names, stop = box low.
3. `pct10`: class names, stop = box low × 0.90. Other names, stop = box low.
4. `atr15`: class names, stop = box low − 1.5 × ATR14. Other names, stop = box low.

## What is reported

For each variant, universe, and window, on the trades the book filled:

- Book P&L: end equity minus $3,200.
- Worst trade: the minimum filled-trade P&L. A loss is negative.
- Trade count.
- Win rate: share of filled trades with P&L > 0.
- Share of filled trades with P&L ≥ $10.
- Share of sessions whose mark-to-market equity is at least $10 above the prior session's equity.
- Maximum mark-to-market drawdown.
- Class subtotal: sum of P&L, count, and minimum P&L of the filled trades whose name is in the semiconductor class. This is not a separate account. The two-slot cap still applies.
