import { formatBox } from "@/lib/format";

/** Last few sessions of box position, oldest on the left. 0% is the bottom of the drawing. */
export function BoxSpark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 88;
  const h = 28;
  const pad = 2;
  const points = values.map((value, index) => {
    const x = pad + (index * (w - pad * 2)) / (values.length - 1);
    const clamped = Math.min(100, Math.max(0, value));
    const y = pad + (1 - clamped / 100) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const first = values[0];
  const last = values[values.length - 1];
  const stroke = last > first ? "var(--sage)" : last < first ? "var(--rust)" : "var(--muted)";
  const label = `直近${values.length}日の箱の位置 ${values.map((value) => formatBox(value)).join("、")}`;
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={label}
      className="shrink-0"
    >
      <polyline fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" points={points.join(" ")} />
    </svg>
  );
}
