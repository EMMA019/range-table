# Round 17 — live morning band baseline and filters — pre-registration

Locked before any round-17 run. A change to the text below is a new study, not a silent edit. Analysis only. Live alerts, the frozen paper-test rules, and `data/watchlist.yaml` are not changed by this file.

Results must cite the commit that added this file (amendment commits after that cite the latest prereg commit named in `ROUND17_PREREG`).

## Question

Does the live paper screen (25%/35% recovery lines inside the 23–37% morning band, no rebound requirement, round-7C exits, current loss and theme exclusions) beat optional entry filters on risk metrics without giving up too much profit?

## Universe

The current watchlist in `data/watchlist.yaml`, minus:

- the watchlist group `financials`,
- every ticker on the theme exclusion lists in `src/lib/study-theme-lists.ts` (same solar, crypto, nuclear, and quantum lists as `src/lib/themes.ts` on the site, plus the queued PR #39 additions below),
- every ticker whose trailing four-quarter GAAP net income is strictly below zero under the round-4 F1 rule (`ttmAt` on slim EDGAR company facts at the **signal** date; unknown is kept; SPCX is never dropped by F1 even if negative).

### Theme lists (aligned with queued PR #39 site change)

**Solar** (complete vs `themes.ts` / round-12; no solar names are on the watchlist today):  
ENPH, SEDG, FSLR, RUN, ARRY, NXT, SHLS, CSIQ, JKS, SPWR, MAXN, NOVA.

**Crypto** (includes BTC miners and hosting):  
COIN, MSTR, MARA, RIOT, CLSK, HUT, IREN, CIFR, WULF, BTDR, BITF, CORZ.

**Nuclear:** CEG, TLN, OKLO, SMR, CCJ, LEU, NNE, BWXT.

**Quantum:** IONQ, RGTI, QBTS, QUBT, ARQQ.

**Space** (every space name excluded **except SPCX**):

- Static list: RKLB, ASTS, LUNR, PL, RDW, IRDM, VSAT, FLY, BKSY, SPCE.
- Plus every ticker in watchlist group `id: space` except SPCX (today: RKLB, ASTS, LUNR, PL, RDW, IRDM, VSAT, FLY).

SPCX is never theme-excluded.

The study JSON and Japanese report repeat the sorted union of excluded tickers.

## Common bar filters (baseline and variants)

On the signal session, all of the following must hold:

- `boxPct` is between 23 and 37 inclusive (morning band with ±2 pt lines: `BAND_LOW_PCT` / `BAND_HIGH_PCT` in `morning.ts`).
- ATR(14) is at least 3% of that session's close.
- The close is at most $550.
- The entry open on the next session is not above the signal session's 20-day box high (round-4 F2).
- SPY's close is at or above SPY's 20-day SMA on the signal session.
- No Nasdaq 8-K item 2.02 reaction date within five SPY sessions of the signal session (`nearEarnings` with stored dates; missing dates do not block).
- Point-in-time F1 loss filter at the signal date (SPCX exempt).

No rebound requirement (unlike round-16 rebound flavor).

## Entry lines and episodes

Two independent buy lines per ticker: **25%** and **35%** of the 20-day box (`low20 + pct/100 × (high20 − low20)`).

Qualification: session low at or below the line price (touch). No rebound.

**One buy per line per box episode:** after a trade on line L exits, the next signal on that ticker for line L may not use a signal session earlier than the exit session. The 25% and 35% lines maintain separate episode clocks.

Portfolio positions are keyed by `ticker` and line so both lines may be open on the same name.

## Shares and exit

`shares = min(floor(30 / (entry − stop)), floor(450 / entry))` with entry at the next open and stop at the signal session's 20-day low. Round-7 variant **C** exit on the walk (target at signal `high20`, stop at box low, 20-session max hold).

## Portfolio mechanics

Stocks only. Start $3,200, five stock slots, rank 20-session excess return over SPY then ticker A–Z, $0.70 per sell, $1.90 round-trip restatement per position. Baseline: at most **two** open names from watchlist groups `semi` or `equipment` (same as round-16).

## Windows

- Tuning (label `oos` in code): 2022-10-03 through 2024-10-02.
- Confirmation (label `in`): 2024-10-03 through the last SPY session on or before 2026-10-02.

## Variants

1. **Baseline** — no extra filters.
2. **Crash filter (1st buy / 25% line only):** on the signal session, let `high5` be the maximum session high over the signal day and the prior four sessions. Skip the 25% entry when `(high5 − close) ≥ k × ATR(14)` on the signal day. Grid `k ∈ {2.5, 3, 3.5}`. Pick the single `k` with the highest total $1.90-net P&L on the **tuning** window; report that row on confirmation. The 35% line is unchanged.
3. **Stabilization after recent low:** define `recentLow` = minimum session low over the 10 sessions ending on the signal day. Require the signal close and the prior `N−1` closes to be **strictly above** `recentLow` (`N ∈ {2, 3}`). Both lines use the filter. Two rows, no tuning pick.
4. **Semis + AI DC cap:** same entries as baseline; portfolio allows at most **two** concurrent positions among tickers in watchlist groups `semi`, `equipment`, `network`, `server`, `cloud`, or `power` (full table in code). Other groups unchanged.
5. **Descriptive (semis only):** no pass/fail. For box windows 5, 10, and 20 sessions, count how often semis would touch the 25% line under the common filters (no portfolio). Reporting only.

### Amendment 2026-10-04 — SOXX entry filter (variants A)

On the **signal session**, when the SOXX rule applies to a name:

1. SOXX close ≥ SOXX 20-day simple moving average (same calendar date as the signal).
2. **SOXX stabilization:** let `recentLow` = minimum SOXX session low over the 10 SOXX sessions ending on the signal date. Require SOXX close and each of the prior `N−1` SOXX closes (same dates as the stock signal and its prior sessions) to be **strictly above** that `recentLow` (`N ∈ {2, 3}`).

Tune `N` on the **tuning** window (`oos`, 2022–10–03 … 2024–10–02) using variant **A2** (all names): pick the `N` with higher total $1.90-net P&L; ties go to the smaller `N`. Freeze that `N` for all SOXX rows below.

Rows (same pass criteria as other variants on confirmation vs baseline):

- **A1 `soxx-semi`:** SOXX rule applies only to watchlist groups `semi` and `equipment`. Other names ignore SOXX (still use common filters including SPY≥20DMA unless noted).
- **A2 `soxx-all`:** SOXX rule applies to every name in the pool.

**SPY comparison** (confirmation + tuning reported; pass/fail only vs baseline on confirmation for the main variants):

| Row id | SPY≥20DMA on signal | SOXX rule |
|--------|---------------------|-----------|
| `no-spy` | off | off |
| `baseline` | on | off |
| `spy-soxx-all` | on | A2 with tuned `N` |

### Amendment 2026-10-04 — Dollar risk stop (variant B)

**`exit-risk30`:** same entries as baseline. Exit walk is round-7 variant C except the stop is the **first** price hit of:

- the signal session 20-day box low (same intraday/open/close rules as `planRound7Exit` variant C), and  
- a **dollar stop** `entry − (30 + 0.70) / qty` (open loss **$30 net of the $0.70 sell fee** on a full exit at that price).

Use `effectiveStop = max(boxLow, dollarStop)` for the walk. Report how many fills exit at the dollar stop (effective stop strictly above box low at entry) vs box low.

### Amendment 2026-10-04 — Exit comparison (variant C)

Same **entries** as baseline (live band, SPY≥20DMA, theme exclusions, round-7 sizing). Portfolio starts at **$3,200**, five slots, semi cap 2, RS rank unchanged.

**C0 (current):** Round-7 variant **C** with stop at the signal session 20-day box low and max hold **20** sessions after entry (sell on box-low break; otherwise target at box high or timeout).

**C1 (no stop):** No stop-loss. Exit only at take-profit (signal session 20-day box high, same target rules as variant C) or max-hold **timeout** at the session close. Two rows:

- **`exit-c1-20`:** max hold **20** trading sessions after entry (same calendar span as C0).
- **`exit-c1-40`:** max hold **40** trading sessions after entry.

**Windows** (each is one continuous portfolio, not a restart):

| Label | Dates |
|-------|--------|
| `live` | **2026-07-30** through **2026-10-02** (Emma’s paper/live screen period; single book from $3,200). |
| `in` | **2024-10-03** through the last SPY session on or before **2026-10-02** (same as confirmation window elsewhere). |

**Metrics** (report in this order for variant C rows):

1. **Max drawdown on mark-to-market equity** (daily close marks on open positions; same engine path as other round-17 books).
2. Max consecutive losing **closed** trades.
3. Total $1.90-net P&L and trade count.
4. **Worst single-trade open drawdown:** peak underwater MTM loss while the position is open (entry to exit).
5. **C1 only:** count of timeout exits where MTM loss on the exit close is **strictly greater than $30** (“deep underwater at timeout”).

Pass criteria vs **C0 on the same window** (not vs full baseline entries): same rules as other variants (DD, losing streak, ≥70% trades; flag if profit drops >15% vs C0).

The Japanese report may show Emma’s **actual** brokerage return over the live window (+10.9%, worst DD about −6%) as a **reference line only** — different trade set, not a pass/fail target.

## Pass criteria (confirmation window vs baseline)

A variant **passes** on confirmation (`in`) when simultaneously:

- engine max drawdown ≤ baseline max drawdown,
- max consecutive losing trades ≤ baseline max consecutive losses,
- trade count ≥ 70% of baseline trade count.

If total $1.90-net P&L falls more than 15% below baseline, the row is **flagged** (profit drop) even when risk criteria pass.

Optional combined reference: baseline metrics with both crash winner (tuning) and stabilization N=3 are not required for pass.

## Metrics

Per row and window: trade count, win rate, total and average $1.90-net P&L, engine max drawdown, max consecutive losses, stop-out rate (fraction of trades with exit reason `stop`).
