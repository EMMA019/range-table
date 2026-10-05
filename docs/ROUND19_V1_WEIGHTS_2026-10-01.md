# plain_15__mcap ウェイト — 2026-10-01

`targetWeights`（`weight: "mcap"` のあと `applySemiCap`、半導体サブ業 30%）。時価は現行 `pitMarketCapForTicker`。修正は入れていない。

半導体サブ業（AVGO, MU, AMD, LRCX, AMAT）の合計は **25.80%** で 30% 以下。キャップは掛かっておらず、下の比率は時価比例そのもの。未丸めの合計は 100%。2桁表示の合計は **99.99%**（丸め）。

| ティッカー | ウェイト |
|---|---:|
| MSFT | 20.77% |
| AMZN | 14.60% |
| META | 10.05% |
| AVGO | 8.95% |
| TSLA | 7.63% |
| MU | 6.76% |
| LLY | 5.90% |
| AMD | 5.48% |
| WMT | 4.51% |
| JNJ | 3.40% |
| ABBV | 2.51% |
| PLTR | 2.49% |
| CSCO | 2.33% |
| LRCX | 2.32% |
| AMAT | 2.29% |

**AAPL / GOOGL / NVDA は不在。** 3つとも 2026-10-01 の S&P 構成で、価格あり、TTM 黒字。`pitMarketCap` が 0（算出不可）なので上位15に入らない。GOOG も同じ理由で 0。原因の数値は `docs/ROUND19_MCAP_LEAK_AUDIT_ja.md` の 2026-10-01 行（試算が 4兆ドルを超え、候補条件 `m < 4e12` で落ちる）。
