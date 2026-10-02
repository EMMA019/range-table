export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Start the price fetch at boot so a request right after a wake-up waits less.
  // EPS warm-up still starts from /api/market after prices are in.
  const { warmMarket } = await import("./lib/market");
  void warmMarket().catch((error) => console.error("[range] boot warm", error));
}
