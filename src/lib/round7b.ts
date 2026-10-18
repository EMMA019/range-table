import { ROUND4_PREREG } from "./round4";
import { SPY_BENCH, type Round3Universe, type Round3Window } from "./round3";
import type { ExitTotals } from "./round7";

/** Pre-registration commit. Results must cite this and must not relax the rules. */
export const ROUND7B_PREREG = "98704c07b43b4ed8aa266d8a7bf736f1d3acb866";

export const ROUND7_EXIT_COMMIT = "d5864cd146d28a9c47faee2aea9d0dc5db3aa3ac";

/** Chosen with knowledge through 2026-10-03. Reference only. */
export const KEEP = [
  "NVDA", "TSM", "MU", "AMKR", "ASX", "GFS", "TXN", "ADI", "NXPI", "MCHP", "STM", "MPWR", "RMBS", "SITM", "MTSI", "SWKS", "LSCC", "POWI", "SNDK", "AVGO", "ON", "MRVL", "AMD", "QCOM", "ARM",
  "ASML", "KLAC", "TER", "ONTO", "CAMT", "NVMI", "FORM", "ENTG", "LRCX",
  "ANET", "CRDO", "ALAB", "FN", "CSCO", "NOK", "COHR", "GLW", "AKAM", "CIEN",
  "CLS", "JBL", "APH", "TEL", "DELL", "HPE", "STX", "NTAP", "WDC", "SMCI",
  "META", "NBIS", "EQIX", "GOOGL", "MSFT", "AMZN", "ORCL",
  "ETN", "GEV", "PWR", "EME", "MOD", "HUBB", "POWL", "TT", "VRT",
  "BE", "VST", "NRG", "IRDM",
  "BAC", "C", "WFC", "MS", "SCHW", "SPGI", "COF", "PYPL", "IBKR", "MCO", "MSCI", "PGR",
  "UNH", "MRK", "AMGN", "MDT", "BSX", "ISRG", "DHR", "CI", "GEHC", "EW", "DGX",
  "BA", "GE", "UBER", "RTX", "HON", "DAL", "MMM", "VRSK", "FERG", "CPRT",
  "TSLA", "BKNG", "NKE", "TJX", "ABNB", "SBUX", "RCL", "CMG", "DRI",
  "WMT", "PM", "MO", "ADM",
  "XOM", "CVX", "VLO", "MPC", "COP", "FANG", "DVN", "OXY", "EOG",
  "NFLX", "VZ", "T", "TMUS", "DIS", "CHTR", "LYV",
  "AAPL", "CDNS", "FTNT", "ADSK", "NOW", "TYL", "PLTR",
  "NEM", "FCX", "SHW", "IFF", "STLD",
  "ETR", "EIX", "AMT", "VMRK", "WELL",
] as const;

export const EXCEPTION_KEEP = ["SPCX"] as const;

export const TRANSITION = ["IREN", "CIFR", "WULF", "APLD", "CORZ"] as const;

export const REMOVE = [
  "NVTS", "INTC", "AEHR", "LITE", "AAOI", "VIAV", "POET", "CRWV", "FLNC", "CEG", "TLN", "OKLO", "SMR", "CCJ", "LEU",
  "RKLB", "ASTS", "LUNR", "PL", "RDW", "VSAT", "FLY", "F", "KHC", "TTWO", "MOS", "APD",
] as const;

export const THEME_IDS = ["nuclear", "lossMaking", "transition", "other"] as const;
export type Round7bTheme = (typeof THEME_IDS)[number];

export const NUCLEAR = ["CEG", "TLN", "OKLO", "SMR", "CCJ", "LEU"] as const;
export const LOSS_MAKING = ["NVTS", "INTC", "AEHR", "AAOI", "POET", "CRWV", "FLNC", "RKLB", "ASTS", "LUNR", "PL", "RDW", "VSAT", "FLY"] as const;
export const OTHER_REMOVE = ["LITE", "VIAV", "F", "KHC", "TTWO", "MOS", "APD"] as const;

export const ROW_IDS = ["keepC", "keepTransitionC", "currentC", "currentA"] as const;
export type Round7bRowId = (typeof ROW_IDS)[number];
export type Round7bExit = "A" | "C";

const THEME_OF = new Map<string, Round7bTheme>();
for (const ticker of NUCLEAR) THEME_OF.set(ticker, "nuclear");
for (const ticker of LOSS_MAKING) THEME_OF.set(ticker, "lossMaking");
for (const ticker of TRANSITION) THEME_OF.set(ticker, "transition");
for (const ticker of OTHER_REMOVE) THEME_OF.set(ticker, "other");

export function themeOf(ticker: string): Round7bTheme | null {
  return THEME_OF.get(ticker) ?? null;
}

export function listOf(ticker: string): "keep" | "exception" | "transition" | "remove" | null {
  if ((KEEP as readonly string[]).includes(ticker)) return "keep";
  if ((EXCEPTION_KEEP as readonly string[]).includes(ticker)) return "exception";
  if ((TRANSITION as readonly string[]).includes(ticker)) return "transition";
  if ((REMOVE as readonly string[]).includes(ticker)) return "remove";
  return null;
}

/** KEEP+SPCX, KEEP+SPCX+TRANSITION, and the full traded current list. */
export function rowMembers(id: Round7bRowId): string[] {
  if (id === "keepC") return [...KEEP, ...EXCEPTION_KEEP];
  if (id === "keepTransitionC") return [...KEEP, ...EXCEPTION_KEEP, ...TRANSITION];
  return [...KEEP, ...EXCEPTION_KEEP, ...TRANSITION, ...REMOVE];
}

export type Round7bFill = {
  ticker: string;
  entryDate: string;
  exitDate: string;
  pnlUsd: number;
};

export type Round7bWorst = {
  ticker: string;
  entryDate: string;
  exitDate: string;
  pnlUsd: number;
};

export type Round7bCell = {
  exit: Round7bExit;
  universe: Round3Universe;
  window: Round3Window;
  n: number;
  wins: number;
  losses: number;
  flats: number;
  totalUsd: number;
  worst: Round7bWorst | null;
};

export type Round7bThemeTotal = Round7bCell & { theme: Round7bTheme };

export type Round7bName = {
  ticker: string;
  list: "transition" | "remove";
  theme: Round7bTheme;
  cells: Round7bCell[];
};

export type Round7bRow = {
  id: Round7bRowId;
  window: Round3Window;
  members: number;
  totalUsd: number;
  n: number;
  winRate: number | null;
  avgWinUsd: number | null;
  avgLossUsd: number | null;
  mtmDdUsd: number;
  meanUsd: number | null;
  meanNet190Usd: number | null;
  avgHold: number | null;
  exits: ExitTotals;
  investedFraction: number | null;
  scaledSpyUsd: number | null;
  spyTotalUsd: number;
  spyMtmDdUsd: number;
  spyRatio: number;
  ratio: number | null;
  nRequired: number | null;
};

export type Round7bReport = {
  v: 1;
  kind: "reference";
  hindsight: true;
  prereg: string;
  rulesCommit: string;
  round4Commit: string;
  round7Commit: string;
  generatedAt: string;
  lists: {
    keep: readonly string[];
    exceptionKeep: readonly string[];
    transition: readonly string[];
    remove: readonly string[];
  };
  themes: {
    nuclear: readonly string[];
    lossMaking: readonly string[];
    transition: readonly string[];
    other: readonly string[];
  };
  spy: typeof SPY_BENCH;
  rows: Round7bRow[];
  names: Round7bName[];
  themeTotals: Round7bThemeTotal[];
};

export function cellOf(fills: readonly Round7bFill[], exit: Round7bExit, universe: Round3Universe, window: Round3Window): Round7bCell {
  let wins = 0;
  let losses = 0;
  let flats = 0;
  let total = 0;
  let worst: Round7bWorst | null = null;
  for (const fill of fills) {
    total += fill.pnlUsd;
    if (fill.pnlUsd > 0) wins += 1;
    else if (fill.pnlUsd < 0) losses += 1;
    else flats += 1;
    if (!worst || fill.pnlUsd < worst.pnlUsd || (fill.pnlUsd === worst.pnlUsd && fill.entryDate < worst.entryDate)) {
      worst = { ticker: fill.ticker, entryDate: fill.entryDate, exitDate: fill.exitDate, pnlUsd: fill.pnlUsd };
    }
  }
  return {
    exit,
    universe,
    window,
    n: fills.length,
    wins,
    losses,
    flats,
    totalUsd: Math.round(total * 100) / 100,
    worst,
  };
}

/** Add cells that share an exit and a universe. Windows stay separate unless the caller passes one group. */
export function sumCells(cells: readonly Round7bCell[], exit: Round7bExit, universe: Round3Universe, window: Round3Window): Round7bCell {
  let n = 0;
  let wins = 0;
  let losses = 0;
  let flats = 0;
  let total = 0;
  let worst: Round7bWorst | null = null;
  for (const cell of cells) {
    n += cell.n;
    wins += cell.wins;
    losses += cell.losses;
    flats += cell.flats;
    total += cell.totalUsd;
    if (cell.worst && (!worst || cell.worst.pnlUsd < worst.pnlUsd || (cell.worst.pnlUsd === worst.pnlUsd && cell.worst.entryDate < worst.entryDate))) {
      worst = cell.worst;
    }
  }
  return { exit, universe, window, n, wins, losses, flats, totalUsd: Math.round(total * 100) / 100, worst };
}

export function themeTotals(names: readonly Round7bName[]): Round7bThemeTotal[] {
  const out: Round7bThemeTotal[] = [];
  for (const theme of THEME_IDS) {
    const mine = names.filter((name) => name.theme === theme);
    for (const exit of ["A", "C"] as const) {
      for (const universe of ["core", "pit", "adv"] as const) {
        for (const window of ["oos", "in"] as const) {
          const cells = mine.map((name) => {
            const cell = name.cells.find((item) => item.exit === exit && item.universe === universe && item.window === window);
            if (!cell) throw new Error(`セルがない ${theme} ${name.ticker} ${exit} ${universe} ${window}`);
            return cell;
          });
          out.push({ theme, ...sumCells(cells, exit, universe, window) });
        }
      }
    }
  }
  return out;
}

export { ROUND4_PREREG, SPY_BENCH };
