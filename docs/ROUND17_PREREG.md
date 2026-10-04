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

## Pass criteria (confirmation window vs baseline)

A variant **passes** on confirmation (`in`) when simultaneously:

- engine max drawdown ≤ baseline max drawdown,
- max consecutive losing trades ≤ baseline max consecutive losses,
- trade count ≥ 70% of baseline trade count.

If total $1.90-net P&L falls more than 15% below baseline, the row is **flagged** (profit drop) even when risk criteria pass.

Optional combined reference: baseline metrics with both crash winner (tuning) and stabilization N=3 are not required for pass.

## Metrics

Per row and window: trade count, win rate, total and average $1.90-net P&L, engine max drawdown, max consecutive losses, stop-out rate (fraction of trades with exit reason `stop`).
