#!/usr/bin/env python3
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt


def main() -> None:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "data/.cache/pit/v1-contrib-chart.json")
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "docs/round19_v1_contribution.png")
    data = json.loads(path.read_text())
    labels = data["labels"]
    values = data["values"]
    colors = ["#2ecc71" if v >= 0 else "#e74c3c" for v in values]
    fig, ax = plt.subplots(figsize=(9, 5), dpi=90)
    ax.barh(labels[::-1], values[::-1], color=colors[::-1])
    ax.set_title(data.get("title", "Contribution"))
    ax.set_xlabel("Contribution (percentage points)")
    ax.axvline(0, color="#333", linewidth=0.8)
    ax.grid(True, axis="x", alpha=0.3)
    plt.tight_layout()
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, format="png")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
