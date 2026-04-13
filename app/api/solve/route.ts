/**
 * POST /api/solve
 *
 * Orchestrates the full 4-layer parsing pipeline:
 * Layer 1: Deterministic regex parser (free, instant)
 * Layer 2: OpenRouter Llama 3.1 8B (free, ~1s)
 * Layer 3: Robust JSON extraction retry
 * Layer 4: Honest error + synonym logging
 *
 * Then forwards the structured parse result to the SymPy worker for solving.
 */
import { NextResponse } from "next/server";
import { parsePhysicsProblem } from "@/lib/parser";
import { llmFallbackParse } from "@/lib/llm-fallback";

const SYMPY_WORKER_URL = process.env.SYMPY_WORKER_URL ?? "http://localhost:8000";

export async function POST(req: Request) {
  // ── Hard env var check — fail loudly in development ─────────────────────────
  if (!process.env.SYMPY_WORKER_URL) {
    return NextResponse.json(
      { detail: "SYMPY_WORKER_URL not set. Add it to .env.local (dev) or Vercel env vars (prod)." },
      { status: 500 }
    );
  }
  let body: { problem?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: "Invalid JSON body." }, { status: 400 });
  }

  const problem = body.problem?.trim();
  if (!problem) {
    return NextResponse.json({ detail: "problem field is required." }, { status: 400 });
  }

  // ── Layer 1: Deterministic Regex Parser ─────────────────────────────────────
  let parsed = await parsePhysicsProblem(problem);

  // ── Layer 2: Free LLM Fallback ───────────────────────────────────────────────
  if (parsed.confidence === "low") {
    console.log("[Solve] Layer 1 low confidence → invoking Layer 2 LLM fallback");
    const llmResult = await llmFallbackParse(problem);
    if (llmResult) {
      parsed = llmResult;
    }
  }

  // ── Layer 4: Honest error if still unknown ───────────────────────────────────
  if (parsed.domains.length === 0 || parsed.domains.includes("unknown")) {
    // TODO: append unrecognized phrasing to lib/synonyms.json via a logging endpoint
    return NextResponse.json({
      detail: "Sorry, I couldn't recognize this physics scenario. Try rephrasing or check that it's an AP Physics C: Mechanics problem.",
    }, { status: 422 });
  }

  // ── Forward to SymPy Worker ──────────────────────────────────────────────────
  let workerRes: Response;
  try {
    workerRes = await fetch(`${SYMPY_WORKER_URL}/solve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domains: parsed.domains,
        knowns: parsed.knowns,
        unknowns: parsed.unknowns,
        object_type: parsed.objectType,
      }),
    });
  } catch (err) {
    return NextResponse.json({
      detail: "Math engine is warming up. Please try again in 30 seconds.",
    }, { status: 503 });
  }

  if (!workerRes.ok) {
    const workerErr = await workerRes.json().catch(() => ({}));
    return NextResponse.json({
      detail: workerErr.detail ?? "Math engine error.",
    }, { status: 502 });
  }

  const workerData = await workerRes.json();
  console.log("Railway returned steps:", workerData.solution_steps?.length);

  // ── Parallel Array Contract Validation ──────────────────────────────────────
  // Guard 1: array must exist and be non-empty
  const { solution_steps } = workerData;
  if (!Array.isArray(solution_steps) || solution_steps.length === 0) {
    return NextResponse.json({ detail: "Solver returned no steps." }, { status: 422 });
  }
  // Guard 2: every step must carry a simulation_state (parallel array contract)
  if (solution_steps.some((s: any) => !s.simulation_state)) {
    return NextResponse.json({ detail: "Parallel array contract violated — one or more steps missing simulation_state." }, { status: 422 });
  }

  return NextResponse.json({
    problem,
    domain: parsed.domains[0] ?? "unknown",
    domains: parsed.domains,
    knowns: parsed.knowns,
    solution_steps: workerData.solution_steps,
  });
}
