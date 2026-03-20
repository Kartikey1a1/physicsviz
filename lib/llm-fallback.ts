/**
 * Layer 2: OpenRouter Llama 3.1 8B Fallback
 *
 * Invoked only when Layer 1 regex parser returns confidence: "low".
 * Uses the free OpenRouter API — no cost for Llama 3.1 8B Instruct.
 *
 * Set OPENROUTER_API_KEY in .env.local
 */
import { extractJSON } from "./extract-json";
import type { ParseResult } from "./parser";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "meta-llama/llama-3.1-8b-instruct:free";

const SYSTEM_PROMPT = `You are a physics problem parser. Given a physics word problem, extract all known values and variables.

Respond ONLY with a JSON object in this exact format — no markdown, no extra text:
{
  "domain": "kinematics_1d" | "kinematics_2d_projectile" | "vertical_circle" | "shm_spring" | "shm_pendulum" | "rotation" | "energy" | "momentum" | "gravitation" | "unknown",
  "knowns": { "key": numericValue },
  "unknowns": ["var1", "var2"],
  "objectType": "canonical_shape_name"
}

Valid objectType values: point_mass, thin_disk, solid_disk, hollow_sphere, solid_sphere, thin_rod, vertical_circle, spring, pendulum, inclined_plane`;

export async function llmFallbackParse(problem: string): Promise<ParseResult | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.warn("[LLM Fallback] OPENROUTER_API_KEY not set — skipping Layer 2");
    return null;
  }

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://physicsviz.app",
        "X-Title": "PhysicsViz",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Parse this physics problem:\n\n${problem}` },
        ],
        temperature: 0.1,
        max_tokens: 512,
      }),
    });

    if (!res.ok) {
      console.error("[LLM Fallback] OpenRouter error:", res.status, await res.text());
      return null;
    }

    const json = await res.json();
    const raw = json.choices?.[0]?.message?.content ?? "";
    const parsed = extractJSON(raw) as ParseResult;

    // Basic validation
    if (!parsed.domain || !parsed.knowns || !parsed.unknowns) return null;

    return { ...parsed, confidence: "high" };
  } catch (err) {
    console.error("[LLM Fallback] Fetch failed:", err);
    return null;
  }
}
