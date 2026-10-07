import { formatDev, formatPx } from "@/lib/format";
import type { MarketPayload } from "@/lib/types";
import { cn } from "@/lib/utils";

export function WeatherLine({ weather }: { weather: MarketPayload["weather"] }) {
  const soxx = weather.soxx;
  return (
    <section className="rounded-2xl border border-line bg-elev px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">半導体の天気</h2>
        {weather.cautious && (
          <span className="rounded-full bg-rust-soft px-2 py-0.5 text-[10px] text-rust">新規控えめ</span>
        )}
      </div>
      <p className="mt-1 text-[12px] leading-relaxed">
        SOXX{" "}
        {soxx ? (
          <>
            <span className="font-mono tabular-nums">{formatPx(soxx.close)}</span>
            {" / 20日線 "}
            <span className="font-mono tabular-nums">{formatPx(soxx.ma20)}</span>
            {" "}
            <span className={cn("font-mono tabular-nums", soxx.above ? "text-sage" : "text-rust")}>
              {soxx.above ? "上" : "下"} {formatDev(soxx.devPct)}
            </span>
          </>
        ) : (
          <span className="text-muted">20日線がまだない</span>
        )}
      </p>
      <p className="mt-1 text-[12px] leading-relaxed">
        {weather.checks.map((check) => (
          <span key={check.id} className="mr-3 inline-block">
            {check.label}{" "}
            <b className={cn(check.ok === false && "text-rust", check.ok === true && "text-sage")}>{check.detail}</b>
          </span>
        ))}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        RSP/SPY は比率が直近50営業日の平均以上なら ○。VIX は20未満なら ○。日足が無い項目は — で、新規控えめには数えない。
      </p>
      {weather.note && <p className="mt-1 text-[11px] text-muted">{weather.note}</p>}
      <div className="mt-2">
        <p className="text-[11px] text-muted">今後10営業日の半導体イベント（最大5件）</p>
        {weather.events.length === 0 ? (
          <p className="mt-1 text-[12px] text-muted">登録がない。決算以外は data/semi_events.json。</p>
        ) : (
          <ul className="mt-1 space-y-0.5 text-[12px]">
            {weather.events.map((event) => (
              <li key={`${event.date}:${event.label}`}>
                <span className="font-mono text-muted">{event.date}</span> {event.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
