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

export async function extractUnknown(
  problem: string,
  domains: string[]
): Promise<string[]> {
  const prompt = `You are a physics problem parser.
  
Given this AP Physics C problem, identify exactly what variable the student is being asked to solve for.

Domain context: ${domains.join(", ")}

Return ONLY a valid JSON object with no explanation:
{"unknowns": ["symbol"]}

Use these standard physics symbols:
- v, v0 for velocity/speed (generic)
- v_min for minimum speed specifically
- v_max for maximum speed specifically  
- omega for angular velocity or angular frequency
- alpha for angular acceleration
- T for period
- I for moment of inertia
- a for acceleration
- F for force
- KE, PE for energy
- p for momentum
- x, d for position or distance
- t for time
- theta for angle

Problem: "${problem}"`;

  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "meta-llama/llama-3.3-70b-instruct:free",
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          max_tokens: 50,
        }),
      }
    );

    const data = await response.json();
    console.log("OpenRouter response:", JSON.stringify(data));

    if (!response.ok) {
      console.error("OpenRouter error:", data);
      return ["v"];
    }

    if (!data.choices || !data.choices[0]) {
      console.error("No choices in response:", data);
      return ["v"];
    }

    const raw = data.choices[0].message.content as string;
    const parsed = extractJSON(raw);
    return (parsed as any).unknowns ?? ["v"];
  } catch (error) {
    console.error("extractUnknown failed:", error);
    return ["v"];
  }
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "meta-llama/llama-3.3-70b-instruct:free";

const SYSTEM_PROMPT = `You are a physics problem parser. Given a physics word problem, extract all known values and variables.

Respond ONLY with a JSON object in this exact format — no markdown, no extra text:
{
  "domains": ["kinematics_1d", "projectile", "vertical_circle", "shm", "rotation", "incline", "energy_conservation", "momentum", "centripetal", "gravitation", "unknown"],
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
    if (!Array.isArray(parsed.domains) || parsed.domains.length === 0 || !parsed.knowns || !parsed.unknowns) return null;

    return { ...parsed, confidence: "high" };
  } catch (err) {
    console.error("[LLM Fallback] Fetch failed:", err);
    return null;
  }
}
