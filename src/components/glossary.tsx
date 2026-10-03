import { BASIS } from "@/lib/copy";

const ITEMS = [
  ["終値", BASIS.close],
  ["20日線", BASIS.ma20],
  ["20日線の傾き", BASIS.slope],
  ["乖離", BASIS.dev],
  ["20日安値", BASIS.low20],
  ["20日高値", BASIS.high20],
  ["箱の位置", BASIS.box],
  ["15%・25%ラインと反発", BASIS.guide],
  ["IN OK!", BASIS.entryInOk],
  ["まだ早いよ！", BASIS.entryEarly],
  ["追いかけ注意", BASIS.entryChase],
  ["新規は遅いよ", BASIS.entryLate],
  ["ATR(14)", BASIS.atr],
  ["$10株数", BASIS.shares10],
  ["上抜け", BASIS.breakout],
  ["決算までの営業日", BASIS.earnings],
  ["対SPY", BASIS.rs],
  ["実績PER", BASIS.trailingPe],
  ["予想PER", BASIS.forwardPe],
  ["利益回復中", BASIS.recovering],
  ["出来高", BASIS.volume],
  ["相関", BASIS.corr],
] as const;

export function Glossary({ className = "" }: { className?: string }) {
  return (
    <details className={`rounded-2xl border border-line bg-elev px-4 py-1 ${className}`}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center text-sm font-medium">
        数値の根拠
      </summary>
      <dl className="space-y-3 pb-3 text-xs leading-relaxed">
        {ITEMS.map(([label, basis]) => (
          <div key={label}>
            <dt className="font-medium text-ink">{label}</dt>
            <dd className="text-muted">{basis}</dd>
          </div>
        ))}
        <div>
          <dt className="font-medium text-ink">価格が飛んでいる</dt>
          <dd className="text-muted">
            直近20本のあいだに、終値が前日終値から35%以上動いた日がある。分割やスピンオフだと箱が歪む。
          </dd>
        </div>
      </dl>
    </details>
  );
}
