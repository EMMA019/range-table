import { formatCorr } from "@/lib/format";
import type { MarketPayload } from "@/lib/types";

const DEMAND_LABEL = {
  strengthened: "強まった",
  weakened: "弱まった",
  unchanged: "変わらず",
} as const;

export function ThemeWatch({
  demand,
  slots,
  month,
}: {
  demand: MarketPayload["themeDemand"];
  slots: MarketPayload["themeSlots"];
  month: string | null;
}) {
  return (
    <section className="space-y-3">
      <div className="rounded-2xl border border-line bg-elev px-3 py-3">
        <h2 className="text-sm font-medium">テーマ需要（週次）</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          {demand.asOf ? `記録日 ${demand.asOf}` : "記録日はまだない"}。強弱は data/theme_demand.json に書いたときだけ出す。
        </p>
        {demand.signals.length === 0 ? (
          <p className="mt-2 text-[12px] text-muted">シグナルが未登録。</p>
        ) : (
          <ul className="mt-2 space-y-1 text-[12px]">
            {demand.signals.map((signal) => (
              <li key={signal.id} className="flex items-baseline justify-between gap-3">
                <span>{signal.label}</span>
                <span className="text-muted">{signal.change ? DEMAND_LABEL[signal.change] : "未記録"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rounded-2xl border border-line bg-elev px-3 py-3">
        <h2 className="text-sm font-medium">テーマ監視枠{month ? `（${month}）` : ""}</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          S&P500の電力・冷却・ネットワーキング・エッジ。SOXX相関が0.30以下は防衛枠の監視候補。発注しない。
        </p>
        {slots.length === 0 ? (
          <p className="mt-2 text-[12px] text-muted">指数の日足が揃うと一覧が出る。銘柄リストは data/theme_slots.json。</p>
        ) : (
          <ul className="mt-2 space-y-1 text-[12px]">
            {slots.map((row) => (
              <li key={`${row.theme}:${row.ticker}`} className="flex items-baseline justify-between gap-3">
                <span>
                  <span className="font-mono">{row.ticker}</span>
                  <span className="text-muted"> · {row.themeLabel}</span>
                  {row.lowCorr && <span className="ml-1 text-sage">防衛枠の監視候補</span>}
                </span>
                <span className="font-mono tabular-nums">{row.corrSoxx == null ? "—" : formatCorr(row.corrSoxx)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
