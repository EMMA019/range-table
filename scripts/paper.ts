import fs from "fs";
import path from "path";
import { buildPaper } from "../src/lib/paper";
import { loadCore } from "./cache-bars";

/** Rewrites data/backtest/paper.json from daily bars. Same bars always produce the same books. */
const OUT = path.join(process.cwd(), "data", "backtest", "paper.json");

async function main() {
  const { names, spy, qqq } = await loadCore(true);
  const report = buildPaper({ names, spy, qqq, generatedAt: new Date().toISOString().slice(0, 10) });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`paper asOf=${report.asOf ?? "none"} books=${report.books.length} commit=${report.rulesCommit}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
