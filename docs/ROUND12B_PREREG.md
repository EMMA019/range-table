# Round 12b — unlimited budget — pre-registration

Locked before any round-12b run. A change to the text below is a new study, not a silent edit. Analysis only. Live alerts, the frozen paper-test rules, and `data/watchlist.yaml` are not part of this file.

Results must cite the commit that added this file.

## Hypothesis generation only

This round does not produce a pass, a fail, or a hold. It is not a trading rule. The sector table and the ATR table are descriptive. They use the same windows the book is scored on. Choosing a sector, or an ATR bucket, after reading them would be post-hoc. This file does not choose one. A later round that wants to trade a sector or a bucket has to pre-register that choice on its own, against data it has not yet used as a selector. A large total in one cell is not evidence that the sector was known at the start of the window.

## What stays

The constrained book is the round-11 and round-12 baseline. That is round-8 `C+SOXX` with entry E30, the box exit, and a 20-day box, with no regime filter. The sleeve rules are the round-8 pre-registration at `4235eface3528f5e1ca4a13e1cf1d0a75742a1f5`, the ATR amendment at `52b73ed249d46e5d3af26d61c1148af5e83397a5`, and the entry amendment at `54dcc909b06c22fe7e1a0c36be8aa334ee910eda`. The stock exit is round-7 C, locked at `d5864cd146d28a9c47faee2aea9d0dc5db3aa3ac`, on the round-4 base plus F1-include-unknown plus F2, locked at `1c2da22ba844c94ece16595262deddf5c606fbfb`. The round-10 sizing study is the comparator, locked at `573cc7409decf183db4714ddb0bc795e51e811b6`. This round does not use the round-10 `R30` or `R35` share counts, the round-11 width filter, or the round-12 exclusion lists.

E30 is a close strictly above the box low and at or below the 30% line, with no previous-close check. The 30% line is the box low + 0.30 × (box high − box low), rounded to 4 decimals. The box exit is the box low and the box high. The entry open must stay strictly inside the signal box. One ETF at a time on the constrained book. Stock signals win on that book. Preemption, settlement, the 35% stock gap void, and the next-open fill stay as locked. The void is not applied to SOXX.

The constrained account is $3,200. At most five stock positions, at most two in the round-4 semiconductor class, one position per ticker. Rank is 20-session excess return, then ticker A–Z. Sale proceeds settle on the next session, except a sale on the last session, which settles immediately. The stock lot stays `sharesForBudget`, $300 to $450. The constrained SOXX lot stays `min(floor(32 / (entry − box low)), floor(idle cash / entry))`.

Windows: 2022-10-03 through 2024-10-02, and 2024-10-03 through the last SPY session on or before 2026-10-02. The four cells are point-in-time S&P 500+400 and ADV top 200, both windows. The current list is stored beside them and is not a separate claim. The current-list signal close cap of $550 stays. Point-in-time and ADV do not use that cap.

The constrained row must reproduce the published round-10 baseline. A mismatch of account P&L, max mark-to-market drawdown, ETF P&L, stock trade count, ETF trade count, joint-loss days, or the $1.90 total stops the run.

## Fee

The engine still charges $0.70 on each stock sell and each ETF sell, and nothing on the buy. It is not $0.70 on the buy and again on the sell.

The reported net adds every engine $0.70 sell charge back and subtracts $1.90 once per position. A position that sells in one fill is one $1.90. This is the series round-trip restatement. It is not $1.90 on the buy and another $1.90 on the sell. Stock net and SOXX net are computed on their own fills. They are not added together. The net is not a verdict. There is no verdict.

## Unlimited stock book

The unlimited book uses the same stock candidates as the constrained book: after F1-include-unknown, after F2, after exit C is planned. A candidate that is voided, or whose entry is outside the window, is still not taken.

Every remaining individual-stock signal is taken, at the same `sharesForBudget` lot, $300 to $450. The account's cash is not a limit. The five-position cap is not a limit. The two-name semiconductor cap is not a limit. Those three are the capital constraint this round removes. A name the lot rule rejects, because no whole-share cost lands in $300 to $450, is still not taken. That refusal is the share rule, not the account budget.

One open position per ticker stays. A second signal in a ticker that is already open is not taken. Same-day order stays 20-session excess return, then ticker A–Z, so the name kept on a tie is the name the constrained book would have kept.

The unlimited walk does not hold SOXX. Stocks do not sell SOXX, and SOXX does not use stock cash. Settled cash may go below zero. No interest is charged on that deficit. Account P&L is ending marked equity minus $3,200. Because the start cancels, that P&L equals the sum of the stock position P&Ls. The stored stock total is that sum, in engine dollars, and the stored stock net is the $1.90 restatement of those same positions.

## SOXX sleeve

SOXX is a separate walk. It has no stock candidates. The rules are E30, the box exit, and a 20-day box. Capital is $3,200. The lot is `min(floor(32 / (entry − box low)), floor(settled cash / entry))`. With no stocks in the walk, settled cash starts at $3,200, so the $32 risk budget is what binds unless the open is large enough that the cash term binds. The engine fee and the $1.90 restatement are the same as the stock book. The SOXX trades do not depend on the stock universe. The same sleeve is reported on every universe of a window. SOXX counts, SOXX P&L, and SOXX net are not inside the stock totals, the sector table, the ATR table, or the required-capital figure.

## Required capital

A stock lot's entry cost is shares times the entry open. That cost stays deployed until the sale settles. Settlement is the next session, except a sale on the last session, which settles immediately. This is the engine's cash rule. After that session's new buys, deployed capital is the sum of entry costs that have not settled. The required capital is the maximum of that sum. The date is the earliest session that attains it. SOXX is not in the sum.

Return on required capital is the stock $1.90 net divided by the required capital. The engine stock P&L divided by the required capital is stored beside it. A required capital of zero stops the study.

## Signals the constrained book did not take

The identity is `ticker|entryDate`. The constrained walk records each cash refusal, each slot refusal, and each semiconductor-cap refusal. A second signal in a ticker that is already open has no refusal record. It is the one-name rule, and the unlimited book does not take it either.

- Cash: a constrained cash refusal whose identity the unlimited book filled. The count, the sum of those unlimited engine P&Ls, and the sum of their $1.90 nets are stored.
- Path: an unlimited stock fill whose identity is absent from the constrained fills and is not in the cash set. The count and the sum of those unlimited engine P&Ls are stored. Slot refusals and semiconductor-cap refusals that the unlimited book filled are stored as their own counts and sums, and they sit inside this path total.

A constrained stock fill whose identity is missing from the unlimited book stops the study. The unlimited fills of a cell are the constrained stock fills plus the signals that book did not take.

## Sector

The sector is the current `GICS Sector` on the cached Wikipedia S&P 500 constituent table, read by `listedFrom`. A ticker missing there uses the same column on the cached S&P 400 table. A ticker on both lists uses the S&P 500 sector. These tables are the current constituents in the cache. They are not the sector on the signal date. A ticker on neither list uses its watchlist group name, and the row is marked watchlist rather than GICS. A ticker with neither is `unknown`. The study stores how many unlimited stock fills used GICS, the watchlist, and unknown.

The table is unlimited stock fills only. For each sector: trade count, win rate, average engine P&L, total engine P&L, and the count of engine P&Ls less than or equal to −$60. A win is engine P&L strictly above zero. A flat stays in the count and in the average, and out of the win rate's numerator. The average is the total divided by the count. Sectors are sorted by total engine P&L, descending, then by name A–Z. The top sector is the first. The bottom sector is the last. A sector with no fill is omitted.

## ATR bucket

The percent is `(ATR14 / signal close) × 100`. ATR14 is the signal session's 4-decimal simple average already stored on the candidate, the same value the book's ATR ≥ 3% gate divides. The close is that session's close. There is no further rounding. The buckets are below 3, 3 up to but not including 4, 4 up to 5, 5 up to 6, 6 up to 8, 8 up to 10, and 10 or above. A percent equal to a boundary goes to the higher bucket. The gate already drops a percent below 3, so the below-3 bucket is empty unless a fill slips through, and that count is stored rather than repaired. The same columns as the sector table are stored for each bucket, on unlimited stock fills only. SOXX has no bucket.

## What this file does not do

It does not rank a sector or a bucket as a rule. It does not change the live alerts, the paper test, or the watchlist. It does not add a stop, a target, or a size other than $300 to $450. It does not run the round-13 ATR cap.
