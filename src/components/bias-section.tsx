import type { ReactNode } from "react";
import report from "../../data/backtest/bias.json";
import type { BiasReport, SlimBook } from "@/lib/bias";
import { formatPnl } from "@/lib/format";
import { cn } from "@/lib/utils";

const data = report as unknown as BiasReport;

const MAIN = ["core", "pit", "exsemi", "free", "jab", "mid", "rs-rsp", "rs-sector"];
const REGIME = ["reg-soxx-out", "reg-soxx-under", "reg-iwm-down", "reg-iwm-up", "reg-breadth-above", "reg-breadth-below", "filt-rsp50", "filt-iwm50"];
const EXTRA = ["adv", "sector", "etf3", "etf1", "earn-full", "iwm-members", "adv-all"];

function money(value: number | null | undefined): string {
  return value == null ? "未計算" : formatPnl(value);
}

function pf(value: number | null | undefined): string {
  return value == null ? "未計算" : value.toFixed(2);
}

function flag(value: boolean | null | undefined): string {
  if (value == null) return "PFは判定できない";
  return value ? "PF>1" : "PFは1以下";
}

function Card({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-elev px-3 py-3 shadow-[var(--shadow)]">
      <h2 className="text-sm font-medium">{title}</h2>
      {note ? <p className="mt-1 text-[11px] leading-relaxed text-muted">{note}</p> : null}
      {children}
    </section>
  );
}

function Line({ row }: { row: SlimBook }) {
  const tone = row.totalUsd == null ? "" : row.totalUsd > 0 ? "text-sage" : row.totalUsd < 0 ? "text-rust" : "";
  return (
    <div className="border-t border-line py-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="min-w-0">{row.label}</span>
        <span className={cn("shrink-0 tabular-nums", tone)}>{money(row.totalUsd)}</span>
      </div>
      <p className="text-[10px] leading-relaxed text-muted">
        {row.n == null ? "未計算" : `${row.n}回`}
        {row.mtmDdUsd == null ? "" : ` · 最大DD ${money(row.mtmDdUsd)}`}
        {row.n == null ? "" : ` · PF ${pf(row.profitFactor)}`}
        {row.note ? ` · ${row.note}` : ""}
      </p>
      {row.headline ? (
        <p className="text-[10px] leading-relaxed text-muted">
          見出し（買収は最終値、破綻・不明は-50%） {money(row.headline.totalUsd)} · PF {pf(row.headline.profitFactor)} · {flag(row.headline.profitable)} · 罰則 {row.headline.penalized}件（買収 {row.headline.acquisitions}、破綻 {row.headline.bankruptcies}、不明 {row.headline.unknown}）
        </p>
      ) : null}
      {row.stress ? (
        <p className="text-[10px] leading-relaxed text-muted">
          ストレス（途中終了をすべて-100%） {money(row.stress.totalUsd)} · PF {pf(row.stress.profitFactor)} · {flag(row.stress.profitable)}
        </p>
      ) : null}
    </div>
  );
}

function Rows({ window, ids }: { window: "oos" | "in"; ids: string[] }) {
  const rows = ids.flatMap((id) => data.books.filter((row) => row.window === window && row.id === id));
  return (
    <div>
      {rows.map((row) => (
        <Line key={`${row.window}-${row.id}`} row={row} />
      ))}
    </div>
  );
}

/** Survivorship, sector, liquidity, and bellwether checks. Analysis only. */
export function BiasSection() {
  const made = data.generatedAt.slice(0, 10);
  return (
    <div className="space-y-4">
      <Card title="生存バイアスと半導体" note={data.rules}>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          期間外 {data.windows.oos.from}〜{data.windows.oos.to}、期間内 {data.windows.in.from}〜{data.windows.in.to}。作成 {made}。数値が出ていない行は未計算。
        </p>
        {data.bias.map((row) => (
          <div key={row.window} className="mt-2 border-t border-line pt-2 text-xs">
            <p className="font-medium">{row.window === "oos" ? "2022-10〜2024-10" : "2024-10〜2026-10"}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              今の187銘柄 {money(row.coreUsd)}、当時の500+400 {money(row.pitUsd)}、半導体を除く {money(row.exSemiUsd)}。
            </p>
            <p className="mt-1 text-[11px] leading-relaxed">
              生存バイアス（187−当時） {money(row.survivorship)}。半導体の追い風（当時−半導体なし） {money(row.semisTailwind)}。
            </p>
          </div>
        ))}
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          同じ期間の買い持ちで一番大きかったのは
          {data.bestBenchmark.map((row) => ` ${row.window === "oos" ? "期間外" : "期間内"} ${row.id} ${money(row.totalUsd)}`).join("、")}
          。
        </p>
        {data.bridge ? (
          <div className="mt-2 border-t border-line pt-2 text-[11px] leading-relaxed text-muted">
            <p>
              公開の{money(data.bridge.fromUsd)}（2024-10〜2026-10、対SPY）から、この欄の{money(data.bridge.toUsd)}までの差は次の順。
            </p>
            {data.bridge.steps.map((step, index) => (
              <p key={step.label} className="mt-1">
                {index + 1}. {step.label}。{step.n}件、{money(step.totalUsd)}
                {index === 0 ? "" : `（${money(step.deltaUsd)}）`}。
              </p>
            ))}
            <p className="mt-1">
              {data.bridge.side.label}。{data.bridge.side.n}件、{money(data.bridge.side.totalUsd)}（{money(data.bridge.side.deltaUsd)}）。
            </p>
            <p className="mt-1">
              $550の上限を外しても公開の本は{money(data.bridge.unchanged.dropCapUsd)}のまま。上限を外したこの欄のルールも{money(data.bridge.unchanged.dropCapOnStackedUsd)}。ATRは両方3%以上。手数料は往復$0.70、1枠$300–$450、資金$3,200、枠は5つ。最終足は{data.bridge.lastBar}で、2026-10-02はセッションがない。ウォッチリストは{data.bridge.namesInFile}行で、{data.bridge.ignored}は両方から外した{data.bridge.namesTraded}銘柄。Item 2.02が無い{data.bridge.withoutItem202}銘柄のシグナルは残している。
            </p>
          </div>
        ) : null}
        {(["oos", "in"] as const).map((window) => {
          const rows = data.books.filter((row) => row.window === window && row.n != null);
          const count = (ok: (row: (typeof rows)[number]) => boolean) => rows.filter(ok).length;
          return (
            <p key={window} className="mt-2 text-[11px] leading-relaxed text-muted">
              {window === "oos" ? "期間外" : "期間内"}の計算できたブック {rows.length}本。PF&gt;1 は {count((row) => (row.profitFactor ?? 0) > 1)}本。見出しの罰則のあと {count((row) => row.headline?.profitable === true)}本。ストレス（-100%）のあと {count((row) => row.stress?.profitable === true)}本。
            </p>
          );
        })}
      </Card>

      {(["oos", "in"] as const).map((window) => (
        <Card key={window} title={window === "oos" ? "2022-10〜2024-10のブック" : "2024-10〜2026-10のブック"}>
          <Rows window={window} ids={MAIN} />
          <details className="mt-2">
            <summary className="min-h-11 cursor-pointer text-xs leading-[2.75rem] text-muted">相場の分け方とフィルター</summary>
            <Rows window={window} ids={REGIME} />
          </details>
          <details>
            <summary className="min-h-11 cursor-pointer text-xs leading-[2.75rem] text-muted">売買代金・セクター・ETF</summary>
            <Rows window={window} ids={EXTRA} />
          </details>
        </Card>
      ))}

      <Card title="ベルウェザーの決算" note={data.bellwether.note}>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          {Object.entries(data.bellwether.dates)
            .map(([ticker, dates]) => `${ticker} ${dates.length}件`)
            .join("、")}
          。欠けている銘柄: {data.bellwether.missing.length ? data.bellwether.missing.join("、") : "なし"}。
        </p>
        {data.bellwether.byWindow.map((row) => (
          <div key={row.window} className="mt-2 border-t border-line pt-2 text-[11px] leading-relaxed text-muted">
            <p className="text-xs">{row.window === "oos" ? "2022-10〜2024-10" : "2024-10〜2026-10"}</p>
            <p>
              半導体の約定で決算日をまたいだ {row.span ? `${row.span.n}回 ${money(row.span.totalUsd)}` : "未計算"}。またがない {row.clear ? `${row.clear.n}回 ${money(row.clear.totalUsd)}` : "未計算"}。
            </p>
            <p>
              そのまま {row.base ? `${row.base.n}回 ${money(row.base.totalUsd)}、最大DD ${money(row.base.mtmDdUsd)}` : "未計算"}。3営業日前の半導体新規を避けた場合 {row.avoid ? `${row.avoid.n}回 ${money(row.avoid.totalUsd)}、最大DD ${money(row.avoid.mtmDdUsd)}` : "未計算"}。
            </p>
          </div>
        ))}
      </Card>

      <Card title="乱数の順位" note="1000回の並べ替えには、日足が途中で尽きた建玉の罰則は掛けていない。">
        {data.random.map((row) => (
          <p key={row.window} className="mt-2 border-t border-line pt-2 text-[11px] leading-relaxed text-muted">
            {row.window === "oos" ? "2022-10〜2024-10" : "2024-10〜2026-10"}:{" "}
            {row.trials == null
              ? `未計算。${row.note ?? ""}`
              : `${row.trials}回の平均 ${money(row.mean)}、中央値 ${money(row.p50)}、5%点 ${money(row.p05)}、95%点 ${money(row.p95)}。対SPY ${money(row.ruleUsd)} より小さい結果は ${row.percentile == null ? "未計算" : `${row.percentile}%`}。`}
          </p>
        ))}
      </Card>

      <details className="rounded-2xl border border-line bg-elev px-3 py-3">
        <summary className="min-h-11 cursor-pointer text-sm font-medium leading-[2.75rem]">セクターごとの結果</summary>
        {data.sectors.map((row) => (
          <div key={`${row.window}-${row.etf}`} className="border-t border-line py-1.5 text-xs">
            <div className="flex items-baseline justify-between gap-3">
              <span>
                {row.window === "oos" ? "22-24" : "24-26"} {row.etf}
                <span className="ml-1 text-[10px] text-muted">
                  {row.names.length}銘柄 / 保有{row.holdings} / 売買代金{row.withAdv}
                </span>
              </span>
              <span className="tabular-nums">{money(row.totalUsd)}</span>
            </div>
            <p className="text-[10px] leading-relaxed text-muted">
              {row.n == null ? "未計算" : `${row.n}回`}
              {row.mtmDdUsd == null ? "" : ` · 最大DD ${money(row.mtmDdUsd)}`}
              {row.n == null ? "" : ` · PF ${pf(row.profitFactor)}`}
              {row.headline ? ` · 見出し ${money(row.headline.totalUsd)} PF ${pf(row.headline.profitFactor)} ${flag(row.headline.profitable)}` : ""}
              {row.stress ? ` · ストレス ${money(row.stress.totalUsd)} PF ${pf(row.stress.profitFactor)}` : ""}
              {row.names.length ? ` · ${row.names.join(" ")}` : ""}
            </p>
          </div>
        ))}
      </details>

      <details className="rounded-2xl border border-line bg-elev px-3 py-3">
        <summary className="min-h-11 cursor-pointer text-sm font-medium leading-[2.75rem]">買い持ちのベンチマーク</summary>
        {data.benchmarks.map((row) => (
          <div key={`${row.window}-${row.id}`} className="flex items-baseline justify-between gap-3 border-t border-line py-1.5 text-xs">
            <span>
              {row.window === "oos" ? "22-24" : "24-26"} {row.label}
            </span>
            <span className="text-right tabular-nums">
              {money(row.totalUsd)}
              <span className="block text-[10px] text-muted">
                {row.mtmDdUsd == null ? "" : `DD ${money(row.mtmDdUsd)}`}
                {row.n == null ? "" : ` PF ${pf(row.profitFactor)}`}
              </span>
            </span>
          </div>
        ))}
      </details>

      <section>
        <h2 className="mb-1 text-sm font-medium">この検証で埋まらなかったところ</h2>
        <ul className="list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-muted">
          {data.gaps.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
