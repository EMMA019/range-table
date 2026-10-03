import report from "../../data/backtest/round2.json";
import type { Verdict } from "@/lib/round2";
import { formatPnl } from "@/lib/format";
import { cn } from "@/lib/utils";

type WindowId = "oos" | "in";
type UniverseId = "pit" | "adv";

type WindowRow = {
  id: string;
  universe: UniverseId;
  window: WindowId;
  label: string;
  judged: boolean;
  n: number;
  totalUsd: number;
  mtmDdUsd: number;
  ratio: number | null;
  profitFactor: number | null;
  maxConsecLosses: number;
  realized10Share: number | null;
  ciLow: number | null;
  nRequired: number | null;
  verdict: Verdict;
};

type CandidateRow = {
  id: string;
  universe: UniverseId;
  label: string;
  verdict: Verdict;
  windows: WindowRow[];
};

type Round2Report = {
  preregCommit: string;
  generatedAt: string;
  spy: Array<{ window: WindowId; totalUsd: number; mtmDdUsd: number; ratio: number; publishedUsd: number }>;
  publishedAdv: { oos: number; in: number };
  gaps: string[];
  summary: Array<{ id: string; verdict: Verdict }>;
  candidates: CandidateRow[];
};

const data = report as Round2Report;

const VERDICT: Record<Verdict, string> = {
  pass: "合格",
  fail: "不合格",
  hold: "保留",
  "not-judged": "未判定",
};

const UNIVERSE: Record<UniverseId, string> = {
  pit: "当時の500+400",
  adv: "売買代金上位200",
};

const WINDOW: Record<WindowId, string> = {
  oos: "2022-10〜2024-10",
  in: "2024-10〜2026-10",
};

const ORDER = ["A1", "A2", "S1", "S2", "N1", "B0", "A1p", "A2p"];

function money(value: number | null | undefined): string {
  return value == null ? "—" : formatPnl(value);
}

function count(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function tone(verdict: Verdict): string {
  if (verdict === "pass") return "text-sage";
  if (verdict === "fail") return "text-rust";
  return "text-muted";
}

function spyFor(window: WindowId) {
  return data.spy.find((row) => row.window === window);
}

function WindowLine({ row }: { row: WindowRow }) {
  const spy = spyFor(row.window);
  return (
    <div className="border-t border-line py-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span>{WINDOW[row.window]}</span>
        <span className="shrink-0 text-right tabular-nums">
          {money(row.totalUsd)}
          <span className={cn("ml-2", tone(row.verdict))}>{VERDICT[row.verdict]}</span>
        </span>
      </div>
      <p className="text-[10px] leading-relaxed text-muted">
        {row.n}回 · PF {row.profitFactor == null ? "—" : row.profitFactor.toFixed(2)} · 最大DD {money(row.mtmDdUsd)} · 比率{" "}
        {row.ratio == null ? "—" : row.ratio.toFixed(2)}
        {spy ? `（SPY ${spy.ratio.toFixed(2)}）` : ""} · CI下限 {money(row.ciLow)} · N {count(row.nRequired)} · 連敗 {row.maxConsecLosses} · $10以上の日{" "}
        {row.realized10Share == null ? "—" : `${Math.round(row.realized10Share * 100)}%`}
      </p>
    </div>
  );
}

/** Round-2 pass, fail, and hold. Analysis only. */
export function Round2Section() {
  const made = data.generatedAt.slice(0, 10);
  const byId = new Map<string, CandidateRow[]>();
  for (const row of data.candidates) {
    const list = byId.get(row.id) ?? [];
    list.push(row);
    byId.set(row.id, list);
  }
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-line bg-elev px-3 py-3 shadow-[var(--shadow)]">
        <h2 className="text-sm font-medium">第2ラウンド</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          事前登録 {data.preregCommit.slice(0, 7)}。作成 {made}。ライブの通知とペーパーのルールは変えていない。A1は決算反応日で見る。8-K Item 2.02の受付が16:00 ET以降なら翌営業日、09:30より前ならその日、場中ならその日。ギャップ、陽線、出来高はその日。入りは翌日の始値。損切りはその日の安値。
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          合格は、両方の期間で合計がプラス、合計÷最大DDが同じ手数料のSPYより大きい、1回あたり期待値の下側98%がプラス、件数nが必要件数N以上。プラスでもnがN未満は保留。A1&apos;とA2&apos;は元が合格したユニバースだけ判定する。Novaは未実施。
        </p>
        <ul className="mt-2 space-y-1 text-xs">
          {data.summary.map((row) => (
            <li key={row.id} className="flex items-baseline justify-between gap-3 border-t border-line py-1">
              <span>{row.id === "A1p" ? "A1'" : row.id === "A2p" ? "A2'" : row.id}</span>
              <span className={cn("tabular-nums", tone(row.verdict))}>{VERDICT[row.verdict]}</span>
            </li>
          ))}
          <li className="flex items-baseline justify-between gap-3 border-t border-line py-1">
            <span>Nova</span>
            <span className="text-muted">未実施</span>
          </li>
        </ul>
        {data.spy.map((row) => (
          <p key={row.window} className="mt-2 text-[11px] leading-relaxed text-muted">
            SPY買い持ち {WINDOW[row.window]} {money(row.totalUsd)}、最大DD {money(row.mtmDdUsd)}、比率 {row.ratio.toFixed(2)}。公開値 {money(row.publishedUsd)}。
          </p>
        ))}
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          公開の売買代金上位200の箱は {WINDOW.oos} {money(data.publishedAdv.oos)}、{WINDOW.in} {money(data.publishedAdv.in)}。手数料は往復$0.70で、価格の上限はなく、決算の前後と半導体の上限がある。下のB0は今回の手数料と$550未満で、判定していない。
        </p>
      </section>

      {ORDER.map((id) => {
        const rows = byId.get(id) ?? [];
        if (!rows.length) return null;
        const name = id === "A1p" ? "A1'" : id === "A2p" ? "A2'" : id;
        return (
          <section key={id} className="rounded-2xl border border-line bg-elev px-3 py-3 shadow-[var(--shadow)]">
            <h2 className="text-sm font-medium">
              {name} {rows[0].label}
            </h2>
            {rows.map((row) => (
              <div key={`${row.id}-${row.universe}`} className="mt-2">
                <p className="text-xs">
                  {UNIVERSE[row.universe]}
                  <span className={cn("ml-2", tone(row.verdict))}>{VERDICT[row.verdict]}</span>
                </p>
                {row.windows.map((window) => (
                  <WindowLine key={`${window.universe}-${window.window}`} row={window} />
                ))}
              </div>
            ))}
          </section>
        );
      })}

      <section>
        <h2 className="mb-1 text-sm font-medium">このラウンドで埋まらなかったところ</h2>
        <ul className="list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-muted">
          {data.gaps.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
