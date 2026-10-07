/**
 * Policy figures for the defense line and the account center.
 * HOLDINGS_JSON may override either number. Share counts stay in that secret.
 */
export const DEFAULT_DEFENSE_LINE_JPY = 500_000;
export const DEFAULT_ACCOUNT_CENTER_JPY = 519_000;

export function policyLevels(override: {
  defenseLineJpy?: number | null;
  accountCenterJpy?: number | null;
}): { defenseLineJpy: number; accountCenterJpy: number; cushionJpy: number } {
  const defenseLineJpy =
    override.defenseLineJpy != null && override.defenseLineJpy > 0
      ? override.defenseLineJpy
      : DEFAULT_DEFENSE_LINE_JPY;
  const accountCenterJpy =
    override.accountCenterJpy != null && override.accountCenterJpy > 0
      ? override.accountCenterJpy
      : DEFAULT_ACCOUNT_CENTER_JPY;
  return {
    defenseLineJpy,
    accountCenterJpy,
    cushionJpy: accountCenterJpy - defenseLineJpy,
  };
}

/** Yen left of the policy cushion after a dollar loss. Null until the yen rate is known. */
export function cushionAfterLoss(cushionJpy: number, lossUsd: number | null, usdJpy: number | null): number | null {
  if (lossUsd == null || usdJpy == null) return null;
  return Math.round(cushionJpy - lossUsd * usdJpy);
}
