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
const OPENROUTER_MODEL = "meta-llama/llama-3.3-70b-instruct:free";

async function callOpenRouter(payload: unknown): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch((err) => {
      console.error("OpenRouter JSON parse failed:", err);
      return null;
    });

    if (data?.error?.code === 429 || response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
      continue;
    }

    if (!data || !data.choices || !data.choices[0]) {
      console.error("No choices in response:", data);
      return '{"unknowns": ["v"]}';
    }

    return data.choices[0].message.content;
  }

  return '{"unknowns": ["v"]}';
}

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
    const raw = await callOpenRouter({
      model: OPENROUTER_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 50,
    });

    const parsed = extractJSON(raw);
    return (parsed as any).unknowns ?? ["v"];
  } catch (error) {
    console.error("extractUnknown failed:", error);
    return ["v"];
  }
}

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
    const raw = await callOpenRouter({
      model: OPENROUTER_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Parse this physics problem:\n\n${problem}` },
      ],
      temperature: 0.1,
      max_tokens: 512,
    });

    const parsed = extractJSON(raw) as ParseResult;

    // Basic validation
    if (!Array.isArray(parsed.domains) || parsed.domains.length === 0 || !parsed.knowns || !parsed.unknowns) return null;

    return { ...parsed, confidence: "high" };
  } catch (err) {
    console.error("[LLM Fallback] Fetch failed:", err);
    return null;
  }
}
