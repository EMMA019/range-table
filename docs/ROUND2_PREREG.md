# Strategy round 2 — pre-registration

Locked before any round-2 run. A change to the text below is a new candidate, not a silent edit of A1, A2, A1', A2', S1, S2, or N1. Analysis only. Live alerts and the frozen paper-test rules are not part of this file.

Nova is reserved and is not run. The result schema keeps an empty slot for it.

## Shared account and data

- Windows: 2022-10-03 through 2024-10-02, and 2024-10-03 through the last SPY session on or before 2026-10-02.
- Universes, both taken from the bias study and held fixed for the whole window where that study held them fixed:
  - Point-in-time S&P 500 union S&P 400, membership as of the first day of the window, rebuilt from the Wikipedia change history. A name with no price bars is dropped.
  - Point-in-time top 200 by trailing 63-day average dollar volume. Membership is recomputed on each signal date with `advLeaders`. The eligible names are only those that appear in that Wikipedia history and have Yahoo bars. This is not the whole US market, and it is not a full delisted-ADV universe.
- Capital $3,200. At most five positions, except S2. One open position per ticker.
- Whole shares whose cost is from $300 to $450 inclusive, the existing `sharesForBudget` rule. A name whose price does not fit is skipped.
- Price filter: signal close < $550 and entry open < $550. This is strict. The published box used ≤ $550.
- When more than one new buy is possible on the same open, rank by 20-session return minus SPY's 20-session return, descending. Missing rank sorts last. Ticker A–Z breaks ties.
- Sale proceeds are available on the next session (the existing T+1 approximation).
- A stop that is gapped through fills at that open, on every candidate. The check starts after the entry session, except A2, which is a same-session trade and has no separate stop.
- Commission is IBKR US fixed, and nothing else (no SEC or FINRA pass-through). Per order: `min(max(0.005 × shares, 1), 0.01 × shares × price)`. Entry and exit are separate orders. The published $0.70 round trip is not used.
- Earnings dates are 8-K Item 2.02 only. A name with no such filing is not treated as if it had one.
- Semiconductor means a current GICS sub-industry whose name contains "semiconductor". A name with no GICS row is not a semiconductor. The same map as the bias study.

## Earnings reaction day

Used by A1, A1', and by the "before earnings" block on S1 and N1.

Take the 8-K Item 2.02 `acceptanceDateTime`. Convert it to America/New_York.

- At or after 16:00 ET: the reaction day is the next trading session after that ET calendar date.
- Before 09:30 ET: the reaction day is that ET calendar date when it is a trading session, otherwise the next trading session.
- From 09:30 ET up to but not including 16:00 ET: the reaction day is that same ET calendar date when it is a trading session, otherwise the next trading session.

A filing with no acceptance timestamp is ignored and counted in the gap list. It is not assigned a reaction day by the filing date.

"Within 5 trading days before earnings" means the entry session is 1, 2, 3, 4, or 5 sessions before a reaction day. Entry on the reaction day, or after it, is allowed. The count uses the SPY session calendar.

## A1 — post-earnings drift

On the reaction day, all of the following:

- ATR% = ATR14 / close × 100 is at least 3.
- Close < $550.
- Open − prior close ≥ 1.5 × that reaction day's ATR14.
- Close > open.
- Volume ≥ 2 × the average volume of the 20 sessions strictly before the reaction day. Fewer than 20 prior sessions skips the name.

Enter at the next session's open. Target is that open + 1 × the reaction day's ATR14. Stop is a close below the reaction day's low; a later open below that low fills at the open. Exit at the close of the 10th session after the entry session if still open. Flat at the window's last close if the series ends first.

## A2 — no-news gap-down fill

On the entry session, using that session's open:

- Open ≤ prior close − 1 × the prior session's ATR14.
- Prior ATR14 is present and positive. ATR% of the prior close is at least 3. Prior close < $550 and open < $550.
- SPY open / SPY prior close − 1 ≥ −0.005. A SPY gap that is flat or up is allowed. A SPY gap down of more than 0.5% is not.
- No 8-K and no 8-K/A has `filingDate` equal to the entry session or the previous trading session. Item 2.02 is included by that rule. A ticker with no cached submission file is not traded, and is counted as a gap.

Buy at that open. If the same session's high is at or above the prior close, exit at the prior close. Otherwise exit at that session's close. There is no multi-day hold and no separate stop.

## A1' and A2'

Same as A1 and A2, except the entry session must not be a month-turn session. A month-turn session is the last trading session of a calendar month, or the first, second, or third trading session of a calendar month. The signal is dropped, not delayed.

A1' is judged only on a universe where A1 passes. A2' is judged only on a universe where A2 passes. Otherwise the row is stored and marked "not judged".

## S1 — fewer box entries

The current box, and only these extra limits:

- Rebound of at least 1 day, close at or above the 15% line of the 20-session box, target = next open + 1 ATR, stop = the signal session's 20-session low, maximum hold 20 sessions.
- ATR% from 4 to 6 inclusive.
- No entry within 5 trading days before an earnings reaction day, as defined above.
- At most 2 open semiconductor names.
- Price, commission, gap-through, rank, and the five-position cap are the shared rules.

## S2 — three positions

The same box as S1's first bullet, with ATR% at least 3 and no upper ATR cap. No earnings block. No semiconductor cap. At most 3 positions. Size is still the shared $300–$450 whole-share lot. Price, commission, gap-through, and rank are the shared rules.

## N1 — insider open-market buys

Source: SEC Insider Transactions Data Sets, quarterly ZIPs at `https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets/{year}q{q}_form345.zip`, from 2022 Q2 through the latest quarter that returns HTTP 200. The set starts in 2006; quarters before 2022 Q2 are not needed for these windows. Filings after the last published quarter are missing and are reported as a gap, not filled from another source.

Use non-derivative Table I rows only.

- Document type Form 4. Amendments (Form 4/A) are ignored.
- `TRANS_CODE` P and `TRANS_ACQUIRED_DISP_CD` A.
- Security title matches common stock, common share, or ordinary share, and does not match preferred, warrant, right, unit, note, bond, or depositary.
- Reporting owner is a director (`RPTOWNER_RELATIONSHIP` contains DIRECTOR), or the title matches CEO / chief executive, or CFO / chief financial. Other officers and 10% owners do not qualify by themselves.
- Dollar value is shares × price. A row with a missing or non-positive price does not count.
- A filing qualifies when one reporting-owner CIK's P rows on that accession sum to at least $100,000, or when two distinct reporting-owner CIKs each have a positive counted P on the same issuer and their Form 4 filing dates are at most 10 trading sessions apart. The signal date of a pair is the later filing date.
- Drop the purchase when any footnote on that accession matches `10b5-1` or `10b51`, or when the row or submission has a 10b5-1 flag column (name matched ignoring case among `AFF10B5ONE`, `IS10B51`, `RULE10B51`) equal to 1, true, or Y. If that column is absent, the checkbox is not available in the flat file and only the footnote test is applied. That absence is reported.
- Issuer symbol is matched to the bar ticker directly and with `.` swapped with `-`.

Enter at the next session's open after the Form 4 filing date. Never the same session as the filing date. No entry within 5 trading days before an earnings reaction day. On the last bar on or before the filing date: ATR% at least 3, close < $550, and the entry open < $550. Target is the entry open + 1 × that bar's ATR14. Stop is a close below that bar's 20-session low; a gap through fills at the open. Maximum hold 20 sessions. At most one signal per ticker per entry date.

## Reference, not a candidate

B0 repeats the shared box with ATR% at least 3, no earnings block, no semiconductor cap, and five positions, on both universes. It is not judged. The published top-200 box, +$1,056.66 and +$975.40, is printed beside it. Those two figures used the $0.70 fee and no $550 cap.

SPY buy-and-hold is recomputed with the same commission: whole shares of the first open, sold at the last close, marked to market each close. Criterion 2 uses that recomputed total divided by its mark-to-market drawdown. The published +$1,661.54 and +$982.45 are shown next to it.

## Pass, fail, and hold

Judged candidates are A1, A2, S1, S2, and N1. Each universe is judged on its own. A candidate passes overall only when both universes pass.

Per window, using the trades the book actually filled:

1. Total P&L > 0.
2. Total / mark-to-market drawdown is strictly greater than the recomputed SPY ratio for that window. A zero drawdown fails this test.
3. The lower bound of the bootstrap interval on mean trade P&L is > 0.
4. Let `sd` be the sample standard deviation (n − 1) of trade P&L and `mean` the sample mean. `N = (z × sd / mean)²`. If `n < N`, the window is undecidable (hold), not a fail.

Bootstrap: 10,000 resamples with replacement of the filled trades, seed `20261003`, `mulberry32`. The statistic is the mean P&L. The lower bound is the nearest-rank quantile: sort the 10,000 means and take index `ceil(q × 10000) − 1`.

- A1, A2, S1, S2, N1: one-sided 98%, so `q = 0.02` and `z = 2.05`.
- A1' and A2', and only when judged: two-sided 90%, so `q = 0.05` and `z = 1.65`.

Window verdict:

- `n < 2`, or `sd` is undefined: hold.
- Total ≤ 0: fail. `N` is not used to turn a non-positive mean into a hold.
- Total > 0 and `n < N`: hold, even when criterion 2 or 3 fails.
- Total > 0, `n ≥ N`, and criterion 2 or 3 fails: fail.
- Total > 0, `n ≥ N`, and criteria 2 and 3 both pass: pass.

Universe verdict: fail if either window fails; otherwise hold if either window is hold; otherwise pass. Overall verdict: fail if either universe fails; otherwise hold if either universe is hold or not judged; otherwise pass.

Also reported, and not part of the verdict: profit factor (null when there is no losing dollar), trade count, maximum consecutive non-positive trades in exit-date then ticker order, and the share of sessions whose realized P&L that session is at least $10.
