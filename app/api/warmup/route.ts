/**
 * GET /api/warmup
 * Forwards to the SymPy worker warmup endpoint.
 * Called by WarmupPing on every page load to prevent Render cold starts.
 */
import { NextResponse } from "next/server";

const SYMPY_WORKER_URL = process.env.SYMPY_WORKER_URL ?? "http://localhost:8000";

export async function GET() {
  try {
    await fetch(`${SYMPY_WORKER_URL}/warmup`, { method: "GET" });
    return NextResponse.json({ status: "warm" });
  } catch {
    // Silently fail — warmup is best-effort only
    return NextResponse.json({ status: "unreachable" }, { status: 200 });
  }
}
