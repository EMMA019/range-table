/**
 * Theme names greyed on the morning screen.
 * Solar, crypto, and nuclear match the round-12 lists. Quantum was added because Emma asked for it on 2026-10-04.
 * QMCO is Quantum Corporation, a storage company, and is not on the quantum list.
 * SPCX stays off every list.
 */
export const SOLAR = ["ENPH", "SEDG", "FSLR", "RUN", "ARRY", "NXT", "SHLS", "CSIQ", "JKS", "SPWR", "MAXN", "NOVA"] as const;
export const CRYPTO = ["COIN", "MSTR", "MARA", "RIOT", "CLSK", "HUT", "IREN", "CIFR", "WULF", "BTDR", "BITF"] as const;
export const NUCLEAR = ["CEG", "TLN", "OKLO", "SMR", "CCJ", "LEU", "NNE", "BWXT"] as const;
export const QUANTUM = ["IONQ", "RGTI", "QBTS", "QUBT", "ARQQ"] as const;

export const THEME_KEEP = "SPCX";

export type ThemeName = "solar" | "crypto" | "nuclear" | "quantum";

const LISTS: Record<ThemeName, readonly string[]> = {
  solar: SOLAR,
  crypto: CRYPTO,
  nuclear: NUCLEAR,
  quantum: QUANTUM,
};

export function themeOf(ticker: string): ThemeName | null {
  const key = ticker.trim().toUpperCase();
  if (key === THEME_KEEP) return null;
  for (const name of ["nuclear", "crypto", "solar", "quantum"] as const) {
    if (LISTS[name].includes(key)) return name;
  }
  return null;
}
