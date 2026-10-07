/**
 * Theme names greyed on the morning screen and blocked on the default buy screen.
 * Solar, crypto, and nuclear match the round-12 lists. Quantum was added on 2026-10-04.
 * Space and crypto miner/hosting expansions were added on 2026-10-04 (Emma).
 * QMCO is Quantum Corporation (storage), not on the quantum list.
 * SPCX stays off every list.
 */
export const SOLAR = ["ENPH", "SEDG", "FSLR", "RUN", "ARRY", "NXT", "SHLS", "CSIQ", "JKS", "SPWR", "MAXN", "NOVA"] as const;

/** BTC miners, crypto proxies, brokers, and mining-to-hosting pivots (watchlist cloud group where noted). */
export const CRYPTO = [
  "COIN",
  "HOOD",
  "MSTR",
  "MARA",
  "RIOT",
  "CLSK",
  "HUT",
  "IREN",
  "CIFR",
  "WULF",
  "BTDR",
  "BITF",
  "CORZ",
] as const;

export const NUCLEAR = ["CEG", "TLN", "OKLO", "SMR", "CCJ", "LEU", "NNE", "BWXT"] as const;
export const QUANTUM = ["IONQ", "RGTI", "QBTS", "QUBT", "ARQQ"] as const;

/**
 * Space / launch / satellite names — excluded even when profitable. SPCX is the only keep.
 * Matches watchlist group `space` except SPCX, plus BKSY/SPCE (named before yaml entry).
 * GSAT: Globalstar satellite connectivity; not on the watchlist but same theme as IRDM/VSAT.
 */
export const SPACE = [
  "RKLB",
  "ASTS",
  "LUNR",
  "PL",
  "RDW",
  "IRDM",
  "VSAT",
  "FLY",
  "BKSY",
  "SPCE",
  "GSAT",
] as const;

export const THEME_KEEP = "SPCX";

export type ThemeName = "solar" | "crypto" | "nuclear" | "quantum" | "space";

const LISTS: Record<ThemeName, readonly string[]> = {
  solar: SOLAR,
  crypto: CRYPTO,
  nuclear: NUCLEAR,
  quantum: QUANTUM,
  space: SPACE,
};

export function themeOf(ticker: string): ThemeName | null {
  const key = ticker.trim().toUpperCase();
  if (key === THEME_KEEP) return null;
  for (const name of ["space", "nuclear", "crypto", "solar", "quantum"] as const) {
    if (LISTS[name].includes(key)) return name;
  }
  return null;
}
