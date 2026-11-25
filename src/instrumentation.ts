export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { engine } = await import("./lib/server/jobs");
    await engine().ready;
  }
}
