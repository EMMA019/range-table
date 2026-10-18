/**
 * Theme exclusion lists for offline studies. Mirrors `src/lib/themes.ts` and the
 * queued PR #39 site change (space theme + CORZ on crypto). SPCX is never excluded.
 */
import type { Watchlist } from "./types";

export const THEME_KEEP = "SPCX";

export const SOLAR = ["ENPH", "SEDG", "FSLR", "RUN", "ARRY", "NXT", "SHLS", "CSIQ", "JKS", "SPWR", "MAXN", "NOVA"] as const;

/** Crypto plus BTC miners and hosting (CORZ is on the watchlist under cloud). */
export const CRYPTO = [
  "COIN",
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
 * Space names excluded even when profitable. Watchlist group `space` minus SPCX is merged in
 * `themeExclusionSet`. BKSY and SPCE are named in the prereg though not on the watchlist today.
 */
export const SPACE_STATIC = ["RKLB", "ASTS", "LUNR", "PL", "RDW", "IRDM", "VSAT", "FLY", "BKSY", "SPCE"] as const;

export type ThemeBucket = "solar" | "crypto" | "nuclear" | "quantum" | "space";

const BUCKETS: Record<Exclude<ThemeBucket, "space">, readonly string[]> = {
  solar: SOLAR,
  crypto: CRYPTO,
  nuclear: NUCLEAR,
  quantum: QUANTUM,
};

export function themeBucketOf(ticker: string): ThemeBucket | null {
  const key = ticker.trim().toUpperCase();
  if (key === THEME_KEEP) return null;
  for (const name of ["nuclear", "crypto", "solar", "quantum"] as const) {
    if (BUCKETS[name].includes(key)) return name;
  }
  if (SPACE_STATIC.includes(key as (typeof SPACE_STATIC)[number])) return "space";
  return null;
}

/** Full exclusion set for the round-17 universe (sorted tickers for reports). */
export function themeExclusionSet(watch: Watchlist): { set: Set<string>; spaceFromWatchlist: string[] } {
  const set = new Set<string>([...SOLAR, ...CRYPTO, ...NUCLEAR, ...QUANTUM, ...SPACE_STATIC]);
  const spaceFromWatchlist: string[] = [];
  for (const group of watch.groups) {
    if (group.id !== "space") continue;
    for (const row of group.tickers) {
      const t = row.ticker.trim().toUpperCase();
      if (t === THEME_KEEP) continue;
      spaceFromWatchlist.push(t);
      set.add(t);
    }
  }
  spaceFromWatchlist.sort();
  set.delete(THEME_KEEP);
  return { set, spaceFromWatchlist };
}

export function sortedExclusionLists(watch: Watchlist): {
  solar: string[];
  crypto: string[];
  nuclear: string[];
  quantum: string[];
  space: string[];
  spaceWatchlist: string[];
} {
  const { spaceFromWatchlist } = themeExclusionSet(watch);
  const space = [...new Set([...SPACE_STATIC, ...spaceFromWatchlist])].filter((t) => t !== THEME_KEEP).sort();
  return {
    solar: [...SOLAR].sort(),
    crypto: [...CRYPTO].sort(),
    nuclear: [...NUCLEAR].sort(),
    quantum: [...QUANTUM].sort(),
    space,
    spaceWatchlist: spaceFromWatchlist,
  };
}
