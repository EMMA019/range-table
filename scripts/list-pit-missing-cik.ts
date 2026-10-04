import { loadSp500PitFiles, uniqueTickersInRange } from "../src/lib/sp500-pit";
import { buildPitCikMapForTickers } from "../src/lib/pit-cik";
import { SAKA_START, SAKA_END } from "../src/lib/round19-saka";
import { PIT_CACHE, loadPitCikOverrides } from "../src/lib/pit-dataset";

async function main() {
  const { intervals, gics } = await loadSp500PitFiles(PIT_CACHE);
  const pit = uniqueTickersInRange(intervals, SAKA_START, SAKA_END);
  const { cik: overrides } = loadPitCikOverrides();
  const m = await buildPitCikMapForTickers(PIT_CACHE, gics, pit, overrides);
  const miss = pit.filter((t) => !m.has(t));
  console.log(JSON.stringify({ missing: miss.length, tickers: miss }, null, 2));
}

main();
