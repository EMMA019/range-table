"use client";

import { useId, useMemo, useRef, useState } from "react";
import { formatPx, shortDate } from "@/lib/format";
import type { ChartBar } from "@/lib/types";

type Props = {
  bars: ChartBar[];
  low20: number;
  high20: number;
};

type Label = { y: number; title: string; value: string };

export function PriceChart({ bars, low20, high20 }: Props) {
  const titleId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const geom = useMemo(() => layout(bars, low20, high20), [bars, low20, high20]);
  const shown = bars[active ?? bars.length - 1];

  function pick(clientX: number) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const vbX = ((clientX - rect.left) / rect.width) * geom.vbW;
    let best = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    geom.xs.forEach((x, index) => {
      const dist = Math.abs(x - vbX);
      if (dist < bestDist) {
        best = index;
        bestDist = dist;
      }
    });
    setActive(best);
  }

  return (
    <figure className="mt-4">
      <figcaption id={titleId} className="text-sm font-medium">
        日足 {bars.length}本
        <span className="ml-2 font-normal text-muted">およそ3か月。帯は直近20本</span>
      </figcaption>
      {shown && (
        <p className="mt-2 font-mono text-[11px] leading-relaxed tabular-nums text-muted">
          <span className="text-ink">{shortDate(shown.date)}</span>
          {"  "}始値 {formatPx(shown.open)}
          {"  "}高値 {formatPx(shown.high)}
          {"  "}安値 {formatPx(shown.low)}
          {"  "}終値 {formatPx(shown.close)}
          {shown.ma20 != null && <>{"  "}20日線 {formatPx(shown.ma20)}</>}
        </p>
      )}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${geom.vbW} ${geom.vbH}`}
        className="mt-2 h-auto w-full touch-none"
        role="img"
        aria-labelledby={titleId}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          pick(event.clientX);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) pick(event.clientX);
        }}
      >
        <rect
          x={geom.bandX}
          y={geom.padT}
          width={geom.bandW}
          height={geom.innerH}
          fill="var(--copper-soft)"
          opacity="0.55"
        />
        <line
          x1={geom.padL}
          x2={geom.plotR}
          y1={geom.highY}
          y2={geom.highY}
          stroke="var(--sage)"
          strokeDasharray="3 3"
          strokeWidth="1"
        />
        <line
          x1={geom.padL}
          x2={geom.plotR}
          y1={geom.lowY}
          y2={geom.lowY}
          stroke="var(--copper)"
          strokeDasharray="3 3"
          strokeWidth="1"
        />
        {geom.maPath && (
          <path d={geom.maPath} fill="none" stroke="var(--copper)" strokeWidth="1.4" />
        )}
        {geom.candles.map((candle) => (
          <g key={candle.date}>
            <line
              x1={candle.x}
              x2={candle.x}
              y1={candle.yHigh}
              y2={candle.yLow}
              stroke={candle.up ? "var(--sage)" : "var(--rust)"}
              strokeWidth="1"
            />
            <rect
              x={candle.x - candle.w / 2}
              y={candle.yBody}
              width={candle.w}
              height={candle.body}
              fill={candle.up ? "var(--sage)" : "var(--rust)"}
            />
          </g>
        ))}
        {active != null && geom.xs[active] != null && (
          <line
            x1={geom.xs[active]}
            x2={geom.xs[active]}
            y1={geom.padT}
            y2={geom.padT + geom.innerH}
            stroke="var(--ink)"
            strokeOpacity="0.35"
            strokeWidth="1"
          />
        )}
        {geom.labels.map((label) => (
          <g key={label.title}>
            <text
              x={geom.plotR + 4}
              y={label.y - 2}
              fill="var(--muted)"
              fontSize="8"
              fontFamily="var(--font-mono), monospace"
            >
              {label.title}
            </text>
            <text
              x={geom.plotR + 4}
              y={label.y + 9}
              fill="var(--ink)"
              fontSize="9"
              fontFamily="var(--font-mono), monospace"
            >
              {label.value}
            </text>
          </g>
        ))}
        {geom.xLabels.map((label) => (
          <text
            key={label.text}
            x={label.x}
            y={geom.vbH - 8}
            textAnchor={label.anchor}
            fill="var(--muted)"
            fontSize="9"
            fontFamily="var(--font-mono), monospace"
          >
            {label.text}
          </text>
        ))}
      </svg>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        ローソクは日足。実線は20日線。点線はいまの20日高値と20日安値。指でなぞるとその日の始値・高値・安値・終値が出る。
      </p>
    </figure>
  );
}

function layout(bars: ChartBar[], low20: number, high20: number) {
  const vbW = 360;
  const vbH = 252;
  const padL = 6;
  const padR = 62;
  const padT = 12;
  const padB = 26;
  const plotR = vbW - padR;
  const innerW = plotR - padL;
  const innerH = vbH - padT - padB;
  const values = [low20, high20];
  for (const bar of bars) {
    values.push(bar.low, bar.high);
    if (bar.ma20 != null) values.push(bar.ma20);
  }
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (!(max > min)) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  min -= span * 0.08;
  max += span * 0.08;
  const yOf = (price: number) => padT + ((max - price) / (max - min)) * innerH;
  const xOf = (index: number) =>
    bars.length <= 1 ? padL + innerW / 2 : padL + (index / (bars.length - 1)) * innerW;
  const slot = innerW / Math.max(bars.length, 1);
  const candleW = Math.max(1.5, Math.min(5.5, slot * 0.62));
  const xs = bars.map((_, index) => xOf(index));
  const candles = bars.map((bar, index) => {
    const up = bar.close >= bar.open;
    const yOpen = yOf(bar.open);
    const yClose = yOf(bar.close);
    return {
      date: bar.date,
      x: xs[index],
      w: candleW,
      yHigh: yOf(bar.high),
      yLow: yOf(bar.low),
      yBody: Math.min(yOpen, yClose),
      body: Math.max(1, Math.abs(yClose - yOpen)),
      up,
    };
  });

  let maPath = "";
  bars.forEach((bar, index) => {
    if (bar.ma20 == null) return;
    const cmd = maPath ? "L" : "M";
    maPath += `${cmd}${xs[index].toFixed(2)},${yOf(bar.ma20).toFixed(2)}`;
  });

  const bandStart = Math.max(0, bars.length - 20);
  const bandX = Math.max(padL, xs[bandStart] - candleW);
  const bandW = Math.max(0, xs[xs.length - 1] + candleW - bandX);

  const labels = placeLabels(
    [
      { y: yOf(high20), title: "20日高値", value: formatPx(high20) },
      { y: yOf(low20), title: "20日安値", value: formatPx(low20) },
      { y: yOf(bars[bars.length - 1].close), title: "終値", value: formatPx(bars[bars.length - 1].close) },
    ],
    padT + 8,
    padT + innerH - 8,
  );

  const xLabels = [
    { x: xs[0], text: shortDate(bars[0].date), anchor: "start" as const },
    { x: xs[xs.length - 1], text: shortDate(bars[bars.length - 1].date), anchor: "end" as const },
  ];

  return {
    vbW,
    vbH,
    padL,
    padT,
    plotR,
    innerH,
    xs,
    candles,
    maPath,
    highY: yOf(high20),
    lowY: yOf(low20),
    bandX,
    bandW,
    labels,
    xLabels,
  };
}

function placeLabels(raw: Label[], minY: number, maxY: number): Label[] {
  const sorted = [...raw].sort((a, b) => a.y - b.y);
  const placed: Label[] = [];
  let cursor = minY;
  for (const label of sorted) {
    const y = Math.max(label.y, cursor);
    placed.push({ ...label, y: Math.min(y, maxY) });
    cursor = y + 22;
  }
  return placed;
}
