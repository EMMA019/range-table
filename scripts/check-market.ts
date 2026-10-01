import { getMarketPayload } from "../src/lib/market";

async function main() {
  const payload = await getMarketPayload();
  const failed = payload.rows
    .filter((row) => !row.quote)
    .map((row) => ({ t: row.ticker, error: row.error, detail: row.errorDetail }));

  console.log(
    JSON.stringify(
      {
        barDate: payload.barDate,
        fetchedAtJst: payload.fetchedAtJst,
        excludedPartial: payload.excludedPartial,
        ok: payload.okCount,
        fail: payload.failCount,
        indices: payload.indices.map((index) =>
          index.quote
            ? {
                t: index.ticker,
                close: index.quote.close,
                ma20: index.quote.ma20,
                dev: index.quote.devPct,
                date: index.quote.closeDate,
              }
            : { t: index.ticker, error: index.error },
        ),
        failed,
        gaps: payload.rows.filter((row) => row.quote?.gapWarning).map((row) => row.ticker),
        breakouts: payload.rows.filter((row) => row.quote?.brokeHigh).map((row) => row.ticker),
        bottom: payload.rows
          .filter((row) => row.quote && row.quote.boxPct <= 20)
          .map((row) => `${row.ticker}:${row.quote?.boxPct.toFixed(1)}`),
      },
      null,
      2,
    ),
  );
}

main();
