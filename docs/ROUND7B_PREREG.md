# Round 7b — reference list — pre-registration

Locked before any round-7b run. A change to the text below is a new study, not a silent edit. Reference only. The lists were chosen with knowledge through 2026-10-03, so the result is hindsight. There is no pass or fail. Live alerts and the frozen paper-test rules are not part of this file. `data/watchlist.yaml` is not edited.

Results must cite the commit that added this file.

## Lists

KEEP (153): NVDA TSM MU AMKR ASX GFS TXN ADI NXPI MCHP STM MPWR RMBS SITM MTSI SWKS LSCC POWI SNDK AVGO ON MRVL AMD QCOM ARM ASML KLAC TER ONTO CAMT NVMI FORM ENTG LRCX ANET CRDO ALAB FN CSCO NOK COHR GLW AKAM CIEN CLS JBL APH TEL DELL HPE STX NTAP WDC SMCI META NBIS EQIX GOOGL MSFT AMZN ORCL ETN GEV PWR EME MOD HUBB POWL TT VRT BE VST NRG IRDM BAC C WFC MS SCHW SPGI COF PYPL IBKR MCO MSCI PGR UNH MRK AMGN MDT BSX ISRG DHR CI GEHC EW DGX BA GE UBER RTX HON DAL MMM VRSK FERG CPRT TSLA BKNG NKE TJX ABNB SBUX RCL CMG DRI WMT PM MO ADM XOM CVX VLO MPC COP FANG DVN OXY EOG NFLX VZ T TMUS DIS CHTR LYV AAPL CDNS FTNT ADSK NOW TYL PLTR NEM FCX SHW IFF STLD ETR EIX AMT VMRK WELL

EXCEPTION-KEEP: SPCX

TRANSITION (mining to AI, flagged, 5): IREN CIFR WULF APLD CORZ

REMOVE (27): NVTS INTC AEHR LITE AAOI VIAV POET CRWV FLNC CEG TLN OKLO SMR CCJ LEU RKLB ASTS LUNR PL RDW VSAT FLY F KHC TTWO MOS APD

The four sets are disjoint. Their union is the current watchlist names the engine already trades. The study stops if that check fails. The same lists are copied into `data/backtest/round7b_reference.json`.

## Themes

Each REMOVE or TRANSITION name is in one theme. The label is part of this list. It is not measured from the backtest.

- nuclear: CEG TLN OKLO SMR CCJ LEU
- loss-making: NVTS INTC AEHR AAOI POET CRWV FLNC RKLB ASTS LUNR PL RDW VSAT FLY
- transition: IREN CIFR WULF APLD CORZ
- other, stored so the 27 REMOVE names add up, and not one of the three themes above: LITE VIAV F KHC TTWO MOS APD

## Book

Round-4 base + F1-include-unknown + F2, locked at `1c2da22ba844c94ece16595262deddf5c606fbfb`. Filters run before the portfolio. Exit C is round-7 C: sell all at the signal session's 20-session high, with the round-7 stop-first rule. Exit A is round-7 A: sell all at the entry open + 1 × the signal ATR14, stop first. The lot, the box-low stop, the 20-session timeout, the fee, the five-position cap, the two-name semiconductor cap, and the $3,200 capital are the round-7 book.

The four rows use this fixed watchlist universe and the two windows 2022-10-03 through 2024-10-02, and 2024-10-03 through the last SPY session on or before 2026-10-02. The current-list signal close cap of $550 stays.

1. KEEP + SPCX, exit C
2. KEEP + SPCX + TRANSITION, exit C
3. The full traded current list, exit C
4. The full traded current list, exit A

Stored per row: P&L, max mark-to-market drawdown, win rate, average win, average loss, trade count, mean trade P&L, mean after putting the $0.70 sells back and subtracting $1.90 once, average hold, exit-leg breakdown, and the SPY comparison (SPY total, SPY drawdown, SPY ratio, this row's P&L / drawdown, and SPY scaled by the invested fraction). `N = (2.05 × sd / mean)²` from the round-7 bootstrap, 10,000 draws, seed 20261003. `N` is absent when the mean is not positive. No verdict is stored.

The full current list with exit A must reproduce the published round-4 current-list cells, +$1,581.13 on 350 and +$1,105.45 on 375. The full current list with exit C must reproduce the published round-7 C current-list cells, +$1,801.92 on 245 and +$633.32 on 266. A mismatch stops the study.

## Name totals

REMOVE and TRANSITION names are also counted on the stored round-4 F1-include-unknown + F2 book with exit A, and on the round-7 C book. Cells are the current list, point-in-time S&P 500+400, and ADV top 200, both windows. Per ticker and cell: trades, wins, losses, total P&L, and the worst trade. Theme totals add tickers inside one universe. They do not add the current list to the point-in-time book or the ADV book.
