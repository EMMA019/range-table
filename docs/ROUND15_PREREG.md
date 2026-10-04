# Round 15 — exclude GICS Financials — pre-registration

Locked before any round-15 run. A change to the text below is a new study, not a silent edit. Analysis only. Live alerts, the frozen paper-test rules, and `data/watchlist.yaml` are not part of this file.

Results must cite the commit that added this file.

## What this round measures

The baseline is the round-11 and round-12 baseline: round-8 `C+SOXX` with entry E30, the box exit, and a 20-day box, no regime filter. The stock exit is round-7 C. Entries are the round-4 base plus F1-include-unknown plus F2. The account starts at $3,200. At most five stock positions, at most two in the round-4 semiconductor class, one position per ticker. Rank is 20-session excess return, then ticker A–Z. The stock lot stays `sharesForBudget`, $300 to $450. The SOXX lot stays `min(floor(32 / (entry − box low)), floor(idle cash / entry))`.

The variant is that same book with one extra drop. A stock candidate whose current GICS sector is exactly `Financials` is not passed to the walk. The drop runs after F1-include-unknown, after F2, after exit C is planned, on candidates that are not voided and whose entry date is inside the window. A removed name leaves its cash and its slot free for a later stock and for SOXX. SOXX is not a stock and is not dropped by this rule.

This round does not use the round-11 width filter, the round-10 `R30` or `R35` share counts, the round-12 theme drops, the round-13 ATR cap, the round-14 T-bill park, or the unlimited-budget book.

Windows: 2022-10-03 through 2024-10-02, and 2024-10-03 through the last SPY session on or before 2026-10-02. The four cells are point-in-time S&P 500+400 and ADV top 200, both windows. The current list is not run.

The baseline row must reproduce the published round-10 cells below. A mismatch of account P&L, max mark-to-market drawdown, ETF P&L, stock trade count, ETF trade count, joint-loss days, or the $1.90 total stops the run.

## Sector

The sector is the current Wikipedia column `GICS Sector`, read by `listedFrom` from the cached S&P 500 table and the cached S&P 400 table. It is the label on the constituent table as cached, not the sector on the signal date. When a ticker is on both tables, the S&P 500 label wins. A ticker on neither table is not `Financials` and stays eligible. This is the same source the trade-ledger decomposition recorded. It is not the watchlist group `financials`. The morning screen's switch uses that watchlist group. This study does not.

## Fee

The engine still charges $0.70 on each stock sell and each ETF sell, and nothing on the buy. That is the locked round-8 charge. It is not $0.70 on the buy and again on the sell.

The reported net adds every engine $0.70 sell charge back and subtracts $1.90 once per stock position and once per ETF position. A position that sells in one fill is one $1.90. Sells are the fill's leg count, or one when a stock fill has no legs. This is `totalNet190`. The net is not a verdict. The drawdown path is the engine path, with the $0.70 sells.

## What is stored

Two rows per cell: `baseline` and `ex-financials`.

For each row:

- Engine account P&L, ending equity minus $3,200.
- The $1.90 net, `totalNet190` of the stock positions and the ETF positions.
- Trade count: stock positions plus ETF positions. Both counts are stored. The headline count is the sum.
- Win rate: the share of those positions whose engine P&L is strictly above zero. A flat is not a win. The rate is rounded to four decimals. An empty book stores null.
- Max drawdown: the engine peak-to-trough, `maxDrawdownUsd`.
- Lowest equity: the minimum daily marked equity on that engine path, with its date. This is `pathMarks`.

Removed Financials trades are the baseline stock fills whose ticker's current GICS sector is exactly `Financials`. The study stores their count, the sum of their engine P&L, and their $1.90 net (`totalNet190` of those fills only). The variant must contain none of those fills. A baseline stock fill in the watchlist group `financials` whose GICS sector is not `Financials` is listed and is not removed. That list is a record of the two definitions. It is not a second filter.

## Selection

Financials was chosen after the 2024-10 through 2026-10 results were already known. Emma named it as the weakest sector in that window. The 2024-10 through 2026-10 cells are in-sample. Only 2022-10 through 2024-10 is an out-of-sample check. The report states that in the same place as the numbers. It does not treat the later window as confirmation.

There is no pass, fail, or hold. The round-7 rule is not applied. Beating or missing the baseline is reported and is not a gate. No other sector is tested. No symbol is added or dropped after a result is seen.

## Quantum list, not a variant

Emma asked on 2026-10-04 to record a quantum-computing list beside the round-12 solar, crypto, and nuclear lists. The symbols, fixed here before the run, are IONQ, RGTI, QBTS, QUBT, and ARQQ. QMCO is Quantum Corporation, a storage company, and is not on the list. SPCX is not on the list. This round does not drop those symbols. The round-12 rows are not changed. The list is recorded in code beside the other three lists so a later study can name it. Membership and the loss-making check are reported with the results. They are not a reason to edit this list after the account numbers are known.

## Published cells the baseline must match

Round-10 baseline. Account P&L, ETF P&L, ETF trades, stock trades, drawdown, joint-loss days, $1.90 total:

| Universe | 2022-10–2024-10 | 2024-10–2026-10 |
|---|---|---|
| point-in-time | +$670.37, ETF +$334.61, 30 / 319, DD $646.89, 82, $1.90 +$261.36 | +$560.29, ETF +$258.05, 23 / 340, DD $954.41, 63, $1.90 +$129.58 |
| ADV top 200 | +$1,105.85, ETF +$351.20, 29 / 236, DD $621.54, 78, $1.90 +$799.74 | +$1,069.65, ETF +$364.60, 23 / 261, DD $804.17, 60, $1.90 +$735.84 |
