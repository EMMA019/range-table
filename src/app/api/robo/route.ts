import { NextResponse } from "next/server";
import { getRoboStudy } from "@/lib/robo-feed";
import { roboHoldingsFromEnv } from "@/lib/robo-holdings";
import {
  COMMISSION_USD,
  DEFAULT_BUDGET,
  MIN_TRADE_USD,
  NO_TRADE_BAND,
  ROBO_UNIVERSE,
  assetByTicker,
  classifyForecast,
  describeSleeve,
  directionLabel,
  forecastText,
  sanitizeBudget,
} from "@/lib/robo-model";
import { configuredPasscode } from "@/lib/private-auth";
import { hasHoldingsSession } from "@/lib/private-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const budgetParam = url.searchParams.get("budget");
  const budget = budgetParam == null || budgetParam.trim() === "" ? DEFAULT_BUDGET : sanitizeBudget(Number(budgetParam));
  try {
    const study = await getRoboStudy();
    if ("error" in study) {
      return NextResponse.json({ error: study.error }, { status: 502 });
    }
    const authed = configuredPasscode() != null && (await hasHoldingsSession());
    const positions = authed ? roboHoldingsFromEnv() : [];
    const view = describeSleeve(study.factors, budget, positions);
    const weights = ROBO_UNIVERSE.map((asset) => ({
      ticker: asset.ticker,
      name: asset.name,
      group: asset.group,
      weight: view.allocation.weights[asset.ticker] ?? 0,
      price: study.factors.assets.find((row) => row.ticker === asset.ticker)?.price ?? null,
    })).filter((row) => row.weight >= 0.005);
    const forecasts = study.factors.assets.map((asset) => {
      const meta = assetByTicker(asset.ticker);
      const viewOf = classifyForecast(asset.forecast, asset.ridge, asset.gbm);
      return {
        ticker: asset.ticker,
        name: meta?.name ?? asset.ticker,
        group: meta?.group ?? "equity",
        direction: viewOf.direction,
        directionLabel: directionLabel(viewOf.direction),
        confidence: viewOf.confidence,
        text: forecastText(asset.forecast, asset.ridge, asset.gbm),
      };
    });
    return NextResponse.json(
      {
        disclaimer: study.disclaimer,
        asOf: study.asOf,
        warnings: study.warnings,
        verdict: view.verdict,
        regime: study.factors.regime,
        regimeText: study.regimeText,
        mlNote: view.note,
        cushionNote: view.cushionNote,
        trainMonths: study.factors.trainMonths,
        modelReady: view.allocation.modelReady,
        weights,
        forecasts,
        factors: study.factors,
        plan: view.plan,
        holdingsSource: authed && positions.length > 0 ? "env" : "none",
        byBudget: study.byBudget,
        hit: study.hit,
        hitText: study.hitText,
        importance: study.importance,
        assumptions: study.assumptions,
        limitations: study.limitations,
        band: NO_TRADE_BAND,
        minTradeUsd: MIN_TRADE_USD,
        commission: COMMISSION_USD,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "日足を取得できなかった";
    console.error("[range] robo route", error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
