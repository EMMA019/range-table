import report from "../../data/backtest/stops.json";
import { formatPnl } from "@/lib/format";
import type { StopId, StopReport, StopRow, StopUniverseId, StopWindowId } from "@/lib/stops";

const data = report as StopReport;

const STOP: Record<StopId, string> = {
  low: "20日安値",
  pct5: "半導体は安値の95%",
  pct10: "半導体は安値の90%",
  atr15: "半導体は安値−1.5ATR",
};

const UNIVERSE: Record<StopUniverseId, string> = {
  core: "今の187",
  pit: "当時の500+400",
  adv: "売買代金上位200",
};

const WINDOW: Record<StopWindowId, string> = {
  oos: "2022-10〜2024-10",
  in: "2024-10〜2026-10",
};

function pct(value: number | null): string {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function money(value: number | null): string {
  return value == null ? "—" : formatPnl(value);
}

function line(row: StopRow): string {
  return `${STOP[row.id]} ${formatPnl(row.totalUsd)}、最悪 ${money(row.worstUsd)}、${row.n}回、勝率 ${pct(row.winRate)}、+$10の取引 ${pct(row.trades10Share)}、+$10の日 ${pct(row.daysMtm10Share)}、最大DD ${formatPnl(row.mtmDdUsd)}。半導体 ${row.semis.n}回 ${formatPnl(row.semis.totalUsd)}、最悪 ${money(row.semis.worstUsd)}。`;
}

/** Stop comparison for the no-earnings bridge book. Analysis only. */
export function StopsSection() {
  const made = data.generatedAt.slice(0, 10);
  return (
    <section className="rounded-2xl border border-line bg-elev px-3 py-3 shadow-[var(--shadow)]">
      <h2 className="text-sm font-medium">損切りの比較</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        事前登録 {data.rulesCommit.slice(0, 7)}。作成 {made}。決算の見送りはなく、半導体は同時2枠。変えたのは損切りだけ。半導体は、今の187では半導体と装置、当時の指数と売買代金上位ではGICSにsemiconductorを含む業種。20日安値の本は2024-10〜2026-10の今の187で{formatPnl(1304.86)}。
      </p>
      {(["core", "pit", "adv"] as const).map((universe) => (
        <div key={universe} className="mt-2">
          <p className="text-xs">{UNIVERSE[universe]}</p>
          {(["oos", "in"] as const).map((window) => (
            <div key={window} className="mt-1 border-t border-line pt-1 text-[11px] leading-relaxed text-muted">
              <p>{WINDOW[window]}</p>
              {data.rows
                .filter((row) => row.universe === universe && row.window === window)
                .map((row) => (
                  <p key={row.id} className="mt-1">
                    {line(row)}
                  </p>
                ))}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
