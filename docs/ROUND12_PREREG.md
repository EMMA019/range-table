# Round 12 — explicit exclusion lists — pre-registration

Locked before any round-12 run. A change to the text below is a new study, not a silent edit. Analysis only. Live alerts, the frozen paper-test rules, and `data/watchlist.yaml` are not part of this file.

Results must cite the commit that added this file. The no-exclusion row must reproduce the published round-10 baseline, which round 11 also reproduced. That book is round-9 `F-off` for C plus idle-cash SOXX, entry E30, box exit, 20-day box. A mismatch of account P&L, max mark-to-market drawdown, ETF P&L, stock trade count, ETF trade count, joint-loss days, or the $1.90 total stops the run.

## What stays

The book is the round-11 baseline, which is the round-10 baseline. Round 11 is locked at `5fa41617b9fb48abea6e6f45eb9d84a6bb57743a`. Round 10 is locked at `573cc7409decf183db4714ddb0bc795e51e811b6`. The sleeve rules are the round-8 pre-registration at `4235eface3528f5e1ca4a13e1cf1d0a75742a1f5`, the ATR amendment at `52b73ed249d46e5d3af26d61c1148af5e83397a5`, and the entry amendment at `54dcc909b06c22fe7e1a0c36be8aa334ee910eda`. The stock exit is round-7 C, locked at `d5864cd146d28a9c47faee2aea9d0dc5db3aa3ac`, on the round-4 base plus F1-include-unknown plus F2, locked at `1c2da22ba844c94ece16595262deddf5c606fbfb`.

This round does not use the round-11 width filter and does not use the round-10 `R30` or `R35` share counts. The stock lot stays `sharesForBudget`, $300 to $450. The SOXX lot stays `min(floor(32 / (entry − box low)), floor(idle cash / entry))`. Capital is $3,200. At most five stock positions, at most two in the round-4 semiconductor class, one position per ticker. Rank is 20-session excess return, then ticker A–Z.

Windows: 2022-10-03 through 2024-10-02, and 2024-10-03 through the last SPY session on or before 2026-10-02. Judged cells are point-in-time S&P 500+400 and ADV top 200, both windows. The current list is stored and not judged. The current-list signal close cap of $550 stays. Point-in-time and ADV do not use that cap.

## Fee

The engine still charges $0.70 on each stock sell and each ETF sell, and nothing on the buy. That is the locked round-8 charge. It is not $0.70 on the buy and again on the sell.

The reported net adds every engine $0.70 sell charge back and subtracts $1.90 once per stock position and once per ETF position. A position that sells in one fill is one $1.90. This is the series round-trip restatement. The request's "$1.90 per side" is this one charge per position. It is not $1.90 on the buy and another $1.90 on the sell. The net is reported beside the engine total. It is not the verdict. The drawdown path is the engine path, with the $0.70 sells.

## Lists

The lists below are hard-coded. They were written with knowledge through 2026-10-03. They are not measured from this backtest. A ticker is excluded by exact symbol. No GICS rule, no description search, and no name added after the run.

SPCX is exempt on every row. If SPCX appears on a list below, it is removed from that list before the filter runs. It does not appear on any list below.

### Solar

ENPH, SEDG, FSLR, RUN, ARRY, NXT, SHLS, CSIQ, JKS, SPWR, MAXN, NOVA.

NOVA is the Sunnova symbol named in the request. SPWR is already in the list. The cached S&P 500 table, the cached S&P 400 table, their change tables, the eleven sector-ETF holding files, and the current GICS sub-industries were read before this run. No other solar symbol appears there. The only current sub-industry containing "Renewable" is Renewable Electricity, and its only name is ORA. ORA is Ormat, geothermal. It is not added. SolarWinds is not solar and is not added. FSLR's current GICS sub-industry is Semiconductors. NXT's is Electrical Components & Equipment. Both stay on this list because they were named here, not because of that sub-industry.

These solar symbols have no file under `data/.cache/bt5/` and therefore cannot be selected by any universe in this study: ARRY, SHLS, CSIQ, JKS, MAXN, NOVA. The symbols that do have a bar file are ENPH, SEDG, FSLR, RUN, NXT, and SPWR. A bar file is not membership. Point-in-time membership, the ADV top 200, and the current list still decide whether a name can signal.

### Crypto

COIN, MSTR, MARA, RIOT, CLSK, HUT, IREN, CIFR, WULF, BTDR, BITF.

HOOD is not on this list. These crypto symbols have no bar file: MARA, RIOT, CLSK, HUT, BTDR, BITF. The symbols that do have a bar file are COIN, MSTR, IREN, CIFR, and WULF.

### HOOD

HOOD is its own toggle. It is excluded only on the last row. It has a bar file. It is not a member of the crypto list.

### Nuclear

CEG, TLN, OKLO, SMR, CCJ, LEU, NNE, BWXT.

NNE has no bar file. The others do. The watchlist group `発電・原子力` is wider. BE, VST, NRG, and FLNC are not on this list and stay eligible.

### Loss-making

The baseline already skips a candidate whose trailing four-quarter GAAP net income is strictly below zero, and it keeps an unknown. That is F1-include-unknown, using the slim EDGAR cache and the signal date. No row adds a second loss-maker rule. The round-7b hindsight loss-making list is not used.

The study stores, per cell, the count of candidates that are inside the window, not voided, not above the box, and have a negative TTM. Those are the candidates F1 removes from the book that F2 would have kept. The count is taken before the walk, so a slot or a cash refusal is not part of it. Their P&L is not invented. The study also stores the wider count of in-window, not-voided candidates with a negative TTM, including names F2 would also refuse. Both counts are the same on every row of a cell, because no row changes F1.

## Variants

Six rows. A removed name is not passed to the walk. Its cash and its slot stay free for a later stock and for SOXX. SOXX is not on any list. The drop runs after F1-include-unknown, after F2, after exit C is planned, on candidates that are not voided and whose entry date is inside the window.

| Id | What is excluded |
|---|---|
| B | nothing |
| S | solar |
| C | crypto, and not HOOD |
| N | nuclear |
| A | solar, crypto, and nuclear, and not HOOD |
| H | solar, crypto, nuclear, and HOOD |

A name on more than one list is removed once. The three lists and HOOD are disjoint. SPCX stays on every row. The baseline theme-skip count is zero.

## Scoring

A stock position is one trade. An ETF position is one trade. Account P&L is ending equity minus $3,200. Max drawdown is the engine peak-to-trough. The peak date, peak equity, trough date, and trough equity are the cent-rounded daily path. When those two cents do not subtract to the engine figure, both numbers are stored. The lowest equity is the minimum cent-rounded close, with its date and the difference from $3,200.

A large stock loss is a stock position whose engine P&L is less than or equal to −$60. The count and the sum are stored. ETF losses are not in this count.

Removed baseline trades use the identity `ticker|entryDate`. A baseline stock fill whose identity is absent from the variant is removed. Wins are engine P&L strictly above zero. Losses are engine P&L strictly below zero. Flats are stored so the counts add up. Each removed ticker stores its win count, win sum, loss count, and loss sum. COIN, HOOD, and MSTR are stored on every row even when every number is zero. Every other ticker with a removed fill or a replacement fill is stored. A zero ticker that is not COIN, HOOD, or MSTR is omitted.

A replacement fill is a variant stock fill whose identity is absent from the baseline. The count and the engine P&L sum are stored, with the same per-ticker split. These are the other names the freed cash and the freed slots bought. They are not the removed trades at a new size. The lot rule did not change.

SOXX count and SOXX engine P&L are stored, and so are the differences from the baseline cell. An SOXX fill whose entry date is absent from the baseline is an ETF replacement and is counted separately from the stock replacements.

The pass rule is the round-7 rule, on the engine account total. Below 100 trades the window is a hold before a loss can fail. Otherwise the engine total must be positive. `n < N` is a hold even when the ratio or the bootstrap bound fails. A negative total with at least 100 trades fails. The ratio is the engine total divided by the engine max drawdown, and it must be strictly above the SPY ratio. The bootstrap one-sided 98% lower bound of the mean trade must be above zero. The bootstrap is 10,000 draws, seed 20261003, q = 0.02, z = 2.05. `N = (2.05 × sd / mean)²`. `n` and the mean are stock positions plus ETF positions, in engine dollars. SPY is +$1,661.54 / $379.84 / 4.37 out of sample and +$982.45 / $582.25 / 1.69 in sample.

Judged rows are S, C, N, A, and H, on the four point-in-time and ADV cells. The baseline is the comparator. It is stored and not judged. The current list is not judged. One fail fails the row. A hold keeps the row a hold. Beating or missing the baseline is reported and is not a second gate. The $1.90 net is not the verdict.

## Hypotheses

These were written before the run. They are not the pass rule.

Dropping the named solar, crypto, and nuclear symbols should cut the stock losses at or below −$60 that those symbols contribute, on the cells where the baseline actually filled them.

Account P&L is not assumed to rise. The same lists contain winners. COIN, HOOD, and MSTR are the winners the report has to show even when the removed sum is positive. Freed cash can fill a different stock and can change which SOXX trades fill. Those replacements are part of the result.

## Selection

The six rows and the symbols were fixed before the run. No other symbol is added after a result is seen. Five judged rows times four cells is twenty verdicts. The chance that one cell looks good by luck is non-trivial. The report states that.

The lists were named with knowledge through 2026-10-03. A pass on a later window can come from dropping names that were already known losers by the day this file was written. It is not evidence that the same list would have been written on 2022-10-03 or on 2024-10-03. The report states that.

## Published cells the baseline must match

Round-10 baseline. Account P&L, ETF P&L, ETF trades, stock trades, drawdown, joint-loss days, $1.90 total:

| Universe | 2022-10–2024-10 | 2024-10–2026-10 |
|---|---|---|
| current list | +$2,174.12, ETF +$371.05, 29 / 245, DD $639.82, 79, $1.90 +$1,855.86 | +$949.29, ETF +$293.12, 23 / 265, DD $918.14, 66, $1.90 +$617.01 |
| point-in-time | +$670.37, ETF +$334.61, 30 / 319, DD $646.89, 82, $1.90 +$261.36 | +$560.29, ETF +$258.05, 23 / 340, DD $954.41, 63, $1.90 +$129.58 |
| ADV top 200 | +$1,105.85, ETF +$351.20, 29 / 236, DD $621.54, 78, $1.90 +$799.74 | +$1,069.65, ETF +$364.60, 23 / 261, DD $804.17, 60, $1.90 +$735.84 |
