# Round 17 結果（日本語）

事前登録: `d7df2e03cb72f61b055c8f6f8b6e804c8f5e3f75`
生成: 2026-10-04T08:55:17.749Z

## 安定化フィルタ（訂正メモ）

フィルタは `generateLiveBandSignals` に接続済み。23–37%帯では終値が10日安値をほぼ常に上回るため、ポートフォリオ結果は基準と同一になりやすい（バグではなく定義上の no-op）。

```json
{
  "verdict": "no-op on 2024-26 for N=2 (identical to baseline); N=3 identical on in-sample — filter wired but rarely binds in band",
  "signalsBlockedTouchOnly": {
    "oos-N2": 42,
    "oos-N3": 55,
    "in-N2": 15,
    "in-N3": 20
  },
  "candidateDelta": {
    "oos": {
      "stab2": 0,
      "stab3": -2
    },
    "in": {
      "stab2": 0,
      "stab3": -2
    }
  }
}
```

## 急落フィルタ k=3.5 で外れた約定

```json
{
  "oos": [],
  "in": [
    {
      "ticker": "NOK",
      "entryDate": "2026-01-23",
      "pnlUsd": 13.82
    },
    {
      "ticker": "AVGO",
      "entryDate": "2026-01-27",
      "pnlUsd": -22.41
    },
    {
      "ticker": "VST",
      "entryDate": "2026-02-09",
      "pnlUsd": 28.1
    },
    {
      "ticker": "VST",
      "entryDate": "2026-02-09",
      "pnlUsd": 28.1
    }
  ]
}
```

## AI・DC 枠2上限で外れた約定

```json
{
  "skippedBaselineFills": {
    "oos": [
      {
        "ticker": "NTAP",
        "entryDate": "2022-10-19",
        "pnlUsd": 36.4
      },
      {
        "ticker": "SBUX",
        "entryDate": "2022-10-26",
        "pnlUsd": 31.15
      },
      {
        "ticker": "MOD",
        "entryDate": "2022-12-13",
        "pnlUsd": 27.18
      },
      {
        "ticker": "MOD",
        "entryDate": "2022-12-13",
        "pnlUsd": 27.18
      },
      {
        "ticker": "AMZN",
        "entryDate": "2023-01-09",
        "pnlUsd": 37.18
      },
      {
        "ticker": "ANET",
        "entryDate": "2023-01-12",
        "pnlUsd": 78.42
      },
      {
        "ticker": "TYL",
        "entryDate": "2023-01-10",
        "pnlUsd": 7.19
      },
      {
        "ticker": "TYL",
        "entryDate": "2023-01-10",
        "pnlUsd": 7.19
      },
      {
        "ticker": "INTC",
        "entryDate": "2023-02-09",
        "pnlUsd": -40
      },
      {
        "ticker": "EW",
        "entryDate": "2023-02-09",
        "pnlUsd": -19.05
      },
      {
        "ticker": "FN",
        "entryDate": "2023-03-22",
        "pnlUsd": -13.12
      },
      {
        "ticker": "MTSI",
        "entryDate": "2023-03-27",
        "pnlUsd": -30.28
      },
      {
        "ticker": "POET",
        "entryDate": "2023-03-22",
        "pnlUsd": -19.4
      },
      {
        "ticker": "POET",
        "entryDate": "2023-03-22",
        "pnlUsd": -19.4
      },
      {
        "ticker": "ENTG",
        "entryDate": "2023-04-28",
        "pnlUsd": 95.42
      },
      {
        "ticker": "AMKR",
        "entryDate": "2023-05-11",
        "pnlUsd": 58.7
      },
      {
        "ticker": "LSCC",
        "entryDate": "2023-06-05",
        "pnlUsd": 50.7
      },
      {
        "ticker": "CIEN",
        "entryDate": "2023-06-21",
        "pnlUsd": -15.7
      },
      {
        "ticker": "SMCI",
        "entryDate": "2023-06-26",
        "pnlUsd": 54.82
      },
      {
        "ticker": "POWL",
        "entryDate": "2023-06-21",
        "pnlUsd": 39.12
      },
      {
        "ticker": "POWL",
        "entryDate": "2023-06-21",
        "pnlUsd": 39.12
      },
      {
        "ticker": "POET",
        "entryDate": "2023-07-31",
        "pnlUsd": -42.12
      },
      {
        "ticker": "POET",
        "entryDate": "2023-09-01",
        "pnlUsd": -31.41
      },
      {
        "ticker": "SMCI",
        "entryDate": "2023-08-31",
        "pnlUsd": -29.44
      },
      {
        "ticker": "SMCI",
        "entryDate": "2023-08-31",
        "pnlUsd": -29.44
      },
      {
        "ticker": "POET",
        "entryDate": "2023-09-12",
        "pnlUsd": -31.41
      },
      {
        "ticker": "GFS",
        "entryDate": "2023-10-12",
        "pnlUsd": -22.12
      },
      {
        "ticker": "STM",
        "entryDate": "2023-11-03",
        "pnlUsd": 36.42
      },
      {
        "ticker": "LSCC",
        "entryDate": "2023-11-15",
        "pnlUsd": 41.94
      },
      {
        "ticker": "SMCI",
        "entryDate": "2023-12-04",
        "pnlUsd": 58.28
      },
      {
        "ticker": "SMCI",
        "entryDate": "2023-12-04",
        "pnlUsd": 58.28
      },
      {
        "ticker": "CIEN",
        "entryDate": "2023-12-20",
        "pnlUsd": 47.7
      },
      {
        "ticker": "CIEN",
        "entryDate": "2023-12-20",
        "pnlUsd": 47.7
      },
      {
        "ticker": "RMBS",
        "entryDate": "2024-01-11",
        "pnlUsd": 38.96
      },
      {
        "ticker": "CLS",
        "entryDate": "2024-01-17",
        "pnlUsd": -7.26
      },
      {
        "ticker": "CLS",
        "entryDate": "2024-01-17",
        "pnlUsd": -7.26
      },
      {
        "ticker": "GFS",
        "entryDate": "2024-02-09",
        "pnlUsd": -11.83
      },
      {
        "ticker": "NOK",
        "entryDate": "2024-02-14",
        "pnlUsd": 21.06
      },
      {
        "ticker": "POET",
        "entryDate": "2024-03-05",
        "pnlUsd": -51.53
      },
      {
        "ticker": "POET",
        "entryDate": "2024-03-05",
        "pnlUsd": -51.53
      },
      {
        "ticker": "FN",
        "entryDate": "2024-03-25",
        "pnlUsd": -16.72
      },
      {
        "ticker": "VIAV",
        "entryDate": "2024-03-22",
        "pnlUsd": -35.35
      },
      {
        "ticker": "VIAV",
        "entryDate": "2024-03-18",
        "pnlUsd": -33.55
      },
      {
        "ticker": "DELL",
        "entryDate": "2024-04-01",
        "pnlUsd": 49.73
      },
      {
        "ticker": "ARM",
        "entryDate": "2024-03-12",
        "pnlUsd": -0.16
      },
      {
        "ticker": "POET",
        "entryDate": "2024-04-08",
        "pnlUsd": -32.7
      },
      {
        "ticker": "POET",
        "entryDate": "2024-04-08",
        "pnlUsd": -32.7
      },
      {
        "ticker": "SMCI",
        "entryDate": "2024-04-08",
        "pnlUsd": -50.47
      },
      {
        "ticker": "ANET",
        "entryDate": "2024-04-30",
        "pnlUsd": 51.23
      },
      {
        "ticker": "ARM",
        "entryDate": "2024-04-30",
        "pnlUsd": 16.93
      },
      {
        "ticker": "SBUX",
        "entryDate": "2024-05-13",
        "pnlUsd": 17.65
      },
      {
        "ticker": "ON",
        "entryDate": "2024-05-30",
        "pnlUsd": 36.2
      },
      {
        "ticker": "AMD",
        "entryDate": "2024-06-13",
        "pnlUsd": -12.24
      },
      {
        "ticker": "ALAB",
        "entryDate": "2024-06-12",
        "pnlUsd": -29.98
      },
      {
        "ticker": "RMBS",
        "entryDate": "2024-06-21",
        "pnlUsd": 47.46
      },
      {
        "ticker": "AMD",
        "entryDate": "2024-06-25",
        "pnlUsd": 27.64
      },
      {
        "ticker": "HUBB",
        "entryDate": "2024-07-03",
        "pnlUsd": 23.12
      },
      {
        "ticker": "HUBB",
        "entryDate": "2024-07-03",
        "pnlUsd": 23.12
      },
      {
        "ticker": "QCOM",
        "entryDate": "2024-07-05",
        "pnlUsd": -29.2
      },
      {
        "ticker": "CLS",
        "entryDate": "2024-07-18",
        "pnlUsd": -42.28
      },
      {
        "ticker": "EME",
        "entryDate": "2024-07-09",
        "pnlUsd": -17.94
      },
      {
        "ticker": "EME",
        "entryDate": "2024-07-09",
        "pnlUsd": -17.94
      },
      {
        "ticker": "ASX",
        "entryDate": "2024-09-05",
        "pnlUsd": 42.98
      },
      {
        "ticker": "F",
        "entryDate": "2024-09-26",
        "pnlUsd": -4.06
      }
    ],
    "in": [
      {
        "ticker": "WDC",
        "entryDate": "2024-11-12",
        "pnlUsd": -14.24
      },
      {
        "ticker": "POET",
        "entryDate": "2024-11-07",
        "pnlUsd": 36.7
      },
      {
        "ticker": "POET",
        "entryDate": "2024-11-07",
        "pnlUsd": 36.7
      },
      {
        "ticker": "MOS",
        "entryDate": "2024-11-26",
        "pnlUsd": -29.94
      },
      {
        "ticker": "MOS",
        "entryDate": "2024-11-26",
        "pnlUsd": -29.94
      },
      {
        "ticker": "POET",
        "entryDate": "2024-12-13",
        "pnlUsd": 45.83
      },
      {
        "ticker": "NTAP",
        "entryDate": "2024-12-26",
        "pnlUsd": -13.15
      },
      {
        "ticker": "AMKR",
        "entryDate": "2025-01-17",
        "pnlUsd": 23.27
      },
      {
        "ticker": "AMKR",
        "entryDate": "2025-01-17",
        "pnlUsd": 23.27
      },
      {
        "ticker": "POET",
        "entryDate": "2025-01-22",
        "pnlUsd": -32.67
      },
      {
        "ticker": "POET",
        "entryDate": "2025-01-22",
        "pnlUsd": -32.67
      },
      {
        "ticker": "POWL",
        "entryDate": "2025-01-28",
        "pnlUsd": -21.64
      },
      {
        "ticker": "ETN",
        "entryDate": "2025-02-11",
        "pnlUsd": -20.69
      },
      {
        "ticker": "STX",
        "entryDate": "2025-02-04",
        "pnlUsd": -2.5
      },
      {
        "ticker": "STX",
        "entryDate": "2025-02-04",
        "pnlUsd": -2.5
      },
      {
        "ticker": "VRT",
        "entryDate": "2025-04-03",
        "pnlUsd": -13.48
      },
      {
        "ticker": "SNDK",
        "entryDate": "2025-04-30",
        "pnlUsd": 46.62
      },
      {
        "ticker": "SNDK",
        "entryDate": "2025-04-30",
        "pnlUsd": 46.62
      },
      {
        "ticker": "MOD",
        "entryDate": "2025-05-30",
        "pnlUsd": 31.1
      },
      {
        "ticker": "CRWV",
        "entryDate": "2025-07-10",
        "pnlUsd": -29.72
      },
      {
        "ticker": "MOD",
        "entryDate": "2025-07-11",
        "pnlUsd": 54.54
      },
      {
        "ticker": "MOD",
        "entryDate": "2025-07-11",
        "pnlUsd": 54.54
      },
      {
        "ticker": "POET",
        "entryDate": "2025-07-31",
        "pnlUsd": -31.04
      },
      {
        "ticker": "POET",
        "entryDate": "2025-07-29",
        "pnlUsd": -31.39
      },
      {
        "ticker": "CIEN",
        "entryDate": "2025-08-20",
        "pnlUsd": 50.9
      },
      {
        "ticker": "VRT",
        "entryDate": "2025-08-28",
        "pnlUsd": 10.52
      },
      {
        "ticker": "VRT",
        "entryDate": "2025-08-28",
        "pnlUsd": 10.52
      },
      {
        "ticker": "CRWV",
        "entryDate": "2025-08-29",
        "pnlUsd": 20.92
      },
      {
        "ticker": "POET",
        "entryDate": "2025-09-30",
        "pnlUsd": 74.34
      },
      {
        "ticker": "POET",
        "entryDate": "2025-09-30",
        "pnlUsd": 74.34
      },
      {
        "ticker": "VST",
        "entryDate": "2025-10-08",
        "pnlUsd": -30.82
      },
      {
        "ticker": "ANET",
        "entryDate": "2025-10-16",
        "pnlUsd": 52.64
      },
      {
        "ticker": "SMCI",
        "entryDate": "2025-12-05",
        "pnlUsd": -40.8
      },
      {
        "ticker": "INTC",
        "entryDate": "2025-12-22",
        "pnlUsd": 36.08
      },
      {
        "ticker": "MOD",
        "entryDate": "2025-12-17",
        "pnlUsd": -36.58
      },
      {
        "ticker": "MRVL",
        "entryDate": "2025-12-16",
        "pnlUsd": -10.3
      },
      {
        "ticker": "GLW",
        "entryDate": "2026-01-08",
        "pnlUsd": 71.2
      },
      {
        "ticker": "GLW",
        "entryDate": "2026-01-08",
        "pnlUsd": 71.2
      },
      {
        "ticker": "ALAB",
        "entryDate": "2026-01-27",
        "pnlUsd": -28.18
      },
      {
        "ticker": "AVGO",
        "entryDate": "2026-01-27",
        "pnlUsd": -22.41
      },
      {
        "ticker": "LSCC",
        "entryDate": "2026-02-02",
        "pnlUsd": 50.75
      },
      {
        "ticker": "RMBS",
        "entryDate": "2026-02-11",
        "pnlUsd": -20.56
      },
      {
        "ticker": "CLS",
        "entryDate": "2026-05-11",
        "pnlUsd": -32.74
      },
      {
        "ticker": "JBL",
        "entryDate": "2026-05-19",
        "pnlUsd": 37.89
      },
      {
        "ticker": "POWI",
        "entryDate": "2026-05-19",
        "pnlUsd": 98.12
      },
      {
        "ticker": "VLO",
        "entryDate": "2026-05-28",
        "pnlUsd": 19.18
      },
      {
        "ticker": "TSM",
        "entryDate": "2026-07-08",
        "pnlUsd": -24.41
      },
      {
        "ticker": "NRG",
        "entryDate": "2026-07-16",
        "pnlUsd": -24.37
      },
      {
        "ticker": "APH",
        "entryDate": "2026-07-22",
        "pnlUsd": -22.08
      },
      {
        "ticker": "TEL",
        "entryDate": "2026-07-01",
        "pnlUsd": 11.46
      },
      {
        "ticker": "CSCO",
        "entryDate": "2026-07-22",
        "pnlUsd": 49.22
      },
      {
        "ticker": "APH",
        "entryDate": "2026-08-26",
        "pnlUsd": 17.03
      },
      {
        "ticker": "ANET",
        "entryDate": "2026-09-04",
        "pnlUsd": 36.56
      }
    ]
  },
  "note": "Profit fell when higher-RS AI/DC names filled slots instead of baseline picks (bucket max 2)."
}
```

## $30 損切り併用出口

```json
{
  "dollarStopLedCandidates": 0,
  "fillsWithDifferentPnl": 0
}
```

## SOXX（チューニング N=2）

| variant | window | trades | $1.90 net | DD | 連敗 |
|---|---|---:|---:|---:|---:|
| no-spy | oos | 209 | 1784.09 | 545.90 | 22 |
| no-spy | in | 245 | 189.77 | 858.01 | 12 |
| baseline | oos | 173 | 1382.92 | 387.94 | 15 |
| baseline | in | 192 | 906.22 | 406.96 | 13 |
| spy-soxx-all | oos | 152 | 527.83 | 527.99 | 11 |
| spy-soxx-all | in | 169 | 780.27 | 497.22 | 17 |
| soxx-semi-2 | oos | 172 | 1148.31 | 416.55 | 12 |
| soxx-semi-2 | in | 190 | 860.18 | 455.83 | 21 |
| soxx-all-2 | oos | 152 | 527.83 | 527.99 | 11 |
| soxx-all-2 | in | 169 | 780.27 | 497.22 | 17 |

## 半導体ボックス長（ポートフォリオ）

| box | window | trades | $1.90 net | DD | 連敗 |
|---|---|---:|---:|---:|---:|
| 5d | oos | 151 | 214.82 | 429.08 | 14 |
| 5d | in | 158 | -314.08 | 569.80 | 13 |
| 10d | oos | 81 | 331.42 | 258.41 | 10 |
| 10d | in | 102 | 195.55 | 414.52 | 16 |
| 20d | oos | 65 | 599.67 | 217.79 | 9 |
| 20d | in | 76 | 56.91 | 265.34 | 11 |

## 合否（2024-26、基準比）

| variant | trades | $1.90 net | DD | 連敗 | 判定 |
|---|---:|---:|---:|---:|---|
| baseline | 192 | 906.22 | 406.96 | 13 | 基準 |
| soxx-all-2 | 169 | 780.27 | 497.22 | 17 | {"kind":"fail","reasons":["max_dd","max_consec_losses"]} |
| soxx-semi-2 | 190 | 860.18 | 455.83 | 21 | {"kind":"fail","reasons":["max_dd","max_consec_losses"]} |
| exit-risk30 | 192 | 906.22 | 406.96 | 13 | {"kind":"pass"} |
| crash-3.5 | 191 | 820.69 | 406.96 | 13 | {"kind":"pass"} |
| stab-2 | 192 | 906.22 | 406.96 | 13 | {"kind":"pass"} |
| stab-3 | 192 | 906.22 | 406.96 | 13 | {"kind":"pass"} |
| ai-dc-cap | 180 | 279.27 | 397.55 | 8 | {"kind":"flag-profit","reasons":["profit_drop_15pct"]} |

## 要約

基準（2024-26）: 192回、$1.90純益 906.22、DD 406.96、連敗 13。急落フィルタは2022-24で k=3.5 を採用。テーマ除外 47 銘柄（宇宙は SPCX 以外、暗号は CORZ 等）

基準（2024-26）: 192回 / $1.90 net 906.22 / DD 406.96 / 連敗 13
