/**
 * extractJSON — Layer 3 robust JSON extractor
 *
 * LLMs frequently wrap JSON in markdown code fences (```json ... ```).
 * A naive JSON.parse() on that string crashes the entire pipeline.
 * This helper strips fences and falls back to regex object extraction.
 */
export function extractJSON(raw: string): unknown {
  // Step 1: Strip markdown code fences if present
  const cleaned = raw
    .replace(/^```json\s*/im, "")
    .replace(/^```\s*/im, "")
    .replace(/```\s*$/im, "")
    .trim();

  // Step 2: Try parsing the cleaned string directly
  try {
    return JSON.parse(cleaned);
  } catch {
    // Step 3: Fall back — extract the first {...} block found in the raw string
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // match found but still unparseable — fall through to throw
      }
    }
    throw new Error(`extractJSON: unparseable LLM response.\nRaw: ${raw.slice(0, 300)}`);
  }
}
