# Round 12c — unlimited budget, one-name overlap — pre-registration

Locked before any round-12c run. A change to the text below is a new study, not a silent edit. Analysis only. Live alerts, the frozen paper-test rules, and `data/watchlist.yaml` are not part of this file.

Results must cite the commit that added this file. They must also cite round 12b, `d8716af07cc58fdead478be5bddc16f92aaa4f6b`. That file is not edited.

## Why this file exists

Round 12b said the unlimited fills of a cell are the constrained stock fills plus the signals that book did not take, and that a missing constrained fill stops the study. The first execution stopped. On the current list, 2022-10-03 through 2024-10-02, 60 constrained stock fills were absent. The first eight identities were FERG|2022-10-26, CDNS|2022-11-10, NOK|2022-10-25, STX|2022-11-08, POET|2022-10-21, LEU|2022-11-14, POWI|2022-12-13, and TYL|2022-12-13. The unlimited book was already long that ticker, from an earlier signal the constrained book had not taken. Both books keep one open position per ticker. That rule makes the superset false. Round 12b produced no tables.

## What stays

Every rule in the round-12b file stays, except the superset sentence and the stop that enforces it. That includes hypothesis generation only, the constrained row matching the published baseline, the $300 to $450 lot, no cash limit, no five-slot cap, no two-name semiconductor cap, the separate SOXX sleeve, required capital, cash and path, the sector table, and the ATR buckets. This file does not choose a sector or a bucket.

## Displaced fills

A constrained stock fill whose identity is missing from the unlimited book is displaced. The identity is `ticker|entryDate`. The count is stored. The P&L stored for those fills is their engine P&L in the constrained book, and their $1.90 net in that book. They are not added to the unlimited stock total, the stock net, the sector table, the ATR table, or the required capital. A displaced fill is not a cash skip and not a path fill.

Cash and path stay as written in the round-12b file. They count only identities the unlimited book filled.

The study does not stop on a displaced fill. It stops on the same failures round 12b already named: a constrained row that misses the published baseline, a required capital of zero, a leaked negative TTM, or a cash total that does not agree with the fills.
