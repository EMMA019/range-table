#!/usr/bin/env python3
"""Render correlation heatmap from JSON (see round18-portfolio-study.ts)."""
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


def main() -> None:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "data/.cache/round18/corr-heatmap.json")
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "docs/round18_corr_heatmap.png")
    data = json.loads(path.read_text())
    labels = data["labels"]
    matrix = np.array(data["matrix"], dtype=float)
    n = len(labels)
    figsize = (max(10, n * 0.35), max(10, n * 0.35))
    fig, ax = plt.subplots(figsize=figsize, dpi=100)
    im = ax.imshow(matrix, vmin=-1, vmax=1, cmap="RdBu_r", aspect="equal")
    ax.set_xticks(range(n))
    ax.set_yticks(range(n))
    fs = 9 if n <= 25 else 7 if n <= 35 else 6
    ax.set_xticklabels(labels, rotation=90, fontsize=fs)
    ax.set_yticklabels(labels, fontsize=fs)
    ax.set_title(data.get("title", "Round 18 correlation (1y)"), fontsize=12, pad=12)
    cbar = fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    cbar.set_label("Pearson ρ", fontsize=10)
    plt.tight_layout()
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, format="png", pil_kwargs={"optimize": True})
    print(f"wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
