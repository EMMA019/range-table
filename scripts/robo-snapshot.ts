import { getRoboStudy } from "../src/lib/robo-feed";
import { describeSleeve } from "../src/lib/robo-model";

async function main() {
  const started = Date.now();
  const study = await getRoboStudy();
  if ("error" in study) {
    console.error(study.error);
    process.exit(1);
  }
  const view = describeSleeve(study.factors, 1000, []);
  console.log(
    JSON.stringify(
      {
        seconds: Math.round((Date.now() - started) / 1000),
        asOf: study.asOf,
        verdict: view.verdict,
        note: view.note,
        regime: study.factors.regime,
        regimeText: study.regimeText,
        trainMonths: study.factors.trainMonths,
        modelReady: view.allocation.modelReady,
        weights: view.allocation.weights,
        hit: study.hit,
        hitText: study.hitText,
        importance: study.importance,
        warnings: study.warnings,
        byBudget: study.byBudget,
      },
      null,
      2,
    ),
  );
}

void main();
