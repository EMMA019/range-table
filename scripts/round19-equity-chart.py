#!/usr/bin/env python3
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt


def main() -> None:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "data/.cache/round19/equity-chart.json")
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "docs/round19_equity.png")
    data = json.loads(path.read_text())
    fig, ax = plt.subplots(figsize=(9, 5), dpi=90)
    for series in data["series"]:
        ax.plot(series["dates"], series["values"], label=series["label"], linewidth=1.8)
    ax.set_title(data.get("title", "Saka Index OOS vs benchmarks"))
    ax.set_ylabel("Growth of $1 (normalized)")
    ax.legend(loc="upper left", fontsize=9)
    ax.grid(True, alpha=0.3)
    plt.tight_layout()
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, format="png")
    print(f"wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
