#!/usr/bin/env python3
"""Round 20 tenure chart — annual mean excess return by bucket."""
import json
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt


def main() -> None:
    if len(sys.argv) < 3:
        print("usage: round20-tenure-chart.py <json> <png>", file=sys.stderr)
        sys.exit(1)
    with open(sys.argv[1], encoding="utf-8") as f:
        data = json.load(f)
    years = data["years"]
    lt1 = [x * 100 for x in data["lt1Excess"]]
    gte5 = [x * 100 for x in data["gte5Excess"]]
    x = range(len(years))
    w = 0.35
    fig, ax = plt.subplots(figsize=(10, 4.5))
    ax.bar([i - w / 2 for i in x], lt1, width=w, label="<1y vs SPY", color="#c44e52")
    ax.bar([i + w / 2 for i in x], gte5, width=w, label=">=5y vs SPY", color="#4c72b0")
    ax.axhline(0, color="#333", linewidth=0.8)
    ax.set_xticks(list(x))
    ax.set_xticklabels([str(y) for y in years], rotation=45, ha="right")
    ax.set_ylabel("Mean 12M excess return (%)")
    ax.set_title("S&P 500 tenure buckets — annual pooled excess vs SPY")
    ax.legend(loc="upper left", fontsize=9)
    fig.tight_layout()
    fig.savefig(sys.argv[2], dpi=120)
    print(f"wrote {sys.argv[2]}")


if __name__ == "__main__":
    main()
